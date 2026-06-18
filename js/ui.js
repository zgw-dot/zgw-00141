function showToast(message, duration = 2000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

let currentView = 'dashboard';
let selectedResident = null;
let selectedSupply = null;
let selectedQuantity = 1;
let currentConflict = null;

function navigateTo(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    const targetNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (targetNav) {
        targetNav.classList.add('active');
    }
    
    currentView = viewName;
    
    const titles = {
        dashboard: '物资签到',
        distribute: '物资领取',
        conflicts: '冲突复核',
        batches: '导入中心',
        history: '领取记录',
        export: '审计导出',
        supplies: '物资配置'
    };
    
    const titleEl = document.getElementById('page-title');
    if (titleEl && titles[viewName]) {
        titleEl.textContent = titles[viewName];
    }
    
    if (viewName === 'dashboard') {
        refreshDashboard();
    } else if (viewName === 'distribute') {
        refreshDistributeView();
    } else if (viewName === 'conflicts') {
        refreshConflictsView();
    } else if (viewName === 'batches') {
        refreshBatchesView();
    } else if (viewName === 'history') {
        refreshHistoryView();
    } else if (viewName === 'export') {
        refreshExportView();
    } else if (viewName === 'supplies') {
        refreshSuppliesView();
    }
}

async function refreshDashboard() {
    await refreshStats();
    await refreshRecentList();
    await updateConflictBadge();
}

async function refreshStats() {
    const supplies = await db.getAll(STORES.SUPPLIES);
    
    const water = supplies.find(s => s.category === 'water');
    const medicine = supplies.find(s => s.category === 'medicine');
    const power = supplies.find(s => s.category === 'power');
    
    const waterEl = document.getElementById('stat-water');
    const medicineEl = document.getElementById('stat-medicine');
    const powerEl = document.getElementById('stat-power');
    const syncEl = document.getElementById('stat-sync');
    
    if (waterEl) waterEl.textContent = water ? water.currentStock : 0;
    if (medicineEl) medicineEl.textContent = medicine ? medicine.currentStock : 0;
    if (powerEl) powerEl.textContent = power ? power.currentStock : 0;
    
    const pendingCount = await syncEngine.getPendingCount();
    if (syncEl) syncEl.textContent = pendingCount;
    
    const conflictCounts = await syncEngine.getConflictCounts();
    const alertSection = document.getElementById('alert-section');
    const conflictCountDesc = document.getElementById('conflict-count-desc');
    
    if (alertSection && conflictCounts.pending > 0) {
        alertSection.style.display = 'block';
        if (conflictCountDesc) {
            conflictCountDesc.textContent = `${conflictCounts.pending} 条记录需要复核`;
        }
    } else if (alertSection) {
        alertSection.style.display = 'none';
    }

    const partialBatches = await batchEngine.getBatches({ status: BATCH_STATUS.PARTIAL });
    const processingBatches = await batchEngine.getBatches({ status: BATCH_STATUS.PROCESSING });
    const allPendingBatches = [...partialBatches, ...processingBatches].sort((a, b) => b.timestamp - a.timestamp);
    const batchAlertSection = document.getElementById('batch-alert-section');
    const batchAlertDesc = document.getElementById('batch-alert-desc');
    const batchAlertBtn = document.getElementById('batch-alert-btn');
    
    const pendingBatchCount = allPendingBatches.length;
    if (batchAlertSection && pendingBatchCount > 0) {
        batchAlertSection.style.display = 'block';
        pendingAlertBatchId = allPendingBatches[0].id;
        if (batchAlertDesc) {
            const firstBatch = allPendingBatches[0];
            const conflictCount = firstBatch.conflictCount || 0;
            batchAlertDesc.textContent = `${pendingBatchCount} 个批次需要处理 · ${firstBatch.fileName} 有 ${conflictCount} 条待复核`;
        }
        if (batchAlertBtn) {
            batchAlertBtn.onclick = () => navigateToBatch(pendingAlertBatchId);
        }
    } else if (batchAlertSection) {
        batchAlertSection.style.display = 'none';
        pendingAlertBatchId = null;
    }
}

async function refreshRecentList() {
    const listEl = document.getElementById('recent-list');
    if (!listEl) return;
    
    const distributions = await db.getAll(STORES.DISTRIBUTIONS, 'timestamp');
    const recent = distributions.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
    
    if (recent.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-text">暂无领取记录</div>
            </div>
        `;
        return;
    }
    
    const supplies = await db.getAll(STORES.SUPPLIES);
    const residents = await db.getAll(STORES.RESIDENTS);
    
    const supplyMap = new Map(supplies.map(s => [s.id, s]));
    const residentMap = new Map(residents.map(r => [r.id, r]));
    
    listEl.innerHTML = recent.map(d => {
        const resident = residentMap.get(d.residentId);
        const supply = supplyMap.get(d.supplyId);
        let statusClass, statusText;
        if (d.rejected) {
            statusClass = 'conflicted';
            statusText = '已驳回';
        } else if (d.status === DISTRIBUTION_STATUS.SYNCED) {
            statusClass = 'synced';
            statusText = '已同步';
        } else if (d.status === DISTRIBUTION_STATUS.PENDING) {
            statusClass = 'pending';
            statusText = '待同步';
        } else {
            statusClass = 'conflicted';
            statusText = '冲突';
        }
        
        return `
            <div class="recent-item">
                <div class="recent-avatar">${resident ? resident.name.charAt(0) : '?'}</div>
                <div class="recent-info">
                    <div class="recent-name">${resident ? resident.name : '未知居民'}</div>
                    <div class="recent-supply">${supply ? supply.name : '未知物资'} × ${d.quantity}${supply ? supply.unit : ''}</div>
                </div>
                <div class="recent-status">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                    <div class="recent-time">${formatDate(d.timestamp)}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function updateConflictBadge() {
    const conflictCounts = await syncEngine.getConflictCounts();
    const badge = document.getElementById('conflict-badge');
    
    if (badge) {
        if (conflictCounts.pending > 0) {
            badge.style.display = 'flex';
            badge.textContent = conflictCounts.pending > 99 ? '99+' : conflictCounts.pending;
        } else {
            badge.style.display = 'none';
        }
    }
}

async function refreshDistributeView() {
    await refreshResidentList();
    await refreshSupplyList();
    checkSubmitButton();
}

async function refreshResidentList() {
    const residents = await db.getAll(STORES.RESIDENTS);
    const listEl = document.getElementById('resident-list');
    const searchEl = document.getElementById('resident-search');
    
    if (!listEl) return;
    
    const renderResidents = (list) => {
        if (list.length === 0) {
            listEl.innerHTML = '<div class="resident-item" style="color: var(--text-muted);">未找到居民</div>';
            return;
        }
        
        listEl.innerHTML = list.map(r => `
            <div class="resident-item" onclick="selectResident('${r.id}')">
                <div class="resident-item-avatar">${r.name.charAt(0)}</div>
                <div class="resident-item-info">
                    <div class="resident-item-name">${r.name}</div>
                    <div class="resident-item-id">${maskIdCard(r.idCard)}</div>
                </div>
            </div>
        `).join('');
    };
    
    renderResidents(residents);
    
    if (searchEl) {
        searchEl.oninput = (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query) {
                const filtered = residents.filter(r => 
                    r.name.toLowerCase().includes(query) || 
                    r.idCard.includes(query)
                );
                renderResidents(filtered);
                listEl.classList.add('active');
            } else {
                renderResidents(residents);
                listEl.classList.remove('active');
            }
        };
        
        searchEl.onfocus = () => {
            if (searchEl.value) {
                listEl.classList.add('active');
            }
        };
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.resident-selector')) {
                listEl.classList.remove('active');
            }
        });
    }
}

async function selectResident(residentId) {
    const resident = await db.get(STORES.RESIDENTS, residentId);
    if (!resident) return;
    
    selectedResident = resident;
    
    const selectorEl = document.getElementById('resident-selector');
    const selectedEl = document.getElementById('selected-resident');
    const avatarEl = document.getElementById('resident-avatar');
    const nameEl = document.getElementById('resident-name');
    const idEl = document.getElementById('resident-id');
    
    if (selectorEl) selectorEl.style.display = 'none';
    if (selectedEl) selectedEl.style.display = 'flex';
    if (avatarEl) avatarEl.textContent = resident.name.charAt(0);
    if (nameEl) nameEl.textContent = resident.name;
    if (idEl) idEl.textContent = maskIdCard(resident.idCard);
    
    document.getElementById('resident-list').classList.remove('active');
    document.getElementById('resident-search').value = '';
    
    checkSubmitButton();
}

function clearResident() {
    selectedResident = null;
    
    const selectorEl = document.getElementById('resident-selector');
    const selectedEl = document.getElementById('selected-resident');
    
    if (selectorEl) selectorEl.style.display = 'block';
    if (selectedEl) selectedEl.style.display = 'none';
    
    checkSubmitButton();
}

