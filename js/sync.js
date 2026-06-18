class ImportEngine {
    constructor() {
        this.pendingImport = null;
    }

    parseCSV(content) {
        const lines = content.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV文件至少需要包含表头和1条数据');
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const requiredHeaders = ['居民姓名', '身份证号', '物资名称', '领取数量'];
        const headerMap = {};

        requiredHeaders.forEach(req => {
            const idx = headers.findIndex(h => h === req.toLowerCase());
            if (idx === -1) {
                throw new Error(`CSV缺少必需列: ${req}`);
            }
            headerMap[req] = idx;
        });

        const optionalHeaders = ['备注', '领取时间'];
        optionalHeaders.forEach(opt => {
            const idx = headers.findIndex(h => h === opt.toLowerCase());
            if (idx !== -1) {
                headerMap[opt] = idx;
            }
        });

        const records = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length < 4) continue;

            const record = {
                rowIndex: i,
                residentName: cols[headerMap['居民姓名']] || '',
                idCard: cols[headerMap['身份证号']] || '',
                supplyName: cols[headerMap['物资名称']] || '',
                quantity: parseInt(cols[headerMap['领取数量']]) || 0,
                notes: headerMap['备注'] !== undefined ? cols[headerMap['备注']] : '',
                timestamp: headerMap['领取时间'] !== undefined ? this.parseDate(cols[headerMap['领取时间']]) : Date.now()
            };
            records.push(record);
        }

        return records;
    }

    parseJSON(content) {
        let data;
        try {
            data = JSON.parse(content);
        } catch (e) {
            throw new Error('JSON格式解析失败: ' + e.message);
        }

        if (!Array.isArray(data)) {
            throw new Error('JSON数据必须是数组格式');
        }

        return data.map((item, idx) => ({
            rowIndex: idx + 1,
            residentName: item.residentName || item.居民姓名 || '',
            idCard: item.idCard || item.身份证号 || '',
            supplyName: item.supplyName || item.物资名称 || '',
            quantity: parseInt(item.quantity || item.领取数量) || 0,
            notes: item.notes || item.备注 || '',
            timestamp: item.timestamp || item.领取时间 ? this.parseDate(item.timestamp || item.领取时间) : Date.now()
        }));
    }

    parseDate(dateStr) {
        if (!dateStr) return Date.now();
        if (typeof dateStr === 'number') return dateStr;
        
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) return d.getTime();
        return Date.now();
    }

    async validateImportRecords(records, importSource) {
        const residents = await db.getAll(STORES.RESIDENTS);
        const supplies = await db.getAll(STORES.SUPPLIES);
        
        const residentMap = new Map();
        residents.forEach(r => {
            residentMap.set(r.idCard, r);
            residentMap.set(r.name.toLowerCase(), r);
        });

        const supplyMap = new Map();
        supplies.forEach(s => {
            supplyMap.set(s.name.toLowerCase(), s);
            supplyMap.set(s.id, s);
        });

        const validated = [];
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        for (const record of records) {
            const result = {
                ...record,
                valid: true,
                errors: [],
                warnings: [],
                resident: null,
                supply: null,
                conflictType: null,
                conflictData: null
            };

            if (!record.residentName) {
                result.valid = false;
                result.errors.push('缺少居民姓名');
            }
            if (!record.idCard) {
                result.valid = false;
                result.errors.push('缺少身份证号');
            }
            if (!record.supplyName) {
                result.valid = false;
                result.errors.push('缺少物资名称');
            }
            if (record.quantity <= 0) {
                result.valid = false;
                result.errors.push('领取数量必须大于0');
            }

            const resident = residentMap.get(record.idCard) || 
                           residentMap.get(record.residentName.toLowerCase());
            if (!resident) {
                result.valid = false;
                result.conflictType = CONFLICT_TYPES.INVALID_RESIDENT;
                result.errors.push(`居民不存在: ${record.residentName} (${record.idCard})`);
            } else {
                result.resident = resident;
            }

            const supply = supplyMap.get(record.supplyName.toLowerCase());
            if (!supply) {
                result.valid = false;
                result.conflictType = CONFLICT_TYPES.INVALID_SUPPLY;
                result.errors.push(`物资不存在: ${record.supplyName}`);
            } else {
                result.supply = supply;
            }

            if (result.valid && resident && supply) {
                if (record.quantity > supply.currentStock) {
                    result.valid = false;
                    result.conflictType = CONFLICT_TYPES.STOCK_OVERFLOW;
                    result.conflictData = {
                        local: { quantity: record.quantity },
                        server: { currentStock: supply.currentStock, available: supply.currentStock }
                    };
                    result.errors.push(`库存不足: ${supply.name} 当前库存 ${supply.currentStock}，申请 ${record.quantity}`);
                }

                const todayDistributions = await db.getAll(
                    STORES.DISTRIBUTIONS,
                    'resident_supply',
                    [resident.id, supply.id]
                );
                const todayQty = todayDistributions
                    .filter(d => d.timestamp >= todayStart.getTime() && !d.rejected)
                    .reduce((sum, d) => sum + d.quantity, 0);

                if (todayQty + record.quantity > supply.dailyLimit && result.valid) {
                    result.valid = false;
                    result.conflictType = CONFLICT_TYPES.DAILY_LIMIT_EXCEEDED;
                    result.conflictData = {
                        local: { quantity: record.quantity },
                        server: { 
                            todayQty,
                            dailyLimit: supply.dailyLimit,
                            available: supply.dailyLimit - todayQty
                        }
                    };
                    result.errors.push(`超过每日限领: ${resident.name} 今日已领 ${todayQty} ${supply.unit}，最多还可领 ${supply.dailyLimit - todayQty} ${supply.unit}`);
                }

                if (todayQty > 0 && result.conflictType !== CONFLICT_TYPES.DAILY_LIMIT_EXCEEDED) {
                    result.warnings.push(`今日已领取过 ${supply.name}，本次为追加领取`);
                }
            }

            if (!result.valid && !result.conflictType) {
                result.conflictType = CONFLICT_TYPES.IMPORT_VALIDATION_ERROR;
            }

            validated.push(result);
        }

        return validated;
    }

    async processImport(validatedRecords, importSource, batchId) {
        const results = {
            success: 0,
            conflicts: 0,
            errors: 0,
            imported: [],
            conflicted: [],
            batchId: batchId
        };

        for (const record of validatedRecords) {
            if (record.valid) {
                const distribution = {
                    id: generateId('dist'),
                    residentId: record.resident.id,
                    residentName: record.resident.name,
                    supplyId: record.supply.id,
                    supplyName: record.supply.name,
                    quantity: record.quantity,
                    status: DISTRIBUTION_STATUS.PENDING,
                    timestamp: record.timestamp,
                    operatorId: CURRENT_USER.id,
                    operatorName: CURRENT_USER.name,
                    notes: record.notes || null,
                    version: 1,
                    importSource: importSource,
                    importRow: record.rowIndex,
                    importedAt: Date.now(),
                    batchId: batchId
                };

                await db.put(STORES.DISTRIBUTIONS, distribution);
                await syncEngine.addToQueue('create_distribution', distribution);
                await addAuditLog('import_distribution', {
                    distributionId: distribution.id,
                    importSource,
                    rowIndex: record.rowIndex,
                    residentId: record.resident.id,
                    supplyId: record.supply.id,
                    quantity: record.quantity,
                    batchId: batchId
                });

                if (batchId) {
                    await batchEngine.addRecordToBatch(batchId, distribution.id, false);
                }

                results.success++;
                results.imported.push(distribution);
            } else {
                const conflictDist = {
                    id: generateId('dist'),
                    residentId: record.resident?.id,
                    residentName: record.residentName,
                    supplyId: record.supply?.id,
                    supplyName: record.supplyName,
                    quantity: record.quantity,
                    status: DISTRIBUTION_STATUS.CONFLICTED,
                    timestamp: record.timestamp,
                    operatorId: CURRENT_USER.id,
                    operatorName: CURRENT_USER.name,
                    notes: record.notes || null,
                    version: 1,
                    importSource: importSource,
                    importRow: record.rowIndex,
                    importedAt: Date.now(),
                    importErrors: record.errors,
                    batchId: batchId
                };

                await db.put(STORES.DISTRIBUTIONS, conflictDist);

                const conflict = {
                    id: generateId('conflict'),
                    distributionId: conflictDist.id,
                    conflictType: record.conflictType,
                    status: CONFLICT_STATUS.PENDING,
                    localData: {
                        ...conflictDist,
                        validationErrors: record.errors
                    },
                    serverData: record.conflictData || { message: record.errors.join('; ') },
                    timestamp: Date.now(),
                    resolvedBy: null,
                    resolvedAt: null,
                    importSource: importSource,
                    batchId: batchId
                };

                await db.put(STORES.CONFLICTS, conflict);
                conflictDist.conflictId = conflict.id;
                await db.put(STORES.DISTRIBUTIONS, conflictDist);

                await addAuditLog('import_conflict', {
                    conflictId: conflict.id,
                    distributionId: conflictDist.id,
                    importSource,
                    conflictType: record.conflictType,
                    errors: record.errors,
                    batchId: batchId
                });

                if (batchId) {
                    await batchEngine.addRecordToBatch(batchId, conflictDist.id, true, conflict.id);
                    await batchEngine.addFailedRecord(batchId, record.rowIndex, record.conflictType, record.errors.join('; '), {
                        residentName: record.residentName,
                        idCard: record.idCard,
                        supplyName: record.supplyName,
                        quantity: record.quantity
                    });
                }

                results.conflicts++;
                results.conflicted.push(conflict);
            }
        }

        syncEngine.onConflictDetected?.();
        
        return results;
    }

    getTemplateCSV() {
        return '\uFEFF居民姓名,身份证号,物资名称,领取数量,备注,领取时间\n' +
               '张三,110101199001011234,瓶装饮用水,2,测试备注,2024-01-15 10:30\n' +
               '李四,110101199102022345,应急药品包,1,,2024-01-15 11:00\n';
    }

    getTemplateJSON() {
        return JSON.stringify([
            {
                residentName: '张三',
                idCard: '110101199001011234',
                supplyName: '瓶装饮用水',
                quantity: 2,
                notes: '测试备注',
                timestamp: '2024-01-15 10:30'
            },
            {
                residentName: '李四',
                idCard: '110101199102022345',
                supplyName: '应急药品包',
                quantity: 1,
                notes: '',
                timestamp: '2024-01-15 11:00'
            }
        ], null, 2);
    }
}

