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
        const statusClass = d.status === DISTRIBUTION_STATUS.SYNCED ? 'synced' : 
                          d.status === DISTRIBUTION_STATUS.PENDING ? 'pending' : 'conflicted';
        const statusText = d.status === DISTRIBUTION_STATUS.SYNCED ? '已同步' : 
                          d.status === DISTRIBUTION_STATUS.PENDING ? '待同步' : '冲突';
        
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

async function refreshConflictsView() {
    const conflictCounts = await syncEngine.getConflictCounts();
    
    document.getElementById('pending-conflicts').textContent = conflictCounts.pending;
    document.getElementById('resolved-conflicts').textContent = conflictCounts.resolved;
    document.getElementById('rejected-conflicts').textContent = conflictCounts.rejected;
    
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
        [CONFLICT_TYPES.PERMISSION_DENIED]: '权限不足'
    };
    
    listEl.innerHTML = conflicts.map(c => {
        const dist = distMap.get(c.distributionId);
        const typeLabel = typeLabels[c.conflictType] || c.conflictType;
        
        return `
            <div class="conflict-item" onclick="openConflictModal('${c.id}')">
                <div class="conflict-header">
                    <div class="conflict-title">${dist ? `${dist.residentName} - ${dist.supplyName}` : '未知记录'}</div>
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
    await filterHistory();
}

async function populateSupplyFilter() {
    const supplies = await db.getAll(STORES.SUPPLIES);
    const selectEl = document.getElementById('filter-supply');
    
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="all">全部物资</option>' +
        supplies.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

async function filterHistory() {
    const statusFilter = document.getElementById('filter-status')?.value || 'all';
    const supplyFilter = document.getElementById('filter-supply')?.value || 'all';
    
    let distributions = await db.getAll(STORES.DISTRIBUTIONS, 'timestamp');
    distributions.sort((a, b) => b.timestamp - a.timestamp);
    
    if (statusFilter !== 'all') {
        distributions = distributions.filter(d => d.status === statusFilter);
    }
    
    if (supplyFilter !== 'all') {
        distributions = distributions.filter(d => d.supplyId === supplyFilter);
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
        const statusClass = d.status === DISTRIBUTION_STATUS.SYNCED ? 'synced' : 
                          d.status === DISTRIBUTION_STATUS.PENDING ? 'pending' : 'conflicted';
        const statusText = d.status === DISTRIBUTION_STATUS.SYNCED ? '已同步' : 
                          d.status === DISTRIBUTION_STATUS.PENDING ? '待同步' : '冲突';
        const sourceBadge = d.importSource 
            ? `<span class="conflict-source" style="background: rgba(6, 182, 212, 0.1); color: var(--info); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px;">${getImportSourceLabel(d.importSource)}</span>`
            : '';
        
        return `
            <div class="history-item">
                <div class="history-header">
                    <div class="history-name">${d.residentName || '未知居民'}${sourceBadge}</div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="history-supply">${d.supplyName || '未知物资'}</div>
                <div class="history-quantity">领取数量: ${d.quantity} ${supply ? supply.unit : ''}</div>
                ${d.notes ? `<div class="history-quantity" style="color: var(--text-secondary); margin-top: 4px;">备注: ${d.notes}</div>` : ''}
                ${d.resolvedByName ? `<div class="history-quantity" style="color: var(--text-secondary); margin-top: 4px;">处理人: ${d.resolvedByName}${d.resolvedAt ? ` (${formatDate(d.resolvedAt)})` : ''}</div>` : ''}
                ${d.rejected ? `<div class="history-quantity" style="color: var(--danger); margin-top: 4px;">状态: ${d.rejectedReason || '已驳回'}</div>` : ''}
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
        let records;

        if (format === 'csv') {
            records = importEngine.parseCSV(content);
        } else {
            records = importEngine.parseJSON(content);
        }

        if (records.length === 0) {
            throw new Error('文件中没有有效数据');
        }

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
        const results = await importEngine.processImport(currentValidatedRecords, importSource);

        const resultsEl = document.getElementById('import-results');
        if (resultsEl) {
            let resultClass = 'success';
            if (results.errors > 0) resultClass = 'error';
            else if (results.conflicts > 0) resultClass = 'warning';

            resultsEl.className = `import-results ${resultClass}`;
            resultsEl.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 8px;">导入完成</div>
                <div style="font-size: 13px; color: var(--text-secondary);">
                    成功导入: ${results.success} 条<br>
                    进入复核: ${results.conflicts} 条
                </div>
            `;
            resultsEl.style.display = 'block';
        }

        showToast(`导入完成: ${results.success} 条成功, ${results.conflicts} 条需复核`);

        cancelImport();
        refreshDashboard();

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
        
        return `
            <div class="conflict-item" onclick="openConflictModal('${c.id}')">
                <div class="conflict-header">
                    <div class="conflict-title">${dist ? `${dist.residentName} - ${dist.supplyName}` : '未知记录'}${sourceBadge}</div>
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
