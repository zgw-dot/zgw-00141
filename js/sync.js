class SyncEngine {
    constructor() {
        this.isOnline = navigator.onLine;
        this.syncInterval = null;
        this.isSyncing = false;
        this.onSyncComplete = null;
        this.onConflictDetected = null;
        this.init();
    }

    init() {
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        this.updateNetworkStatus();
        this.startAutoSync();
    }

    updateNetworkStatus() {
        this.isOnline = navigator.onLine;
        const statusEl = document.getElementById('network-status');
        const textEl = document.getElementById('network-text');
        
        if (statusEl) {
            if (this.isOnline) {
                statusEl.classList.remove('offline');
                textEl.textContent = '在线';
            } else {
                statusEl.classList.add('offline');
                textEl.textContent = '离线';
            }
        }
    }

    handleOnline() {
        this.updateNetworkStatus();
        showToast('网络已恢复，正在同步...');
        this.processQueue();
    }

    handleOffline() {
        this.updateNetworkStatus();
        showToast('网络已断开，数据将在恢复后同步');
    }

    startAutoSync() {
        this.syncInterval = setInterval(() => {
            if (this.isOnline && !this.isSyncing) {
                this.processQueue();
            }
        }, 10000);
    }

    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    async addToQueue(action, data) {
        const queueItem = {
            id: generateId('queue'),
            action,
            data,
            status: QUEUE_STATUS.PENDING,
            timestamp: Date.now(),
            retryCount: 0,
            errorMessage: null
        };
        
        await db.put(STORES.OFFLINE_QUEUE, queueItem);
        await addAuditLog('queue_add', { action, dataId: data.id });
        
        if (this.isOnline) {
            setTimeout(() => this.processQueue(), 500);
        }
        
        return queueItem;
    }

    async processQueue() {
        if (this.isSyncing || !this.isOnline) return;
        
        this.isSyncing = true;
        
        try {
            const pendingItems = await db.getAll(
                STORES.OFFLINE_QUEUE, 
                'status', 
                IDBKeyRange.only(QUEUE_STATUS.PENDING)
            );
            
            pendingItems.sort((a, b) => a.timestamp - b.timestamp);
            
            for (const item of pendingItems) {
                if (!this.isOnline) break;
                await this.processQueueItem(item);
            }
            
            if (this.onSyncComplete) {
                this.onSyncComplete();
            }
        } catch (error) {
            console.error('Sync error:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    async processQueueItem(item) {
        try {
            await this.updateQueueStatus(item.id, QUEUE_STATUS.PROCESSING);
            
            const result = await this.mockServerSync(item);
            
            if (result.success) {
                await this.handleSyncSuccess(item, result);
            } else if (result.conflict) {
                await this.handleConflict(item, result);
            } else {
                throw new Error(result.error || 'Sync failed');
            }
        } catch (error) {
            console.error('Queue item error:', error);
            await this.handleSyncError(item, error.message);
        }
    }

    async mockServerSync(item) {
        await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
        
        const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
        const serverSupplies = serverState ? serverState.data : [];
        
        switch (item.action) {
            case 'create_distribution':
                return this.validateDistribution(item.data, serverSupplies);
            
            case 'update_distribution':
                return this.validateUpdateDistribution(item.data, serverSupplies);
            
            default:
                return { success: true, data: item.data };
        }
    }

    async validateDistribution(data, serverSupplies) {
        const serverSupply = serverSupplies.find(s => s.id === data.supplyId);
        
        if (!serverSupply) {
            return { success: false, error: '物资不存在' };
        }

        if (data.quantity > serverSupply.currentStock) {
            return {
                success: false,
                conflict: true,
                conflictType: CONFLICT_TYPES.STOCK_OVERFLOW,
                conflictData: {
                    local: { quantity: data.quantity },
                    server: { currentStock: serverSupply.currentStock, available: serverSupply.currentStock }
                }
            };
        }

        const todayDistributions = await this.getServerTodayDistributions(data.residentId, data.supplyId);
        if (todayDistributions.length > 0) {
            return {
                success: false,
                conflict: true,
                conflictType: CONFLICT_TYPES.DUPLICATE_DISTRIBUTION,
                conflictData: {
                    local: data,
                    server: { existingDistribution: todayDistributions[0] }
                }
            };
        }

        serverSupply.currentStock -= data.quantity;
        
        await db.put(STORES.SERVER_STATE, {
            id: 'server_supplies',
            data: serverSupplies,
            lastSync: Date.now()
        });

        const syncedDistribution = {
            ...data,
            serverSyncedAt: Date.now()
        };

        await this.addServerDistribution(syncedDistribution);

        return { success: true, data: syncedDistribution };
    }

    async validateUpdateDistribution(data, serverSupplies) {
        const existingConflict = await db.getAll(
            STORES.CONFLICTS, 
            'distributionId', 
            IDBKeyRange.only(data.id)
        );
        
        if (existingConflict.length > 0 && existingConflict[0].status === CONFLICT_STATUS.PENDING) {
            return {
                success: false,
                conflict: true,
                conflictType: CONFLICT_TYPES.VERSION_CONFLICT,
                conflictData: {
                    local: data,
                    server: existingConflict[0].serverData
                }
            };
        }

        if (CURRENT_USER.role !== ROLES.ADMIN) {
            return {
                success: false,
                conflict: true,
                conflictType: CONFLICT_TYPES.PERMISSION_DENIED,
                conflictData: {
                    message: '志愿者无权复核冲突，请联系管理员'
                }
            };
        }

        return { success: true, data };
    }

    async getServerTodayDistributions(residentId, supplyId) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        
        const distributions = await db.getAll(STORES.DISTRIBUTIONS, 'resident_supply', [residentId, supplyId]);
        
        return distributions.filter(d => 
            d.timestamp >= startOfDay.getTime() && 
            d.status === DISTRIBUTION_STATUS.SYNCED
        );
    }

    async addServerDistribution(distribution) {
        const serverDistributions = await db.get(STORES.SERVER_STATE, 'server_distributions') || { id: 'server_distributions', data: [] };
        serverDistributions.data.push({
            id: distribution.id,
            residentId: distribution.residentId,
            supplyId: distribution.supplyId,
            quantity: distribution.quantity,
            timestamp: distribution.timestamp,
            syncedAt: Date.now()
        });
        await db.put(STORES.SERVER_STATE, serverDistributions);
    }

    async handleSyncSuccess(item, result) {
        if (item.action === 'create_distribution' || item.action === 'update_distribution') {
            const distribution = await db.get(STORES.DISTRIBUTIONS, item.data.id);
            if (distribution) {
                distribution.status = DISTRIBUTION_STATUS.SYNCED;
                distribution.syncedAt = Date.now();
                distribution.serverSyncedAt = result.data.serverSyncedAt || Date.now();
                await db.put(STORES.DISTRIBUTIONS, distribution);
                
                if (item.action === 'create_distribution') {
                    const supply = await db.get(STORES.SUPPLIES, distribution.supplyId);
                    if (supply) {
                        supply.currentStock = Math.max(0, supply.currentStock - distribution.quantity);
                        await db.put(STORES.SUPPLIES, supply);
                    }
                }
                
                await addAuditLog('sync_success', { 
                    distributionId: distribution.id,
                    action: item.action
                });
            }
        }
        
        await db.delete(STORES.OFFLINE_QUEUE, item.id);
    }

    async handleConflict(item, result) {
        const existingConflict = await db.getAll(
            STORES.CONFLICTS, 
            'distributionId', 
            IDBKeyRange.only(item.data.id)
        );

        let conflict;
        if (existingConflict.length > 0) {
            conflict = existingConflict[0];
            conflict.conflictType = result.conflictType;
            conflict.localData = item.data;
            conflict.serverData = result.conflictData;
            conflict.timestamp = Date.now();
        } else {
            conflict = {
                id: generateId('conflict'),
                distributionId: item.data.id,
                conflictType: result.conflictType,
                status: CONFLICT_STATUS.PENDING,
                localData: item.data,
                serverData: result.conflictData,
                timestamp: Date.now(),
                resolvedBy: null,
                resolvedAt: null
            };
        }

        await db.put(STORES.CONFLICTS, conflict);

        const distribution = await db.get(STORES.DISTRIBUTIONS, item.data.id);
        if (distribution) {
            distribution.status = DISTRIBUTION_STATUS.CONFLICTED;
            distribution.conflictId = conflict.id;
            await db.put(STORES.DISTRIBUTIONS, distribution);
        }

        await db.delete(STORES.OFFLINE_QUEUE, item.id);
        
        await addAuditLog('conflict_detected', {
            conflictId: conflict.id,
            distributionId: item.data.id,
            conflictType: result.conflictType
        });

        if (this.onConflictDetected) {
            this.onConflictDetected(conflict);
        }

        showToast('检测到数据冲突，请前往复核');
    }

    async handleSyncError(item, errorMessage) {
        item.status = QUEUE_STATUS.FAILED;
        item.errorMessage = errorMessage;
        item.retryCount = (item.retryCount || 0) + 1;
        
        if (item.retryCount < 3) {
            item.status = QUEUE_STATUS.PENDING;
        }
        
        await db.put(STORES.OFFLINE_QUEUE, item);
        
        await addAuditLog('sync_error', {
            queueItemId: item.id,
            error: errorMessage,
            retryCount: item.retryCount
        });
    }

    async updateQueueStatus(id, status) {
        const item = await db.get(STORES.OFFLINE_QUEUE, id);
        if (item) {
            item.status = status;
            await db.put(STORES.OFFLINE_QUEUE, item);
        }
    }

    async getPendingCount() {
        return await db.count(STORES.OFFLINE_QUEUE, 'status', IDBKeyRange.only(QUEUE_STATUS.PENDING));
    }

    async getConflictCounts() {
        const pending = await db.count(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
        const resolved = await db.count(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.RESOLVED));
        const rejected = await db.count(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.REJECTED));
        
        return { pending, resolved, rejected };
    }

    async resolveConflict(conflictId, resolution) {
        const conflict = await db.get(STORES.CONFLICTS, conflictId);
        if (!conflict) throw new Error('冲突不存在');

        if (CURRENT_USER.role !== ROLES.ADMIN) {
            throw new Error('只有管理员可以复核冲突');
        }

        conflict.status = resolution === 'approve' ? CONFLICT_STATUS.RESOLVED : CONFLICT_STATUS.REJECTED;
        conflict.resolvedBy = CURRENT_USER.id;
        conflict.resolvedByName = CURRENT_USER.name;
        conflict.resolvedAt = Date.now();
        conflict.resolution = resolution;

        await db.put(STORES.CONFLICTS, conflict);

        const distribution = await db.get(STORES.DISTRIBUTIONS, conflict.distributionId);
        
        if (resolution === 'approve') {
            distribution.status = DISTRIBUTION_STATUS.SYNCED;
            distribution.syncedAt = Date.now();
            
            const supply = await db.get(STORES.SUPPLIES, distribution.supplyId);
            if (supply) {
                supply.currentStock = Math.max(0, supply.currentStock - distribution.quantity);
                await db.put(STORES.SUPPLIES, supply);
            }

            const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
            if (serverState) {
                const serverSupply = serverState.data.find(s => s.id === distribution.supplyId);
                if (serverSupply) {
                    serverSupply.currentStock = Math.max(0, serverSupply.currentStock - distribution.quantity);
                    await db.put(STORES.SERVER_STATE, serverState);
                }
            }
        } else {
            distribution.status = DISTRIBUTION_STATUS.CONFLICTED;
            distribution.rejected = true;
            distribution.rejectedReason = '管理员驳回';
        }

        await db.put(STORES.DISTRIBUTIONS, distribution);

        await addAuditLog('conflict_resolved', {
            conflictId,
            distributionId: conflict.distributionId,
            resolution,
            resolvedBy: CURRENT_USER.name
        });

        return conflict;
    }

    async retryFailedItems() {
        const failedItems = await db.getAll(
            STORES.OFFLINE_QUEUE,
            'status',
            IDBKeyRange.only(QUEUE_STATUS.FAILED)
        );

        for (const item of failedItems) {
            item.status = QUEUE_STATUS.PENDING;
            item.retryCount = 0;
            item.errorMessage = null;
            await db.put(STORES.OFFLINE_QUEUE, item);
        }

        if (this.isOnline) {
            this.processQueue();
        }

        return failedItems.length;
    }
}

const syncEngine = new SyncEngine();