const importEngine = new ImportEngine();

class SyncEngine {
    constructor() {
        this.isOnline = navigator.onLine;
        this.syncInterval = null;
        this.isSyncing = false;
        this.onSyncComplete = null;
        this.onConflictDetected = null;
        this.lastResolution = null;
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
                if (item.status === QUEUE_STATUS.CONFLICTED) continue;
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

        item.status = QUEUE_STATUS.CONFLICTED;
        item.conflictId = conflict.id;
        await db.put(STORES.OFFLINE_QUEUE, item);
        
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
        const pending = await db.count(STORES.OFFLINE_QUEUE, 'status', IDBKeyRange.only(QUEUE_STATUS.PENDING));
        const conflicted = await db.count(STORES.OFFLINE_QUEUE, 'status', IDBKeyRange.only(QUEUE_STATUS.CONFLICTED));
        return pending + conflicted;
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

        let effectiveRole = CURRENT_USER.role;
        try {
            const stored = localStorage.getItem(USER_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                effectiveRole = data.role || effectiveRole;
            }
        } catch (e) {}
        
        if (effectiveRole !== ROLES.ADMIN) {
            throw new Error('只有管理员可以复核冲突');
        }

        const distribution = await db.get(STORES.DISTRIBUTIONS, conflict.distributionId);
        const supply = distribution.supplyId ? await db.get(STORES.SUPPLIES, distribution.supplyId) : null;
        const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
        const serverSupply = serverState && distribution.supplyId 
            ? serverState.data.find(s => s.id === distribution.supplyId) 
            : null;

        const snapshot = {
            conflict: JSON.parse(JSON.stringify(conflict)),
            distribution: JSON.parse(JSON.stringify(distribution)),
            supplyBefore: supply ? JSON.parse(JSON.stringify(supply)) : null,
            serverSupplyBefore: serverSupply ? JSON.parse(JSON.stringify(serverSupply)) : null,
            resolution,
            timestamp: Date.now()
        };

        conflict.status = resolution === 'approve' ? CONFLICT_STATUS.RESOLVED : CONFLICT_STATUS.REJECTED;
        conflict.resolvedBy = CURRENT_USER.id;
        conflict.resolvedByName = CURRENT_USER.name;
        conflict.resolvedAt = Date.now();
        conflict.resolution = resolution;

        await db.put(STORES.CONFLICTS, conflict);

        if (resolution === 'approve') {
            distribution.status = DISTRIBUTION_STATUS.SYNCED;
            distribution.syncedAt = Date.now();
            distribution.resolvedBy = CURRENT_USER.id;
            distribution.resolvedByName = CURRENT_USER.name;
            distribution.resolvedAt = Date.now();
            
            if (supply) {
                supply.currentStock = Math.max(0, supply.currentStock - distribution.quantity);
                await db.put(STORES.SUPPLIES, supply);
            }

            if (serverState && serverSupply) {
                serverSupply.currentStock = Math.max(0, serverSupply.currentStock - distribution.quantity);
                await db.put(STORES.SERVER_STATE, serverState);
            }
        } else {
            distribution.status = DISTRIBUTION_STATUS.CONFLICTED;
            distribution.rejected = true;
            distribution.rejectedReason = '管理员驳回';
            distribution.resolvedBy = CURRENT_USER.id;
            distribution.resolvedByName = CURRENT_USER.name;
            distribution.resolvedAt = Date.now();
        }

        await db.put(STORES.DISTRIBUTIONS, distribution);

        const queueItems = await db.getAll(STORES.OFFLINE_QUEUE, 'status', IDBKeyRange.only(QUEUE_STATUS.CONFLICTED));
        for (const qItem of queueItems) {
            if (qItem.conflictId === conflictId) {
                await db.delete(STORES.OFFLINE_QUEUE, qItem.id);
            }
        }

        this.lastResolution = snapshot;
        await this.saveLastResolution(snapshot);

        await addAuditLog('conflict_resolved', {
            conflictId,
            distributionId: conflict.distributionId,
            resolution,
            resolvedBy: CURRENT_USER.name
        });

        return conflict;
    }