async function refreshSupplyList() {
    const supplies = await db.getAll(STORES.SUPPLIES);
    const listEl = document.getElementById('supply-list');
    
    if (!listEl) return;
    
    listEl.innerHTML = supplies.map(s => {
        const disabled = s.currentStock <= 0;
        const selected = selectedSupply && selectedSupply.id === s.id;
        
        return `
            <div class="supply-item ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" 
                 onclick="${disabled ? '' : `selectSupply('${s.id}')`}">
                <div class="supply-icon ${s.category}">${s.icon}</div>
                <div class="supply-info">
                    <div class="supply-name">${s.name}</div>
                    <div class="supply-stock">库存: ${s.currentStock} ${s.unit} | 每日限领: ${s.dailyLimit} ${s.unit}</div>
                </div>
                <div class="supply-check">✓</div>
            </div>
        `;
    }).join('');
}

async function selectSupply(supplyId) {
    const supply = await db.get(STORES.SUPPLIES, supplyId);
    if (!supply || supply.currentStock <= 0) return;
    
    selectedSupply = supply;
    selectedQuantity = 1;
    
    await refreshSupplyList();
    
    const qtyGroup = document.getElementById('quantity-group');
    const qtyInput = document.getElementById('quantity-input');
    const currentStockEl = document.getElementById('current-stock');
    
    if (qtyGroup) qtyGroup.style.display = 'block';
    if (qtyInput) qtyInput.value = 1;
    if (currentStockEl) currentStockEl.textContent = `${supply.currentStock} ${supply.unit}`;
    
    checkSubmitButton();
}

function changeQuantity(delta) {
    if (!selectedSupply) return;
    
    const newQty = selectedQuantity + delta;
    const maxQty = Math.min(selectedSupply.currentStock, selectedSupply.dailyLimit);
    
    if (newQty >= 1 && newQty <= maxQty) {
        selectedQuantity = newQty;
        document.getElementById('quantity-input').value = selectedQuantity;
    }
}

function checkSubmitButton() {
    const btn = document.getElementById('submit-btn');
    if (btn) {
        btn.disabled = !selectedResident || !selectedSupply || selectedQuantity <= 0;
    }
}

async function submitDistribution() {
    if (!selectedResident || !selectedSupply) return;
    
    const errorEl = document.getElementById('distribute-error');
    
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        const todayDistributions = await db.getAll(
            STORES.DISTRIBUTIONS, 
            'resident_supply', 
            [selectedResident.id, selectedSupply.id]
        );
        
        const todayQty = todayDistributions
            .filter(d => d.timestamp >= todayStart.getTime() && !d.rejected)
            .reduce((sum, d) => sum + d.quantity, 0);
        
        if (todayQty + selectedQuantity > selectedSupply.dailyLimit) {
            throw new Error(`该居民今日已领取 ${todayQty} ${selectedSupply.unit}，今日最多还可领取 ${selectedSupply.dailyLimit - todayQty} ${selectedSupply.unit}`);
        }
        
        if (selectedQuantity > selectedSupply.currentStock) {
            throw new Error(`库存不足，当前库存 ${selectedSupply.currentStock} ${selectedSupply.unit}`);
        }
        
        const distribution = {
            id: generateId('dist'),
            residentId: selectedResident.id,
            residentName: selectedResident.name,
            supplyId: selectedSupply.id,
            supplyName: selectedSupply.name,
            quantity: selectedQuantity,
            status: DISTRIBUTION_STATUS.PENDING,
            timestamp: Date.now(),
            operatorId: CURRENT_USER.id,
            operatorName: CURRENT_USER.name,
            notes: document.getElementById('distribution-notes').value.trim() || null,
            version: 1,
            importSource: IMPORT_SOURCES.MANUAL
        };
        
        await db.put(STORES.DISTRIBUTIONS, distribution);
        
        await syncEngine.addToQueue('create_distribution', distribution);
        
        await addAuditLog('create_distribution', {
            distributionId: distribution.id,
            residentId: selectedResident.id,
            supplyId: selectedSupply.id,
            quantity: selectedQuantity
        });
        
        showToast('领取记录已提交');
        
        selectedResident = null;
        selectedSupply = null;
        selectedQuantity = 1;
        document.getElementById('distribution-notes').value = '';
        
        navigateTo('dashboard');
        
    } catch (error) {
        if (errorEl) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 3000);
        }
        console.error('Submit error:', error);
    }
}

function getConflictDescription(conflict) {
    switch (conflict.conflictType) {
        case CONFLICT_TYPES.STOCK_OVERFLOW:
            return `本地申请 ${conflict.serverData?.local?.quantity || 0}，服务端库存仅 ${conflict.serverData?.server?.available || 0}`;
        case CONFLICT_TYPES.DUPLICATE_DISTRIBUTION:
            return '该居民今日已领取过此项物资';
        case CONFLICT_TYPES.VERSION_CONFLICT:
            return '数据版本冲突，请核对后决定';
        case CONFLICT_TYPES.PERMISSION_DENIED:
            return conflict.serverData?.message || '权限不足';
        default:
            return '未知冲突类型';
    }
}

async function openConflictModal(conflictId) {
    const conflict = await db.get(STORES.CONFLICTS, conflictId);
    if (!conflict) return;
    
    currentConflict = conflict;
    
    const distribution = await db.get(STORES.DISTRIBUTIONS, conflict.distributionId);
    const resident = await db.get(STORES.RESIDENTS, distribution.residentId);
    const supply = await db.get(STORES.SUPPLIES, distribution.supplyId);
    
    const modal = document.getElementById('conflict-modal');
    const body = document.getElementById('conflict-modal-body');
    
    if (!body) return;
    
    const isVolunteer = CURRENT_USER.role === ROLES.VOLUNTEER;
    
    body.innerHTML = `
        <div class="conflict-detail-section">
            <div class="conflict-detail-title">基本信息</div>
            <div class="data-row">
                <span class="data-row-label">居民</span>
                <span class="data-row-value">${resident ? resident.name : '未知'}</span>
            </div>
            <div class="data-row">
                <span class="data-row-label">物资</span>
                <span class="data-row-value">${supply ? supply.name : '未知'}</span>
            </div>
            <div class="data-row">
                <span class="data-row-label">申请数量</span>
                <span class="data-row-value">${distribution.quantity} ${supply ? supply.unit : ''}</span>
            </div>
            <div class="data-row">
                <span class="data-row-label">申请时间</span>
                <span class="data-row-value">${formatDate(distribution.timestamp)}</span>
            </div>
        </div>
        
        <div class="conflict-detail-section">
            <div class="conflict-detail-title">冲突详情</div>
            <div class="conflict-data-compare">
                <div class="data-card local">
                    <div class="data-card-title">本地数据</div>
                    <div class="data-card-content">
                        ${renderConflictData(conflict.localData, 'local')}
                    </div>
                </div>
                <div class="data-card server">
                    <div class="data-card-title">服务端数据</div>
                    <div class="data-card-content">
                        ${renderConflictData(conflict.serverData, 'server')}
                    </div>
                </div>
            </div>
        </div>
        
        ${isVolunteer ? `
        <div class="conflict-detail-section" style="color: var(--danger); font-size: 12px; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">
            ⚠️ 您当前是志愿者身份，无权复核冲突。请联系管理员处理。
        </div>
        ` : ''}
    `;
    
    const approveBtn = modal.querySelector('.modal-btn.approve');
    const rejectBtn = modal.querySelector('.modal-btn.reject');
    
    if (approveBtn) approveBtn.disabled = isVolunteer;
    if (rejectBtn) rejectBtn.disabled = isVolunteer;
    
    modal.style.display = 'flex';
}

function renderConflictData(data, type) {
    if (!data) return '<div style="color: var(--text-muted);">无数据</div>';
    
    const entries = Object.entries(data);
    return entries.map(([key, value]) => {
        const label = formatFieldLabel(key);
        const displayValue = formatFieldValue(key, value);
        return `
            <div class="data-row">
                <span class="data-row-label">${label}</span>
                <span class="data-row-value">${displayValue}</span>
            </div>
        `;
    }).join('');
}

function formatFieldLabel(key) {
    const labels = {
        quantity: '数量',
        currentStock: '当前库存',
        available: '可领数量',
        residentId: '居民ID',
        supplyId: '物资ID',
        timestamp: '时间',
        message: '说明'
    };
    return labels[key] || key;
}