    async saveLastResolution(snapshot) {
        await db.put(STORES.SERVER_STATE, {
            id: 'last_resolution',
            data: snapshot,
            timestamp: Date.now()
        });
    }

    async loadLastResolution() {
        const stored = await db.get(STORES.SERVER_STATE, 'last_resolution');
        if (stored) {
            this.lastResolution = stored.data;
        }
        return this.lastResolution;
    }

    async hasUndoableResolution() {
        const last = this.lastResolution || await this.loadLastResolution();
        return !!last;
    }

    async undoLastResolution() {
        const snapshot = this.lastResolution || await this.loadLastResolution();
        if (!snapshot) {
            throw new Error('没有可撤销的操作');
        }

        let effectiveRole = CURRENT_USER.role;
        try {
            const stored = localStorage.getItem(USER_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                effectiveRole = data.role || effectiveRole;
            }
        } catch (e) {}
        
        if (effectiveRole !== ROLES.ADMIN) {
            throw new Error('只有管理员可以撤销操作');
        }

        const { conflict, distribution, supplyBefore, serverSupplyBefore, resolution } = snapshot;

        const conflictRestored = {
            ...conflict,
            status: CONFLICT_STATUS.PENDING,
            resolvedBy: null,
            resolvedByName: null,
            resolvedAt: null,
            resolution: null
        };
        await db.put(STORES.CONFLICTS, conflictRestored);

        const cleanDist = {};
        for (const key of Object.keys(distribution)) {
            if (key !== 'rejected' && key !== 'rejectedReason' && 
                key !== 'resolvedBy' && key !== 'resolvedByName' && 
                key !== 'resolvedAt' && key !== 'syncedAt') {
                cleanDist[key] = distribution[key];
            }
        }
        cleanDist.status = DISTRIBUTION_STATUS.CONFLICTED;
        
        await db.put(STORES.DISTRIBUTIONS, cleanDist);

        if (resolution === 'approve' && supplyBefore) {
            await db.put(STORES.SUPPLIES, supplyBefore);
        }

        if (resolution === 'approve' && serverSupplyBefore) {
            const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
            if (serverState) {
                const idx = serverState.data.findIndex(s => s.id === serverSupplyBefore.id);
                if (idx >= 0) {
                    serverState.data[idx] = serverSupplyBefore;
                    await db.put(STORES.SERVER_STATE, serverState);
                }
            }
        }

        const queueItem = {
            id: generateId('queue'),
            action: 'update_distribution',
            data: cleanDist,
            status: QUEUE_STATUS.CONFLICTED,
            conflictId: conflict.id,
            timestamp: Date.now(),
            retryCount: 0,
            errorMessage: null
        };
        await db.put(STORES.OFFLINE_QUEUE, queueItem);

        this.lastResolution = null;
        await db.delete(STORES.SERVER_STATE, 'last_resolution');

        await addAuditLog('conflict_undo', {
            conflictId: conflict.id,
            distributionId: distribution.id,
            originalResolution: resolution,
            undoneBy: CURRENT_USER.name
        });

        return conflictRestored;
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

class BatchEngine {
    constructor() {
        this.onBatchUpdated = null;
    }

    async generateFileHash(content) {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async checkDuplicateImport(fileHash) {
        const existingBatches = await db.getAll(STORES.BATCHES, 'fileHash', IDBKeyRange.only(fileHash));
        return existingBatches.length > 0 ? existingBatches[0] : null;
    }

    async createBatch(importSource, fileName, fileHash, totalRecords) {
        const batch = {
            id: generateId('batch'),
            source: importSource,
            fileName: fileName,
            fileHash: fileHash,
            status: BATCH_STATUS.PROCESSING,
            createdBy: CURRENT_USER.id,
            createdByName: CURRENT_USER.name,
            timestamp: Date.now(),
            totalRecords: totalRecords,
            successCount: 0,
            conflictCount: 0,
            revokedCount: 0,
            failedRecords: [],
            distributionIds: [],
            conflictIds: [],
            notes: null
        };

        await db.put(STORES.BATCHES, batch);

        await addAuditLog('batch_created', {
            batchId: batch.id,
            source: importSource,
            fileName: fileName,
            totalRecords
        });

        return batch;
    }

    async updateBatchStats(batchId, updates) {
        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) return null;

        Object.assign(batch, updates);

        if (batch.successCount + batch.conflictCount >= batch.totalRecords) {
            if (batch.conflictCount > 0) {
                batch.status = BATCH_STATUS.PARTIAL;
            } else {
                batch.status = BATCH_STATUS.COMPLETED;
            }
        }

        await db.put(STORES.BATCHES, batch);

        if (this.onBatchUpdated) {
            this.onBatchUpdated(batch);
        }

        return batch;
    }

    async addRecordToBatch(batchId, distributionId, isConflict = false, conflictId = null) {
        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) return;

        batch.distributionIds.push(distributionId);

        if (isConflict) {
            batch.conflictCount++;
            if (conflictId) {
                batch.conflictIds.push(conflictId);
            }
        } else {
            batch.successCount++;
        }

        if (batch.successCount + batch.conflictCount >= batch.totalRecords) {
            if (batch.conflictCount > 0) {
                batch.status = BATCH_STATUS.PARTIAL;
            } else {
                batch.status = BATCH_STATUS.COMPLETED;
            }
        }

        await db.put(STORES.BATCHES, batch);

        if (this.onBatchUpdated) {
            this.onBatchUpdated(batch);
        }
    }

    async addFailedRecord(batchId, recordIndex, errorType, errorMessage, recordData) {
        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) return;

        batch.failedRecords.push({
            index: recordIndex,
            type: errorType,
            message: errorMessage,
            data: recordData
        });

        await db.put(STORES.BATCHES, batch);
    }

    async getBatch(batchId) {
        return await db.get(STORES.BATCHES, batchId);
    }

    async getBatches(filters = {}) {
        let batches = await db.getAll(STORES.BATCHES, 'timestamp');
        batches.sort((a, b) => b.timestamp - a.timestamp);

        if (filters.status && filters.status !== 'all') {
            batches = batches.filter(b => b.status === filters.status);
        }

        if (filters.source && filters.source !== 'all') {
            batches = batches.filter(b => b.source === filters.source);
        }

        if (filters.startDate) {
            const start = new Date(filters.startDate).setHours(0, 0, 0, 0);
            batches = batches.filter(b => b.timestamp >= start);
        }

        if (filters.endDate) {
            const end = new Date(filters.endDate).setHours(23, 59, 59, 999);
            batches = batches.filter(b => b.timestamp <= end);
        }

        return batches;
    }

    async getBatchDistributions(batchId) {
        return await db.getAll(STORES.DISTRIBUTIONS, 'batchId', IDBKeyRange.only(batchId));
    }

    async getBatchConflicts(batchId) {
        return await db.getAll(STORES.CONFLICTS, 'batchId', IDBKeyRange.only(batchId));
    }

    async getBatchPendingConflicts(batchId) {
        const conflicts = await this.getBatchConflicts(batchId);
        return conflicts.filter(c => c.status === CONFLICT_STATUS.PENDING);
    }