function formatFieldValue(key, value) {
    if (key === 'timestamp' && typeof value === 'number') {
        return formatDate(value);
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

function closeConflictModal() {
    const modal = document.getElementById('conflict-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentConflict = null;
}

async function resolveConflict(resolution) {
    if (!currentConflict) return;
    
    try {
        await syncEngine.resolveConflict(currentConflict.id, resolution);
        
        showToast(resolution === 'approve' ? '已批准本地数据' : '已驳回本地数据');
        closeConflictModal();
        refreshConflictsView();
        refreshDashboard();
        
    } catch (error) {
        showToast(error.message);
        console.error('Resolve conflict error:', error);
    }
}

async function refreshHistoryView() {
    await populateSupplyFilter();
    await populateBatchFilter();
    await filterHistory();
}

async function populateSupplyFilter() {
    const supplies = await db.getAll(STORES.SUPPLIES);
    const selectEl = document.getElementById('filter-supply');
    
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="all">全部物资</option>' +
        supplies.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

async function populateBatchFilter() {
    const batches = await db.getAll(STORES.BATCHES, 'timestamp');
    const selectEl = document.getElementById('filter-batch');
    
    if (!selectEl) return;
    
    const batchOptions = batches.slice(0, 20).map(b => 
        `<option value="${b.id}">${b.fileName} (${formatDate(b.timestamp)})</option>`
    ).join('');
    
    selectEl.innerHTML = '<option value="all">全部批次</option>' + batchOptions;
}

async function filterHistory() {
    const statusFilter = document.getElementById('filter-status')?.value || 'all';
    const supplyFilter = document.getElementById('filter-supply')?.value || 'all';
    const batchFilter = document.getElementById('filter-batch')?.value || 'all';
    
    let distributions = await db.getAll(STORES.DISTRIBUTIONS, 'timestamp');
    distributions.sort((a, b) => b.timestamp - a.timestamp);
    
    if (statusFilter !== 'all') {
        if (statusFilter === 'conflicted') {
            distributions = distributions.filter(d => d.status === DISTRIBUTION_STATUS.CONFLICTED && !d.rejected);
        } else {
            distributions = distributions.filter(d => d.status === statusFilter);
        }
    }
    
    if (supplyFilter !== 'all') {
        distributions = distributions.filter(d => d.supplyId === supplyFilter);
    }
    
    if (batchFilter !== 'all') {
        distributions = distributions.filter(d => d.batchId === batchFilter);
    }
    
    const listEl = document.getElementById('history-list');
    if (!listEl) return;
    
    if (distributions.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📋</div>
                <div class="empty-text">暂无记录</div>
            </div>
        `;
        return;
    }
    
    const supplies = await db.getAll(STORES.SUPPLIES);
    const supplyMap = new Map(supplies.map(s => [s.id, s]));
    
    listEl.innerHTML = distributions.map(d => {
        const supply = supplyMap.get(d.supplyId);
        let statusClass, statusText;
        if (d.revoked) {
            statusClass = 'conflicted';
            statusText = '已撤销';
        } else if (d.rejected) {
            statusClass = 'conflicted';
            statusText = '已驳回';
        } else if (d.status === DISTRIBUTION_STATUS.SYNCED) {
            statusClass = 'synced';
            statusText = '已同步';
        } else if (d.status === DISTRIBUTION_STATUS.PENDING) {
            statusClass = 'pending';
            statusText = '待同步';
        } else {
            statusClass = 'conflicted';
            statusText = '冲突';
        }
        const sourceBadge = d.importSource 
            ? `<span class="conflict-source" style="background: rgba(6, 182, 212, 0.1); color: var(--info); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px;">${getImportSourceLabel(d.importSource)}</span>`
            : '';
        const batchBadge = d.batchId
            ? `<span class="conflict-source" style="background: rgba(37, 99, 235, 0.1); color: var(--primary); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; cursor: pointer;" onclick="event.stopPropagation(); navigateToBatch('${d.batchId}')">批次: ${d.batchId.slice(-8)}</span>`
            : '';
        
        return `
            <div class="history-item">
                <div class="history-header">
                    <div class="history-name">${d.residentName || '未知居民'}${sourceBadge}${batchBadge}</div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="history-supply">${d.supplyName || '未知物资'}</div>
                <div class="history-quantity">领取数量: ${d.quantity} ${supply ? supply.unit : ''}</div>
                ${d.notes ? `<div class="history-quantity" style="color: var(--text-secondary); margin-top: 4px;">备注: ${d.notes}</div>` : ''}
                ${d.resolvedByName ? `<div class="history-quantity" style="color: var(--text-secondary); margin-top: 4px;">处理人: ${d.resolvedByName}${d.resolvedAt ? ` (${formatDate(d.resolvedAt)})` : ''}</div>` : ''}
                ${d.rejected ? `<div class="history-quantity" style="color: var(--danger); margin-top: 4px;">状态: ${d.rejectedReason || '已驳回'}</div>` : ''}
                ${d.revoked ? `<div class="history-quantity" style="color: var(--danger); margin-top: 4px;">状态: 已撤销 (${d.revokedByName || '管理员'})</div>` : ''}
                <div class="history-footer">
                    <span class="history-time">${formatDate(d.timestamp)}</span>
                    ${d.syncedAt ? `<span class="history-time">同步于 ${formatDate(d.syncedAt)}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function refreshExportView() {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    
    document.getElementById('export-start-date').value = formatLocalDate(startDate);
    document.getElementById('export-end-date').value = formatLocalDate(today);
    
    await updateExportStats();
}

async function updateExportStats() {
    const exportType = document.querySelector('input[name="export-type"]:checked')?.value || 'distributions';
    
    if (exportType === 'distributions' || exportType === 'both') {
        const distributions = await db.getAll(STORES.DISTRIBUTIONS);
        
        const total = distributions.length;
        const synced = distributions.filter(d => d.status === DISTRIBUTION_STATUS.SYNCED).length;
        const conflicted = distributions.filter(d => d.status === DISTRIBUTION_STATUS.CONFLICTED).length;
        
        document.getElementById('export-total').textContent = total;
        document.getElementById('export-synced').textContent = synced;
        document.getElementById('export-conflicted').textContent = conflicted;
    } else {
        const logs = await db.getAll(STORES.AUDIT_LOGS);
        
        document.getElementById('export-total').textContent = logs.length;
        document.getElementById('export-synced').textContent = '-';
        document.getElementById('export-conflicted').textContent = '-';
    }
}

async function exportData() {
    const exportType = document.querySelector('input[name="export-type"]:checked')?.value || 'distributions';
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'csv';
    const startDate = document.getElementById('export-start-date').value;
    const endDate = document.getElementById('export-end-date').value;
    
    try {
        const filename = await dataExporter.exportAndDownload(exportType, format, startDate, endDate);
        showToast(`已导出: ${filename}`);
    } catch (error) {
        showToast('导出失败: ' + error.message);
        console.error('Export error:', error);
    }
}

let editingSupplyId = null;

async function refreshSuppliesView() {
    const listEl = document.getElementById('supply-config-list');
    if (!listEl) return;
    
    const supplies = await db.getAll(STORES.SUPPLIES);
    
    if (supplies.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-text">暂无物资，请点击上方按钮新增</div>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = supplies.map(s => `
        <div class="supply-config-item">
            <div class="supply-config-header">
                <div class="supply-config-icon">${s.icon || '📦'}</div>
                <div class="supply-config-info">
                    <div class="supply-config-name">${s.name}</div>
                    <div class="supply-config-meta">
                        库存: ${s.currentStock}/${s.totalStock} ${s.unit} | 每日限领: ${s.dailyLimit} ${s.unit}
                    </div>
                </div>
            </div>
            <div class="supply-config-actions">
                <button class="btn-edit" onclick="editSupply('${s.id}')">编辑</button>
                <button class="btn-delete" onclick="deleteSupply('${s.id}')">删除</button>
            </div>
        </div>
    `).join('');
}

function openSupplyModal(supplyId = null) {
    editingSupplyId = supplyId;
    const modal = document.getElementById('supply-modal');
    const titleEl = document.getElementById('supply-modal-title');
    
    if (supplyId) {
        titleEl.textContent = '编辑物资';
        db.get(STORES.SUPPLIES, supplyId).then(supply => {
            if (supply) {
                document.getElementById('supply-name').value = supply.name || '';
                document.getElementById('supply-icon').value = supply.icon || '';
                document.getElementById('supply-total-stock').value = supply.totalStock || 0;
                document.getElementById('supply-current-stock').value = supply.currentStock || 0;
                document.getElementById('supply-unit').value = supply.unit || '';
                document.getElementById('supply-daily-limit').value = supply.dailyLimit || 1;
                document.getElementById('supply-category').value = supply.category || 'other';
            }
        });
    } else {
        titleEl.textContent = '新增物资';
        document.getElementById('supply-name').value = '';
        document.getElementById('supply-icon').value = '';
        document.getElementById('supply-total-stock').value = '';
        document.getElementById('supply-current-stock').value = '';
        document.getElementById('supply-unit').value = '';
        document.getElementById('supply-daily-limit').value = '';
        document.getElementById('supply-category').value = 'other';
    }
    
    document.getElementById('supply-error').style.display = 'none';
    modal.style.display = 'flex';
}

function closeSupplyModal() {
    const modal = document.getElementById('supply-modal');
    modal.style.display = 'none';
    editingSupplyId = null;
}

async function saveSupply() {
    const errorEl = document.getElementById('supply-error');
    
    try {
        const name = document.getElementById('supply-name').value.trim();
        const icon = document.getElementById('supply-icon').value.trim() || '📦';
        const totalStock = parseInt(document.getElementById('supply-total-stock').value) || 0;
        const currentStock = parseInt(document.getElementById('supply-current-stock').value) || 0;
        const unit = document.getElementById('supply-unit').value.trim();
        const dailyLimit = parseInt(document.getElementById('supply-daily-limit').value) || 1;
        const category = document.getElementById('supply-category').value;
        
        if (!name) throw new Error('请输入物资名称');
        if (!unit) throw new Error('请输入单位');
        if (currentStock < 0) throw new Error('当前库存不能为负数');
        if (totalStock < 0) throw new Error('总库存不能为负数');
        if (dailyLimit < 1) throw new Error('每日限领至少为1');
        
        let supply;
        if (editingSupplyId) {
            supply = await db.get(STORES.SUPPLIES, editingSupplyId);
            if (!supply) throw new Error('物资不存在');
            supply.name = name;
            supply.icon = icon;
            supply.totalStock = totalStock;
            supply.currentStock = currentStock;
            supply.unit = unit;
            supply.dailyLimit = dailyLimit;
            supply.category = category;
        } else {
            supply = {
                id: generateId('supply'),
                name,
                icon,
                totalStock,
                currentStock,
                unit,
                dailyLimit,
                category,
                createdAt: Date.now()
            };
        }
        
        await db.put(STORES.SUPPLIES, supply);
        
        const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
        if (serverState) {
            const idx = serverState.data.findIndex(s => s.id === supply.id);
            if (idx >= 0) {
                serverState.data[idx] = { ...supply };
            } else {
                serverState.data.push({ ...supply });
            }
            await db.put(STORES.SERVER_STATE, serverState);
        }
        
        await addAuditLog(editingSupplyId ? 'update_supply' : 'create_supply', {
            supplyId: supply.id,
            supplyName: name
        });
        
        showToast(editingSupplyId ? '物资已更新' : '物资已新增');
        closeSupplyModal();
        refreshSuppliesView();
        refreshDashboard();
        
    } catch (error) {
        if (errorEl) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        }
        console.error('Save supply error:', error);
    }
}

async function editSupply(supplyId) {
    openSupplyModal(supplyId);
}

async function deleteSupply(supplyId) {
    if (!confirm('确定要删除该物资吗？删除后无法恢复。')) return;
    
    try {
        const supply = await db.get(STORES.SUPPLIES, supplyId);
        if (!supply) throw new Error('物资不存在');
        
        await db.delete(STORES.SUPPLIES, supplyId);
        
        const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
        if (serverState) {
            serverState.data = serverState.data.filter(s => s.id !== supplyId);
            await db.put(STORES.SERVER_STATE, serverState);
        }
        
        await addAuditLog('delete_supply', {
            supplyId,
            supplyName: supply.name
        });
        
        showToast('物资已删除');
        refreshSuppliesView();
        refreshDashboard();
        
    } catch (error) {
        showToast('删除失败: ' + error.message);
        console.error('Delete supply error:', error);
    }
}

let currentImportData = null;
let currentValidatedRecords = null;
let currentBatchId = null;
let currentFileContent = null;
let currentFileName = null;
let selectedRoleForSwitch = null;
let selectedBatchIdForDetail = null;
let batchFilters = { status: 'all', source: 'all', startDate: '', endDate: '' };
let previousViewState = { batchFilters: null, historyFilters: null, scrollPosition: 0 };
let pendingAlertBatchId = null;

function refreshUserDisplay() {
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    
    if (avatarEl && nameEl) {
        avatarEl.textContent = CURRENT_USER.name.charAt(0);
        nameEl.textContent = CURRENT_USER.role === ROLES.ADMIN ? '管理员' : '志愿者';
    }
}

async function refreshAllViews() {
    await refreshDashboard();
    if (currentView === 'distribute') await refreshDistributeView();
    if (currentView === 'conflicts') await refreshConflictsView();
    if (currentView === 'batches') await refreshBatchesView();
    if (currentView === 'history') await refreshHistoryView();
    if (currentView === 'export') await refreshExportView();
    if (currentView === 'supplies') await refreshSuppliesView();
}

function openUserSwitchModal() {
    selectedRoleForSwitch = null;
    
    const userDisplayEl = document.getElementById('current-user-display');
    const userRoleDisplayEl = document.getElementById('current-user-role-display');
    
    if (userDisplayEl) userDisplayEl.textContent = CURRENT_USER.name;
    if (userRoleDisplayEl) userRoleDisplayEl.textContent = CURRENT_USER.role === ROLES.ADMIN ? '管理员' : '志愿者';
    
    updateRoleSelectorUI();
    
    document.getElementById('admin-password-section').style.display = 'none';
    document.getElementById('password-error').style.display = 'none';
    document.getElementById('admin-password-input').value = '';
    
    const modal = document.getElementById('user-switch-modal');
    if (modal) modal.style.display = 'flex';
}

function closeUserSwitchModal() {
    const modal = document.getElementById('user-switch-modal');
    if (modal) modal.style.display = 'none';
    selectedRoleForSwitch = null;
}

function selectRole(role) {
    selectedRoleForSwitch = role;
    updateRoleSelectorUI();
    
    const passwordSection = document.getElementById('admin-password-section');
    if (passwordSection) {
        passwordSection.style.display = role === 'admin' ? 'block' : 'none';
        document.getElementById('password-error').style.display = 'none';
    }
}

function updateRoleSelectorUI() {
    const volunteerEl = document.getElementById('role-volunteer');
    const adminEl = document.getElementById('role-admin');
    const volunteerCheck = document.getElementById('role-check-volunteer');
    const adminCheck = document.getElementById('role-check-admin');
    
    if (volunteerEl && adminEl) {
        volunteerEl.classList.toggle('selected', selectedRoleForSwitch === 'volunteer' || (!selectedRoleForSwitch && CURRENT_USER.role === ROLES.VOLUNTEER));
        adminEl.classList.toggle('selected', selectedRoleForSwitch === 'admin' || (!selectedRoleForSwitch && CURRENT_USER.role === ROLES.ADMIN));
    }
    if (volunteerCheck && adminCheck) {
        volunteerCheck.style.visibility = (selectedRoleForSwitch === 'volunteer' || (!selectedRoleForSwitch && CURRENT_USER.role === ROLES.VOLUNTEER)) ? 'visible' : 'hidden';
        adminCheck.style.visibility = (selectedRoleForSwitch === 'admin' || (!selectedRoleForSwitch && CURRENT_USER.role === ROLES.ADMIN)) ? 'visible' : 'hidden';
    }
}

async function confirmUserSwitch() {
    const targetRole = selectedRoleForSwitch || CURRENT_USER.role;
    
    if (targetRole === 'admin') {
        const password = document.getElementById('admin-password-input').value;
        if (!verifyAdminPassword(password)) {
            document.getElementById('password-error').style.display = 'block';
            return;
        }
        await switchToAdmin();
    } else {
        await switchToVolunteer();
    }
    
    closeUserSwitchModal();
}

async function initImportHandlers() {
    const fileInput = document.getElementById('import-file');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
    await syncEngine.loadLastResolution();
    await updateUndoButton();
}

async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const format = document.querySelector('input[name="import-format"]:checked')?.value || 'csv';
    const importSource = format === 'csv' ? IMPORT_SOURCES.CSV_IMPORT : IMPORT_SOURCES.JSON_IMPORT;

    try {
        const content = await readFileAsText(file);
        currentFileContent = content;
        currentFileName = file.name;

        const fileHash = await batchEngine.generateFileHash(content);
        const existingBatch = await batchEngine.checkDuplicateImport(fileHash);

        if (existingBatch) {
            const confirmDup = confirm(`检测到重复导入：\n\n文件 "${file.name}" 已于 ${formatDate(existingBatch.timestamp)} 由 ${existingBatch.createdByName} 导入\n成功 ${existingBatch.successCount} 条，冲突 ${existingBatch.conflictCount} 条\n\n是否仍然继续导入？`);
            if (!confirmDup) {
                e.target.value = '';
                return;
            }
        }

        let records;

        if (format === 'csv') {
            records = importEngine.parseCSV(content);
        } else {
            records = importEngine.parseJSON(content);
        }

        if (records.length === 0) {
            throw new Error('文件中没有有效数据');
        }

        currentBatchId = null;
        currentImportData = records;
        currentValidatedRecords = await importEngine.validateImportRecords(records, importSource);

        renderImportPreview(currentValidatedRecords);

    } catch (error) {
        showToast('导入失败: ' + error.message);
        console.error('Import error:', error);
    } finally {
        e.target.value = '';
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'UTF-8');
    });
}

function renderImportPreview(validatedRecords) {
    const previewEl = document.getElementById('import-preview');
    const contentEl = document.getElementById('import-preview-content');
    const countBadge = document.getElementById('import-count-badge');
    const confirmBtn = document.getElementById('confirm-import-btn');

    if (!previewEl || !contentEl) return;

    const validCount = validatedRecords.filter(r => r.valid).length;
    const errorCount = validatedRecords.filter(r => !r.valid).length;

    countBadge.textContent = validatedRecords.length;
    confirmBtn.disabled = validatedRecords.length === 0;

    const typeLabels = {
        [CONFLICT_TYPES.STOCK_OVERFLOW]: '库存不足',
        [CONFLICT_TYPES.DUPLICATE_DISTRIBUTION]: '重复领取',
        [CONFLICT_TYPES.DAILY_LIMIT_EXCEEDED]: '超每日限领',
        [CONFLICT_TYPES.INVALID_RESIDENT]: '居民不存在',
        [CONFLICT_TYPES.INVALID_SUPPLY]: '物资不存在',
        [CONFLICT_TYPES.PERMISSION_DENIED]: '权限不足',
        [CONFLICT_TYPES.IMPORT_VALIDATION_ERROR]: '验证错误',
        [CONFLICT_TYPES.VERSION_CONFLICT]: '版本冲突'
    };

    contentEl.innerHTML = `
        <div class="import-preview-summary" style="margin-bottom: 12px; font-size: 13px;">
            <span style="color: var(--success);">✓ 可导入: ${validCount} 条</span>
            ${errorCount > 0 ? ` | <span style="color: var(--danger);">✗ 需复核: ${errorCount} 条</span>` : ''}
        </div>
        <div class="import-preview-table">
            <table>
                <thead>
                    <tr>
                        <th>行号</th>
                        <th>居民</th>
                        <th>物资</th>
                        <th>数量</th>
                        <th>状态</th>
                    </tr>
                </thead>
                <tbody>
                    ${validatedRecords.map(r => {
                        const rowClass = !r.valid ? 'error' : (r.warnings.length > 0 ? 'warning' : '');
                        const statusText = !r.valid 
                            ? `<span style="color: var(--danger);">${typeLabels[r.conflictType] || '错误'}</span>`
                            : (r.warnings.length > 0 
                                ? `<span style="color: var(--warning);">有警告</span>`
                                : `<span style="color: var(--success);">正常</span>`);
                        
                        return `
                            <tr class="${rowClass}">
                                <td>${r.rowIndex}</td>
                                <td>${r.residentName}</td>
                                <td>${r.supplyName}</td>
                                <td>${r.quantity}</td>
                                <td>${statusText}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    previewEl.style.display = 'block';
}

async function confirmImport() {
    if (!currentValidatedRecords) return;

    const format = document.querySelector('input[name="import-format"]:checked')?.value || 'csv';
    const importSource = format === 'csv' ? IMPORT_SOURCES.CSV_IMPORT : IMPORT_SOURCES.JSON_IMPORT;

    try {
        const fileHash = currentFileContent ? await batchEngine.generateFileHash(currentFileContent) : null;
        
        let parentBatchId = null;
        let isReimport = false;
        let batchFileName = currentFileName || '未命名导入';
        
        if (fileHash) {
            const allBatches = await db.getAll(STORES.BATCHES, 'fileHash', IDBKeyRange.only(fileHash));
            const revokedBatches = allBatches.filter(b => b.status === BATCH_STATUS.REVOKED);
            
            if (revokedBatches.length > 0) {
                const lastRevoked = revokedBatches.sort((a, b) => b.timestamp - a.timestamp)[0];
                const reimportChoice = confirm(
                    `检测到该文件曾被导入并撤销\n\n` +
                    `上次导入: ${formatDate(lastRevoked.timestamp)}\n` +
                    `操作人: ${lastRevoked.createdByName}\n` +
                    `版本: v${lastRevoked.importVersion || 1}\n\n` +
                    `是否作为「重导」创建新版本？\n\n` +
                    `确定 = 创建新版本(状态隔离)\n` +
                    `取消 = 作为全新批次导入`
                );
                
                if (reimportChoice) {
                    parentBatchId = lastRevoked.id;
                    isReimport = true;
                    batchFileName = `${currentFileName} (重导v${(lastRevoked.importVersion || 1) + 1})`;
                }
            }
        }
        
        const batch = await batchEngine.createBatch(
            importSource,
            batchFileName,
            fileHash,
            currentValidatedRecords.length,
            parentBatchId,
            isReimport
        );
        currentBatchId = batch.id;

        const results = await importEngine.processImport(currentValidatedRecords, importSource, batch.id);

        const resultsEl = document.getElementById('import-results');
        if (resultsEl) {
            let resultClass = 'success';
            if (results.errors > 0) resultClass = 'error';
            else if (results.conflicts > 0) resultClass = 'warning';

            resultsEl.className = `import-results ${resultClass}`;
            resultsEl.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 8px;">导入完成</div>
                <div style="font-size: 13px; color: var(--text-secondary);">
                    批次号: ${batch.id.slice(-8)}<br>
                    成功导入: ${results.success} 条<br>
                    进入复核: ${results.conflicts} 条
                </div>
                <button class="btn-primary-small" style="margin-top: 12px; width: 100%;" onclick="navigateToBatch('${batch.id}')">
                    查看批次详情
                </button>
            `;
            resultsEl.style.display = 'block';
        }

        showToast(`导入完成: ${results.success} 条成功, ${results.conflicts} 条需复核`);

        cancelImport();
        refreshDashboard();
        await refreshAllViews();

    } catch (error) {
        showToast('导入失败: ' + error.message);
        console.error('Confirm import error:', error);
    }
}

function cancelImport() {
    currentImportData = null;
    currentValidatedRecords = null;

    const previewEl = document.getElementById('import-preview');
    if (previewEl) {
        previewEl.style.display = 'none';
    }
}

function downloadImportTemplate() {
    const format = document.querySelector('input[name="import-format"]:checked')?.value || 'csv';
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    let content, filename, mimeType;

    if (format === 'csv') {
        content = importEngine.getTemplateCSV();
        filename = `导入模板_${dateStr}.csv`;
        mimeType = 'text/csv;charset=utf-8';
    } else {
        content = importEngine.getTemplateJSON();
        filename = `导入模板_${dateStr}.json`;
        mimeType = 'application/json;charset=utf-8';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`已下载模板: ${filename}`);
}

async function updateUndoButton() {
    const undoBtn = document.getElementById('undo-btn');
    if (!undoBtn) return;

    const hasUndoable = await syncEngine.hasUndoableResolution();
    undoBtn.disabled = !hasUndoable || CURRENT_USER.role !== ROLES.ADMIN;
}

async function openUndoModal() {
    const lastResolution = await syncEngine.loadLastResolution();
    if (!lastResolution) {
        showToast('没有可撤销的操作');
        return;
    }

    const infoEl = document.getElementById('last-resolution-info');
    const actionBtn = document.getElementById('undo-action-btn');

    if (infoEl) {
        const { conflict, distribution, resolution, timestamp } = lastResolution;
        const resolutionClass = resolution === 'approve' ? 'resolution-approved' : 'resolution-rejected';
        const resolutionText = resolution === 'approve' ? '批准' : '驳回';

        infoEl.innerHTML = `
            <div class="undo-resolution-info">
                <div class="info-row">
                    <span class="info-label">处理时间</span>
                    <span class="info-value">${formatDate(timestamp)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">冲突类型</span>
                    <span class="info-value">${getConflictTypeLabel(conflict.conflictType)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">居民</span>
                    <span class="info-value">${distribution.residentName || '未知'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">物资</span>
                    <span class="info-value">${distribution.supplyName || '未知'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">数量</span>
                    <span class="info-value">${distribution.quantity}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">处理结果</span>
                    <span class="info-value ${resolutionClass}">${resolutionText}</span>
                </div>
                ${conflict.importSource ? `
                <div class="info-row">
                    <span class="info-label">来源</span>
                    <span class="info-value">${getImportSourceLabel(conflict.importSource)}</span>
                </div>
                ` : ''}
            </div>
        `;
    }

    if (actionBtn) {
        actionBtn.disabled = CURRENT_USER.role !== ROLES.ADMIN;
    }

    const modal = document.getElementById('undo-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeUndoModal() {
    const modal = document.getElementById('undo-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function executeUndo() {
    try {
        await syncEngine.undoLastResolution();
        showToast('已撤销上次操作');
        closeUndoModal();
        refreshConflictsView();
        refreshDashboard();
        await updateUndoButton();
    } catch (error) {
        showToast(error.message);
        console.error('Undo error:', error);
    }
}

function getConflictTypeLabel(type) {
    const labels = {
        [CONFLICT_TYPES.STOCK_OVERFLOW]: '库存不足',
        [CONFLICT_TYPES.DUPLICATE_DISTRIBUTION]: '重复领取',
        [CONFLICT_TYPES.DAILY_LIMIT_EXCEEDED]: '超每日限领',
        [CONFLICT_TYPES.INVALID_RESIDENT]: '居民不存在',
        [CONFLICT_TYPES.INVALID_SUPPLY]: '物资不存在',
        [CONFLICT_TYPES.PERMISSION_DENIED]: '权限不足',
        [CONFLICT_TYPES.IMPORT_VALIDATION_ERROR]: '导入验证错误',
        [CONFLICT_TYPES.VERSION_CONFLICT]: '版本冲突'
    };
    return labels[type] || type;
}

function getImportSourceLabel(source) {
    const labels = {
        [IMPORT_SOURCES.MANUAL]: '手动录入',
        [IMPORT_SOURCES.CSV_IMPORT]: 'CSV导入',
        [IMPORT_SOURCES.JSON_IMPORT]: 'JSON导入',
        [IMPORT_SOURCES.BATCH_IMPORT]: '批量导入'
    };
    return labels[source] || source;
}

async function refreshConflictsView() {
    const conflictCounts = await syncEngine.getConflictCounts();
    
    document.getElementById('pending-conflicts').textContent = conflictCounts.pending;
    document.getElementById('resolved-conflicts').textContent = conflictCounts.resolved;
    document.getElementById('rejected-conflicts').textContent = conflictCounts.rejected;
    
    await updateUndoButton();
    
    const listEl = document.getElementById('conflict-list');
    if (!listEl) return;
    
    const conflicts = await db.getAll(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
    conflicts.sort((a, b) => b.timestamp - a.timestamp);
    
    if (conflicts.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">✅</div>
                <div class="empty-text">暂无待处理冲突</div>
            </div>
        `;
        return;
    }
    
    const distributions = await db.getAll(STORES.DISTRIBUTIONS);
    const distMap = new Map(distributions.map(d => [d.id, d]));
    
    const typeLabels = {
        [CONFLICT_TYPES.STOCK_OVERFLOW]: '库存不足',
        [CONFLICT_TYPES.DUPLICATE_DISTRIBUTION]: '重复领取',
        [CONFLICT_TYPES.VERSION_CONFLICT]: '数据冲突',
        [CONFLICT_TYPES.PERMISSION_DENIED]: '权限不足',
        [CONFLICT_TYPES.INVALID_RESIDENT]: '居民不存在',
        [CONFLICT_TYPES.INVALID_SUPPLY]: '物资不存在',
        [CONFLICT_TYPES.DAILY_LIMIT_EXCEEDED]: '超每日限领',
        [CONFLICT_TYPES.IMPORT_VALIDATION_ERROR]: '导入错误'
    };
    
    listEl.innerHTML = conflicts.map(c => {
        const dist = distMap.get(c.distributionId);
        const typeLabel = typeLabels[c.conflictType] || c.conflictType;
        const sourceBadge = c.importSource 
            ? `<span class="conflict-source" style="background: rgba(6, 182, 212, 0.1); color: var(--info); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px;">${getImportSourceLabel(c.importSource)}</span>`
            : '';
        const batchBadge = c.batchId
            ? `<span class="conflict-source" style="background: rgba(37, 99, 235, 0.1); color: var(--primary); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; cursor: pointer;" onclick="event.stopPropagation(); navigateToBatch('${c.batchId}')">批次: ${c.batchId.slice(-8)}</span>`
            : '';
        
        return `
            <div class="conflict-item" onclick="openConflictModal('${c.id}')">
                <div class="conflict-header">
                    <div class="conflict-title">${dist ? `${dist.residentName} - ${dist.supplyName}` : '未知记录'}${sourceBadge}${batchBadge}</div>
                    <span class="conflict-type">${typeLabel}</span>
                </div>
                <div class="conflict-desc">${getConflictDescription(c)}</div>
                <div class="conflict-meta">
                    <span>创建时间: ${formatDate(c.timestamp)}</span>
                    <span>点击复核 →</span>
                </div>
            </div>
        `;
    }).join('');
}

function getBatchStatusLabel(status) {
    const labels = {
        [BATCH_STATUS.PROCESSING]: '处理中',
        [BATCH_STATUS.COMPLETED]: '已完成',
        [BATCH_STATUS.PARTIAL]: '部分成功',
        [BATCH_STATUS.REVOKED]: '已撤销'
    };
    return labels[status] || status;
}

function getBatchActionLabel(action) {
    const labels = {
        [BATCH_ACTIONS.APPROVE_ALL]: '批量通过',
        [BATCH_ACTIONS.REJECT_ALL]: '批量驳回',
        [BATCH_ACTIONS.RETRY_FAILED]: '重试失败项',
        [BATCH_ACTIONS.REVOKE_BATCH]: '撤销批次'
    };
    return labels[action] || action || '';
}

function formatLastOperation(lastOperation) {
    if (!lastOperation) return null;
    const actionLabel = getBatchActionLabel(lastOperation.type);
    const time = formatDate(lastOperation.timestamp);
    return `${actionLabel} ${lastOperation.count} 条 · ${lastOperation.operatorName} · ${time}`;
}

function getBatchStatusClass(status) {
    const classes = {
        [BATCH_STATUS.PROCESSING]: 'pending',
        [BATCH_STATUS.COMPLETED]: 'synced',
        [BATCH_STATUS.PARTIAL]: 'warning',
        [BATCH_STATUS.REVOKED]: 'conflicted'
    };
    return classes[status] || '';
}

async function refreshBatchesView() {
    const stats = await batchEngine.getBatchStats();
    
    document.getElementById('batch-total').textContent = stats.total;
    document.getElementById('batch-completed').textContent = stats.completed;
    document.getElementById('batch-partial').textContent = stats.partial;
    document.getElementById('batch-revoked').textContent = stats.revoked;

    document.getElementById('batch-filter-status').value = batchFilters.status;
    document.getElementById('batch-filter-source').value = batchFilters.source;
    document.getElementById('batch-filter-start').value = batchFilters.startDate;
    document.getElementById('batch-filter-end').value = batchFilters.endDate;

    await renderBatchList();
}

function onBatchFilterChange() {
    batchFilters.status = document.getElementById('batch-filter-status').value;
    batchFilters.source = document.getElementById('batch-filter-source').value;
    batchFilters.startDate = document.getElementById('batch-filter-start').value;
    batchFilters.endDate = document.getElementById('batch-filter-end').value;
    renderBatchList();
}

async function renderBatchList() {
    const listEl = document.getElementById('batch-list');
    if (!listEl) return;

    const batches = await batchEngine.getBatches(batchFilters);

    if (batches.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <div class="empty-text">暂无导入批次</div>
            </div>
        `;
        return;
    }

    listEl.innerHTML = batches.map(batch => {
        const statusClass = getBatchStatusClass(batch.status);
        const statusLabel = getBatchStatusLabel(batch.status);
        const lastOperationText = formatLastOperation(batch.lastOperation);

        return `
            <div class="batch-card" onclick="openBatchDetailModal('${batch.id}')">
                <div class="batch-header">
                    <div class="batch-title">
                        <span class="batch-icon">📦</span>
                        <span class="batch-filename">${batch.fileName}</span>
                    </div>
                    <span class="status-badge ${statusClass}">${statusLabel}</span>
                </div>
                <div class="batch-meta">
                    <span>批次号: ${batch.id.slice(-8)}</span>
                    <span>${getImportSourceLabel(batch.source)}</span>
                </div>
                <div class="batch-stats-row">
                    <div class="batch-stat-item">
                        <span class="batch-stat-num">${batch.totalRecords}</span>
                        <span class="batch-stat-label">总计</span>
                    </div>
                    <div class="batch-stat-item success">
                        <span class="batch-stat-num">${batch.successCount}</span>
                        <span class="batch-stat-label">成功</span>
                    </div>
                    <div class="batch-stat-item warning">
                        <span class="batch-stat-num">${batch.conflictCount}</span>
                        <span class="batch-stat-label">冲突</span>
                    </div>
                    <div class="batch-stat-item danger">
                        <span class="batch-stat-num">${batch.revokedCount || 0}</span>
                        <span class="batch-stat-label">已撤销</span>
                    </div>
                </div>
                ${lastOperationText ? `
                <div class="batch-last-op">
                    <span class="last-op-icon">📝</span>
                    <span class="last-op-text">${lastOperationText}</span>
                </div>
                ` : ''}
                <div class="batch-footer">
                    <span class="batch-operator">${batch.createdByName}</span>
                    <span class="batch-time">${formatDate(batch.timestamp)}</span>
                </div>
            </div>
        `;
    }).join('');
}

async function navigateToBatch(batchId) {
    let filters = {};
    let scrollPosition = window.scrollY || document.documentElement.scrollTop;

    if (currentView === 'batches') {
        filters = { ...batchFilters };
        previousViewState.batchFilters = { ...batchFilters };
        previousViewState.scrollPosition = scrollPosition;
    } else if (currentView === 'history') {
        filters = {
            status: document.getElementById('filter-status')?.value || 'all',
            supply: document.getElementById('filter-supply')?.value || 'all',
            batch: document.getElementById('filter-batch')?.value || 'all',
            viewType: 'history'
        };
        previousViewState.historyFilters = { ...filters };
        previousViewState.scrollPosition = scrollPosition;
    } else if (currentView === 'dashboard') {
        filters = {
            viewType: 'dashboard',
            alertClick: true
        };
    } else if (currentView === 'conflicts') {
        filters = {
            viewType: 'conflicts'
        };
    }

    const sessionCard = await sessionCardEngine.createCard(
        batchId,
        currentView,
        filters,
        scrollPosition
    );

    selectedBatchIdForDetail = batchId;
    
    const batch = await batchEngine.getBatch(batchId);
    if (batch && batch.status) {
        batchFilters = {
            status: batch.status,
            source: 'all',
            startDate: '',
            endDate: ''
        };
    }

    navigateTo('batches');
    
    const tryOpenModal = (attempts = 0) => {
        const batchList = document.getElementById('batch-list');
        if (batchList && batchList.children.length > 0) {
            setTimeout(() => {
                openBatchDetailModal(batchId, sessionCard.id);
                if (previousViewState.scrollPosition > 0) {
                    window.scrollTo(0, previousViewState.scrollPosition);
                }
            }, 50);
        } else if (attempts < 10) {
            setTimeout(() => tryOpenModal(attempts + 1), 50);
        }
    };
    tryOpenModal();
}

async function navigateBackFromBatch(sessionCardId = null) {
    let sourceView = null;
    let filters = null;
    let scrollPosition = 0;

    if (sessionCardId) {
        const card = await sessionCardEngine.getCard(sessionCardId);
        if (card) {
            sourceView = card.sourceView;
            filters = card.filters;
            scrollPosition = card.scrollPosition;
            await sessionCardEngine.completeCard(sessionCardId);
        }
    }

    if (!sourceView && previousViewState.batchFilters) {
        batchFilters = { ...previousViewState.batchFilters };
        previousViewState.batchFilters = null;
    } else if (filters && filters.viewType !== 'dashboard') {
        if (filters.viewType === 'history' || sourceView === 'history') {
            batchFilters = { status: 'all', source: 'all', startDate: '', endDate: '' };
            if (filters.status) document.getElementById('filter-status').value = filters.status;
            if (filters.supply) document.getElementById('filter-supply').value = filters.supply;
            if (filters.batch) document.getElementById('filter-batch').value = filters.batch;
        } else {
            batchFilters = filters || { status: 'all', source: 'all', startDate: '', endDate: '' };
        }
    }

    const targetScroll = scrollPosition || previousViewState.scrollPosition;
    if (targetScroll > 0) {
        setTimeout(() => {
            window.scrollTo(0, targetScroll);
            previousViewState.scrollPosition = 0;
        }, 50);
    }
}

let currentSessionCardId = null;

async function openBatchDetailModal(batchId, sessionCardId = null) {
    selectedBatchIdForDetail = batchId;
    currentSessionCardId = sessionCardId;
    
    const batch = await batchEngine.getBatch(batchId);
    if (!batch) {
        showToast('批次不存在');
        return;
    }

    if (sessionCardId) {
        await sessionCardEngine.updateCard(sessionCardId, {
            lastView: 'batch_detail',
            lastActivity: Date.now()
        });
    } else {
        const activeCard = await sessionCardEngine.getActiveCard();
        if (activeCard && activeCard.batchId === batchId) {
            currentSessionCardId = activeCard.id;
        }
    }

    const pendingConflicts = await batchEngine.getBatchPendingConflicts(batchId);
    const distributions = await batchEngine.getBatchDistributions(batchId);
    const isAdmin = CURRENT_USER.role === ROLES.ADMIN;
    const hasPending = pendingConflicts.length > 0;
    const isRevoked = batch.status === BATCH_STATUS.REVOKED;

    const bodyEl = document.getElementById('batch-detail-body');
    const footerEl = document.getElementById('batch-detail-footer');
    const statusClass = getBatchStatusClass(batch.status);
    const statusLabel = getBatchStatusLabel(batch.status);

    const typeLabels = {
        [CONFLICT_TYPES.STOCK_OVERFLOW]: '库存不足',
        [CONFLICT_TYPES.DUPLICATE_DISTRIBUTION]: '重复领取',
        [CONFLICT_TYPES.DAILY_LIMIT_EXCEEDED]: '超每日限领',
        [CONFLICT_TYPES.INVALID_RESIDENT]: '居民不存在',
        [CONFLICT_TYPES.INVALID_SUPPLY]: '物资不存在',
        [CONFLICT_TYPES.IMPORT_VALIDATION_ERROR]: '导入验证错误',
        [CONFLICT_TYPES.VERSION_CONFLICT]: '版本冲突'
    };

    let failedRecordsHtml = '';
    if (batch.failedRecords && batch.failedRecords.length > 0) {
        failedRecordsHtml = `
            <div class="conflict-detail-section">
                <div class="conflict-detail-title" style="cursor: pointer;" onclick="toggleBatchFailedRecords()">
                    <span id="failed-toggle-icon">▼</span> 失败记录详情 (${batch.failedRecords.length} 条)
                </div>
                <div id="batch-failed-records" style="margin-top: 8px;">
                    <div class="import-preview-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>行号</th>
                                    <th>居民</th>
                                    <th>物资</th>
                                    <th>数量</th>
                                    <th>失败原因</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${batch.failedRecords.map(fr => `
                                    <tr class="error">
                                        <td>${fr.index}</td>
                                        <td>${fr.data?.residentName || '-'}</td>
                                        <td>${fr.data?.supplyName || '-'}</td>
                                        <td>${fr.data?.quantity || 0}</td>
                                        <td>${typeLabels[fr.type] || fr.type}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    let affectedRecordsHtml = '';
    if (distributions.length > 0) {
        const supplies = await db.getAll(STORES.SUPPLIES);
        const supplyMap = new Map(supplies.map(s => [s.id, s]));

        affectedRecordsHtml = `
            <div class="conflict-detail-section">
                <div class="conflict-detail-title" style="cursor: pointer;" onclick="toggleBatchRecords()">
                    <span id="records-toggle-icon">▶</span> 受影响记录 (${distributions.length} 条)
                </div>
                <div id="batch-records" style="margin-top: 8px; display: none;">
                    <div class="import-preview-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>居民</th>
                                    <th>物资</th>
                                    <th>数量</th>
                                    <th>状态</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${distributions.map(d => {
                                    const supply = supplyMap.get(d.supplyId);
                                    let statusText = '待同步';
                                    let statusClass = 'pending';
                                    if (d.revoked) {
                                        statusText = '已撤销';
                                        statusClass = 'conflicted';
                                    } else if (d.rejected) {
                                        statusText = '已驳回';
                                        statusClass = 'conflicted';
                                    } else if (d.status === DISTRIBUTION_STATUS.SYNCED) {
                                        statusText = '已同步';
                                        statusClass = 'synced';
                                    } else if (d.status === DISTRIBUTION_STATUS.CONFLICTED) {
                                        statusText = '冲突';
                                        statusClass = 'conflicted';
                                    }
                                    return `
                                        <tr>
                                            <td>${d.residentName || '-'}</td>
                                            <td>${d.supplyName || '-'}</td>
                                            <td>${d.quantity} ${supply ? supply.unit : ''}</td>
                                            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    const lastOperationText = formatLastOperation(batch.lastOperation);
    
    let sessionCardHtml = '';
    let sourceViewLabel = '';
    if (currentSessionCardId) {
        const card = await sessionCardEngine.getCard(currentSessionCardId);
        if (card) {
            const sourceViewLabels = {
                'dashboard': '首页提醒',
                'conflicts': '复核页',
                'history': '记录页',
                'batches': '导入中心'
            };
            sourceViewLabel = sourceViewLabels[card.sourceView] || card.sourceView;
            
            sessionCardHtml = `
            <div class="conflict-detail-section" style="background: linear-gradient(135deg, rgba(37, 99, 235, 0.05), rgba(6, 182, 212, 0.05); border: 1px solid rgba(37, 99, 235, 0.2); border-radius: 8px;">
                <div class="conflict-detail-title" style="color: var(--primary);">
                    🔄 复查接力台
                </div>
                <div class="data-row">
                    <span class="data-row-label">会话卡号</span>
                    <span class="data-row-value" style="font-family: monospace; font-size: 12px;">${currentSessionCardId.slice(-12)}</span>
                </div>
                <div class="data-row">
                    <span class="data-row-label">来源页面</span>
                    <span class="data-row-value">${sourceViewLabel}</span>
                </div>
                <div class="data-row">
                    <span class="data-row-label">创建时间</span>
                    <span class="data-row-value">${formatDate(card.createdAt)}</span>
                </div>
                <div class="data-row">
                    <span class="data-row-label">滚动位置</span>
                    <span class="data-row-value">${card.scrollPosition}px</span>
                </div>
                ${card.filters && Object.keys(card.filters).length > 0 ? `
                <div class="data-row">
                    <span class="data-row-label">筛选条件</span>
                    <span class="data-row-value" style="font-size: 12px; color: var(--text-secondary);">
                        ${JSON.stringify(card.filters).replace(/[{}"]/g, '')}
                    </span>
                </div>
                ` : ''}
                <div style="margin-top: 12px; padding: 8px; background: rgba(37, 99, 235, 0.1); border-radius: 6px; font-size: 12px; color: var(--primary);">
                    ✨ 关闭后将自动回到 ${sourceViewLabel} 的原列表位置
                </div>
            </div>
            `;
        }
    }
    
    bodyEl.innerHTML = `
        ${sessionCardHtml}
        <div class="conflict-detail-section">
            <div class="data-row">
                <span class="data-row-label">文件名称</span>
                <span class="data-row-value">${batch.fileName}</span>
            </div>
            <div class="data-row">
                <span class="data-row-label">批次状态</span>
                <span class="data-row-value"><span class="status-badge ${statusClass}">${statusLabel}</span></span>
            </div>
            <div class="data-row">
                <span class="data-row-label">来源类型</span>
                <span class="data-row-value">${getImportSourceLabel(batch.source)}</span>
            </div>
            <div class="data-row">
                <span class="data-row-label">创建人</span>
                <span class="data-row-value">${batch.createdByName}</span>
            </div>
            <div class="data-row">
                <span class="data-row-label">创建时间</span>
                <span class="data-row-value">${formatDate(batch.timestamp)}</span>
            </div>
            ${lastOperationText ? `
            <div class="data-row">
                <span class="data-row-label">最近操作</span>
                <span class="data-row-value" style="color: var(--info);">${lastOperationText}</span>
            </div>
            ` : ''}
            ${batch.revokedAt ? `
            <div class="data-row">
                <span class="data-row-label">撤销时间</span>
                <span class="data-row-value">${formatDate(batch.revokedAt)}</span>
            </div>
            <div class="data-row">
                <span class="data-row-label">撤销人</span>
                <span class="data-row-value">${batch.revokedByName || '-'}</span>
            </div>
            ` : ''}
        </div>

        <div class="conflict-detail-section">
            <div class="conflict-detail-title">导入统计</div>
            <div class="batch-stats-row">
                <div class="batch-stat-item">
                    <span class="batch-stat-num">${batch.totalRecords}</span>
                    <span class="batch-stat-label">总计</span>
                </div>
                <div class="batch-stat-item success">
                    <span class="batch-stat-num">${batch.successCount}</span>
                    <span class="batch-stat-label">成功</span>
                </div>
                <div class="batch-stat-item warning">
                    <span class="batch-stat-num">${batch.conflictCount}</span>
                    <span class="batch-stat-label">冲突</span>
                </div>
                <div class="batch-stat-item danger">
                    <span class="batch-stat-num">${batch.revokedCount}</span>
                    <span class="batch-stat-label">已撤销</span>
                </div>
            </div>
        </div>

        ${failedRecordsHtml}
        ${affectedRecordsHtml}

        ${hasPending && !isAdmin ? `
        <div class="conflict-detail-section" style="color: var(--danger); font-size: 12px; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">
            ⚠️ 您当前是志愿者身份，只能查看结果，不能执行批量操作和导出。
        </div>
        ` : ''}

        ${isAdmin ? `
        <div class="conflict-detail-section">
            <div class="conflict-detail-title">导出批次</div>
            <div style="display: flex; gap: 8px;">
                <button class="modal-btn" style="flex: 1; background: rgba(16, 185, 129, 0.1); color: var(--success); padding: 10px;" onclick="exportBatchCSV('${batch.id}')">导出 CSV</button>
                <button class="modal-btn" style="flex: 1; background: rgba(59, 130, 246, 0.1); color: var(--primary); padding: 10px;" onclick="exportBatchJSON('${batch.id}')">导出 JSON</button>
            </div>
        </div>
        ` : ''}
    `;

    let footerHtml = '<button class="modal-btn reject" onclick="closeBatchDetailModal()">关闭</button>';
    
    if (isAdmin && !isRevoked && hasPending) {
        footerHtml = `
            <button class="modal-btn reject" onclick="closeBatchDetailModal()">关闭</button>
            <button class="modal-btn" style="background: rgba(6, 182, 212, 0.1); color: var(--info);" onclick="batchRetryFailed('${batch.id}')">重试失败项</button>
            <button class="modal-btn reject" onclick="batchRejectAll('${batch.id}')">批量驳回</button>
            <button class="modal-btn approve" onclick="batchApproveAll('${batch.id}')">批量通过</button>
        `;
    } else if (isAdmin && !isRevoked) {
        footerHtml = `
            <button class="modal-btn reject" onclick="closeBatchDetailModal()">关闭</button>
            <button class="modal-btn" style="background: rgba(239, 68, 68, 0.1); color: var(--danger);" onclick="batchRevoke('${batch.id}')">撤销批次</button>
        `;
    }

    footerEl.innerHTML = footerHtml;

    document.getElementById('batch-detail-modal').style.display = 'flex';
}

function toggleBatchFailedRecords() {
    const el = document.getElementById('batch-failed-records');
    const icon = document.getElementById('failed-toggle-icon');
    if (el) {
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▼' : '▶';
    }
}

function toggleBatchRecords() {
    const el = document.getElementById('batch-records');
    const icon = document.getElementById('records-toggle-icon');
    if (el) {
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '▼' : '▶';
    }
}

async function closeBatchDetailModal() {
    document.getElementById('batch-detail-modal').style.display = 'none';
    const cardIdToUse = currentSessionCardId;
    selectedBatchIdForDetail = null;
    currentSessionCardId = null;
    
    await navigateBackFromBatch(cardIdToUse);
    if (currentView === 'batches') {
        refreshBatchesView();
    }
}

async function batchApproveAll(batchId) {
    const hasPermission = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_APPROVE, batchId);
    if (!hasPermission) {
        showToast('只有管理员可以执行「批量通过」操作');
        return;
    }
    if (!confirm('确定要批量通过该批次的所有待处理冲突吗？')) return;
    
    try {
        const count = await batchEngine.batchApprove(batchId);
        showToast(`已批量通过 ${count} 条记录`);
        closeBatchDetailModal();
        refreshBatchesView();
        refreshConflictsView();
        refreshDashboard();
        refreshHistoryView();
    } catch (error) {
        showToast(error.message);
        console.error('Batch approve error:', error);
    }
}

async function batchRejectAll(batchId) {
    const hasPermission = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_REJECT, batchId);
    if (!hasPermission) {
        showToast('只有管理员可以执行「批量驳回」操作');
        return;
    }
    if (!confirm('确定要批量驳回该批次的所有待处理冲突吗？')) return;
    
    try {
        const count = await batchEngine.batchReject(batchId);
        showToast(`已批量驳回 ${count} 条记录`);
        closeBatchDetailModal();
        refreshBatchesView();
        refreshConflictsView();
        refreshDashboard();
        refreshHistoryView();
    } catch (error) {
        showToast(error.message);
        console.error('Batch reject error:', error);
    }
}

async function batchRetryFailed(batchId) {
    const hasPermission = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_RETRY, batchId);
    if (!hasPermission) {
        showToast('只有管理员可以执行「重试失败项」操作');
        return;
    }
    if (!confirm('确定要重试该批次的所有失败项吗？')) return;
    
    try {
        const count = await batchEngine.retryFailedRecords(batchId);
        showToast(`已重试 ${count} 条记录`);
        closeBatchDetailModal();
        refreshBatchesView();
        refreshConflictsView();
        refreshDashboard();
    } catch (error) {
        showToast(error.message);
        console.error('Batch retry error:', error);
    }
}

async function batchRevoke(batchId) {
    const hasPermission = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_REVOKE, batchId);
    if (!hasPermission) {
        showToast('只有管理员可以执行「撤销批次」操作');
        return;
    }
    if (!confirm('确定要撤销该批次吗？撤销后已同步的记录将回滚库存，且无法恢复。')) return;
    
    try {
        const count = await batchEngine.revokeBatch(batchId);
        showToast(`已撤销批次，共回滚 ${count} 条记录`);
        closeBatchDetailModal();
        refreshBatchesView();
        refreshConflictsView();
        refreshDashboard();
        refreshHistoryView();
    } catch (error) {
        showToast(error.message);
        console.error('Batch revoke error:', error);
    }
}

window.openSupplyModal = openSupplyModal;
window.closeSupplyModal = closeSupplyModal;
window.saveSupply = saveSupply;
window.editSupply = editSupply;
window.deleteSupply = deleteSupply;
window.handleFileSelect = handleFileSelect;
window.confirmImport = confirmImport;
window.cancelImport = cancelImport;
window.downloadImportTemplate = downloadImportTemplate;
window.openUndoModal = openUndoModal;
window.closeUndoModal = closeUndoModal;
window.executeUndo = executeUndo;
window.getConflictTypeLabel = getConflictTypeLabel;
window.getImportSourceLabel = getImportSourceLabel;
window.openUserSwitchModal = openUserSwitchModal;
window.closeUserSwitchModal = closeUserSwitchModal;
window.selectRole = selectRole;
window.confirmUserSwitch = confirmUserSwitch;
window.refreshUserDisplay = refreshUserDisplay;
window.refreshAllViews = refreshAllViews;
window.navigateToBatch = navigateToBatch;
window.openBatchDetailModal = openBatchDetailModal;
window.closeBatchDetailModal = closeBatchDetailModal;
window.onBatchFilterChange = onBatchFilterChange;
window.toggleBatchFailedRecords = toggleBatchFailedRecords;
window.toggleBatchRecords = toggleBatchRecords;
window.batchApproveAll = batchApproveAll;
window.batchRejectAll = batchRejectAll;
window.batchRetryFailed = batchRetryFailed;
window.batchRevoke = batchRevoke;
window.exportBatchCSV = exportBatchCSV;
window.exportBatchJSON = exportBatchJSON;

async function exportBatchCSV(batchId) {
    const hasPermission = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_EXPORT, batchId);
    if (!hasPermission) {
        showToast('只有管理员可以导出批次详情');
        return;
    }
    try {
        const filename = await dataExporter.exportBatchAndDownload(batchId, 'csv');
        showToast(`已导出: ${filename}`);
    } catch (error) {
        showToast(error.message);
        console.error('Export batch CSV error:', error);
    }
}

async function exportBatchJSON(batchId) {
    const hasPermission = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_EXPORT, batchId);
    if (!hasPermission) {
        showToast('只有管理员可以导出批次详情');
        return;
    }
    try {
        const filename = await dataExporter.exportBatchAndDownload(batchId, 'json');
        showToast(`已导出: ${filename}`);
    } catch (error) {
        showToast(error.message);
        console.error('Export batch JSON error:', error);
    }
}