    async batchApprove(batchId) {
        if (CURRENT_USER.role !== ROLES.ADMIN) {
            throw new Error('只有管理员可以批量通过');
        }

        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) throw new Error('批次不存在');

        const pendingConflicts = await this.getBatchPendingConflicts(batchId);
        let approvedCount = 0;

        for (const conflict of pendingConflicts) {
            await syncEngine.resolveConflict(conflict.id, 'approve');
            approvedCount++;
        }

        await addAuditLog('batch_approve', {
            batchId,
            approvedCount,
            batchName: batch.fileName
        });

        return approvedCount;
    }

    async batchReject(batchId) {
        if (CURRENT_USER.role !== ROLES.ADMIN) {
            throw new Error('只有管理员可以批量驳回');
        }

        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) throw new Error('批次不存在');

        const pendingConflicts = await this.getBatchPendingConflicts(batchId);
        let rejectedCount = 0;

        for (const conflict of pendingConflicts) {
            await syncEngine.resolveConflict(conflict.id, 'reject');
            rejectedCount++;
        }

        await addAuditLog('batch_reject', {
            batchId,
            rejectedCount,
            batchName: batch.fileName
        });

        return rejectedCount;
    }

    async retryFailedRecords(batchId) {
        if (CURRENT_USER.role !== ROLES.ADMIN) {
            throw new Error('只有管理员可以重试失败项');
        }

        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) throw new Error('批次不存在');

        const pendingConflicts = await this.getBatchPendingConflicts(batchId);
        let retriedCount = 0;

        for (const conflict of pendingConflicts) {
            const dist = await db.get(STORES.DISTRIBUTIONS, conflict.distributionId);
            if (dist) {
                const revalidate = await this.revalidateDistribution(dist);
                if (revalidate.success) {
                    await db.delete(STORES.CONFLICTS, conflict.id);

                dist.status = DISTRIBUTION_STATUS.PENDING;
                dist.batchId = batchId;
                await db.put(STORES.DISTRIBUTIONS, dist);

                await syncEngine.addToQueue('create_distribution', dist);
                retriedCount++;
                }
            }
        }

        await addAuditLog('batch_retry', {
            batchId,
            retriedCount,
            batchName: batch.fileName
        });

        return retriedCount;
    }

    async revalidateDistribution(distribution) {
        const resident = distribution.residentId ? await db.get(STORES.RESIDENTS, distribution.residentId) : null;
        const supply = distribution.supplyId ? await db.get(STORES.SUPPLIES, distribution.supplyId) : null;

        if (!resident || !supply) {
            return { success: false, error: '居民或物资不存在' };
        }

        if (distribution.quantity > supply.currentStock) {
            return { success: false, error: '库存不足' };
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todayDistributions = await db.getAll(
            STORES.DISTRIBUTIONS,
            'resident_supply',
            [resident.id, supply.id]
        );

        const todayQty = todayDistributions
            .filter(d => d.timestamp >= todayStart.getTime() && !d.rejected && d.id !== distribution.id)
            .reduce((sum, d) => sum + d.quantity, 0);

        if (todayQty + distribution.quantity > supply.dailyLimit) {
            return { success: false, error: '超过每日限领' };
        }

        return { success: true };
    }

    async revokeBatch(batchId) {
        if (CURRENT_USER.role !== ROLES.ADMIN) {
            throw new Error('只有管理员可以撤销批次');
        }

        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) throw new Error('批次不存在');

        const distributions = await this.getBatchDistributions(batchId);
        const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
        let revokedCount = 0;

        for (const dist of distributions) {
            if (dist.status === DISTRIBUTION_STATUS.SYNCED && !dist.rejected) {
                const supply = dist.supplyId ? await db.get(STORES.SUPPLIES, dist.supplyId) : null;
                const serverSupply = serverState && dist.supplyId
                    ? serverState.data.find(s => s.id === dist.supplyId)
                    : null;

                if (supply) {
                    supply.currentStock = Math.min(supply.totalStock, supply.currentStock + dist.quantity);
                    await db.put(STORES.SUPPLIES, supply);
                }

                if (serverSupply) {
                    serverSupply.currentStock = Math.min(serverSupply.totalStock, serverSupply.currentStock + dist.quantity);
                }

                dist.revoked = true;
                dist.revokedAt = Date.now();
                dist.revokedBy = CURRENT_USER.id;
                dist.revokedByName = CURRENT_USER.name;
                dist.status = DISTRIBUTION_STATUS.CONFLICTED;
                await db.put(STORES.DISTRIBUTIONS, dist);

                revokedCount++;
            } else if (dist.status === DISTRIBUTION_STATUS.PENDING) {
                dist.revoked = true;
                dist.revokedAt = Date.now();
                dist.revokedBy = CURRENT_USER.id;
                dist.revokedByName = CURRENT_USER.name;
                await db.put(STORES.DISTRIBUTIONS, dist);

                revokedCount++;
            }
        }

        if (serverState) {
            await db.put(STORES.SERVER_STATE, serverState);
        }

        batch.status = BATCH_STATUS.REVOKED;
        batch.revokedCount = revokedCount;
        batch.revokedAt = Date.now();
        batch.revokedBy = CURRENT_USER.id;
        batch.revokedByName = CURRENT_USER.name;
        await db.put(STORES.BATCHES, batch);

        const conflicts = await this.getBatchConflicts(batchId);
        for (const conflict of conflicts) {
            if (conflict.status === CONFLICT_STATUS.PENDING) {
                conflict.status = CONFLICT_STATUS.REJECTED;
                conflict.resolvedBy = CURRENT_USER.id;
                conflict.resolvedByName = CURRENT_USER.name;
                conflict.resolvedAt = Date.now();
                conflict.resolution = 'reject';
                await db.put(STORES.CONFLICTS, conflict);

                const conflictDist = await db.get(STORES.DISTRIBUTIONS, conflict.distributionId);
                if (conflictDist) {
                    conflictDist.rejected = true;
                    conflictDist.rejectedReason = '批次撤销';
                    conflictDist.resolvedBy = CURRENT_USER.id;
                    conflictDist.resolvedByName = CURRENT_USER.name;
                    conflictDist.resolvedAt = Date.now();
                    await db.put(STORES.DISTRIBUTIONS, conflictDist);
                }
            }
        }

        await addAuditLog('batch_revoke', {
            batchId,
            revokedCount,
            batchName: batch.fileName
        });

        return revokedCount;
    }

    async getBatchStats() {
        const batches = await db.getAll(STORES.BATCHES);

        return {
            total: batches.length,
            processing: batches.filter(b => b.status === BATCH_STATUS.PROCESSING).length,
            completed: batches.filter(b => b.status === BATCH_STATUS.COMPLETED).length,
            partial: batches.filter(b => b.status === BATCH_STATUS.PARTIAL).length,
            revoked: batches.filter(b => b.status === BATCH_STATUS.REVOKED).length
        };
    }
}

const batchEngine = new BatchEngine();
