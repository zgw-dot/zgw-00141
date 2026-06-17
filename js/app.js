let appInitialized = false;

async function initApp() {
    if (appInitialized) return;
    appInitialized = true;
    
    try {
        await db.init();
        await initSampleData();
        
        syncEngine.onSyncComplete = () => {
            refreshDashboard();
        };
        
        syncEngine.onConflictDetected = (conflict) => {
            updateConflictBadge();
            refreshDashboard();
        };
        
        const quantityInput = document.getElementById('quantity-input');
        if (quantityInput) {
            quantityInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value) || 1;
                if (selectedSupply) {
                    const maxQty = Math.min(selectedSupply.currentStock, selectedSupply.dailyLimit);
                    selectedQuantity = Math.max(1, Math.min(val, maxQty));
                    e.target.value = selectedQuantity;
                }
            });
        }
        
        refreshDashboard();
        
        console.log('App initialized successfully');
        console.log('Current user:', CURRENT_USER.name, '(', CURRENT_USER.role === ROLES.ADMIN ? '管理员' : '志愿者', ')');
        
    } catch (error) {
        console.error('App initialization error:', error);
        showToast('应用初始化失败，请刷新页面重试');
    }
}

async function createTestScenario() {
    console.log('=== 创建测试场景 ===');
    
    try {
        const residents = await db.getAll(STORES.RESIDENTS);
        const supplies = await db.getAll(STORES.SUPPLIES);
        
        if (residents.length === 0 || supplies.length === 0) {
            console.error('缺少样例数据');
            return;
        }

        const testResident = residents[0];
        const waterSupply = supplies.find(s => s.category === 'water');
        
        console.log('1. 主流程测试：正常领取');
        const dist1 = {
            id: generateId('dist'),
            residentId: testResident.id,
            residentName: testResident.name,
            supplyId: waterSupply.id,
            supplyName: waterSupply.name,
            quantity: 2,
            status: DISTRIBUTION_STATUS.PENDING,
            timestamp: Date.now() - 5000,
            operatorId: CURRENT_USER.id,
            operatorName: CURRENT_USER.name,
            notes: '主流程测试',
            version: 1
        };
        await db.put(STORES.DISTRIBUTIONS, dist1);
        await syncEngine.addToQueue('create_distribution', dist1);
        console.log('   ✓ 已创建领取记录，等待同步');

        await new Promise(resolve => setTimeout(resolve, 1500));
        console.log('2. 等待同步完成...');
        
        const updatedDist = await db.get(STORES.DISTRIBUTIONS, dist1.id);
        console.log('   同步状态:', updatedDist.status);

        const testResident2 = residents[1];
        const medicineSupply = supplies.find(s => s.category === 'medicine');
        
        console.log('3. 失败路径测试：模拟库存冲突');
        const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
        const serverMedicine = serverState.data.find(s => s.id === medicineSupply.id);
        const originalStock = serverMedicine.currentStock;
        serverMedicine.currentStock = 0;
        await db.put(STORES.SERVER_STATE, serverState);
        console.log('   已将服务端药品库存设为 0');
        
        const dist2 = {
            id: generateId('dist'),
            residentId: testResident2.id,
            residentName: testResident2.name,
            supplyId: medicineSupply.id,
            supplyName: medicineSupply.name,
            quantity: 1,
            status: DISTRIBUTION_STATUS.PENDING,
            timestamp: Date.now(),
            operatorId: CURRENT_USER.id,
            operatorName: CURRENT_USER.name,
            notes: '库存不足测试',
            version: 1
        };
        await db.put(STORES.DISTRIBUTIONS, dist2);
        await syncEngine.addToQueue('create_distribution', dist2);
        console.log('   ✓ 已创建超库存领取，等待冲突检测');

        serverMedicine.currentStock = originalStock;
        await db.put(STORES.SERVER_STATE, serverState);

        console.log('4. 失败路径测试：重复领取');
        const dist3 = {
            id: generateId('dist'),
            residentId: testResident.id,
            residentName: testResident.name,
            supplyId: waterSupply.id,
            supplyName: waterSupply.name,
            quantity: 1,
            status: DISTRIBUTION_STATUS.PENDING,
            timestamp: Date.now(),
            operatorId: CURRENT_USER.id,
            operatorName: CURRENT_USER.name,
            notes: '重复领取测试',
            version: 1
        };
        await db.put(STORES.DISTRIBUTIONS, dist3);
        await syncEngine.addToQueue('create_distribution', dist3);
        console.log('   ✓ 已创建重复领取，等待冲突检测');

        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const conflicts = await db.getAll(STORES.CONFLICTS);
        console.log('   当前冲突数:', conflicts.length);
        
        conflicts.forEach((c, i) => {
            console.log(`   冲突 ${i + 1}:`, c.conflictType, '- 状态:', c.status);
        });

        refreshDashboard();
        showToast('测试场景已创建，请检查首页');
        
    } catch (error) {
        console.error('Test scenario error:', error);
    }
}

async function switchToAdmin() {
    CURRENT_USER.role = ROLES.ADMIN;
    CURRENT_USER.name = '管理员老李';
    console.log('已切换到管理员身份');
    showToast('已切换到管理员身份');
}

async function switchToVolunteer() {
    CURRENT_USER.role = ROLES.VOLUNTEER;
    CURRENT_USER.name = '志愿者小王';
    console.log('已切换到志愿者身份');
    showToast('已切换到志愿者身份');
}

async function simulateOffline() {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
    window.dispatchEvent(new Event('offline'));
    console.log('已模拟离线状态');
    showToast('已模拟离线状态');
}

async function simulateOnline() {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    window.dispatchEvent(new Event('online'));
    console.log('已模拟在线状态');
    showToast('已模拟在线状态');
}

async function verifyDataConsistency() {
    console.log('=== 数据一致性检查 ===');
    
    const supplies = await db.getAll(STORES.SUPPLIES);
    const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
    const distributions = await db.getAll(STORES.DISTRIBUTIONS);
    const conflicts = await db.getAll(STORES.CONFLICTS);
    const queue = await db.getAll(STORES.OFFLINE_QUEUE);
    const auditLogs = await db.getAll(STORES.AUDIT_LOGS);
    
    console.log('物资数据:');
    supplies.forEach(s => {
        const serverSupply = serverState?.data?.find(ss => ss.id === s.id);
        console.log(`  ${s.name}: 本地库存=${s.currentStock}, 服务端库存=${serverSupply?.currentStock ?? 'N/A'}`);
    });
    
    console.log(`\n领取记录: ${distributions.length} 条`);
    console.log(`  已同步: ${distributions.filter(d => d.status === DISTRIBUTION_STATUS.SYNCED).length}`);
    console.log(`  待同步: ${distributions.filter(d => d.status === DISTRIBUTION_STATUS.PENDING).length}`);
    console.log(`  冲突: ${distributions.filter(d => d.status === DISTRIBUTION_STATUS.CONFLICTED).length}`);
    
    console.log(`\n冲突记录: ${conflicts.length} 条`);
    console.log(`  待处理: ${conflicts.filter(c => c.status === CONFLICT_STATUS.PENDING).length}`);
    console.log(`  已解决: ${conflicts.filter(c => c.status === CONFLICT_STATUS.RESOLVED).length}`);
    console.log(`  已驳回: ${conflicts.filter(c => c.status === CONFLICT_STATUS.REJECTED).length}`);
    
    console.log(`\n同步队列: ${queue.length} 条`);
    console.log(`审计日志: ${auditLogs.length} 条`);
    
    const synced = distributions.filter(d => d.status === DISTRIBUTION_STATUS.SYNCED);
    const conflicted = distributions.filter(d => d.status === DISTRIBUTION_STATUS.CONFLICTED && !d.rejected);
    
    let localStockCheck = {};
    supplies.forEach(s => localStockCheck[s.id] = s.currentStock);
    
    synced.forEach(d => {
        if (localStockCheck[d.supplyId] !== undefined) {
            localStockCheck[d.supplyId] -= d.quantity;
        }
    });
    
    let stockConsistent = true;
    supplies.forEach(s => {
        const serverSupply = serverState?.data?.find(ss => ss.id === s.id);
        if (serverSupply && s.currentStock !== serverSupply.currentStock) {
            console.log(`\n⚠️  库存不一致: ${s.name}`);
            console.log(`   本地: ${s.currentStock}, 服务端: ${serverSupply.currentStock}`);
            stockConsistent = false;
        }
    });
    
    if (stockConsistent) {
        console.log('\n✓ 本地与服务端库存一致');
    }
    
    const unresolvedConflicts = conflicts.filter(c => c.status === CONFLICT_STATUS.PENDING);
    const conflictedDistributions = distributions.filter(d => d.status === DISTRIBUTION_STATUS.CONFLICTED);
    
    if (unresolvedConflicts.length === conflictedDistributions.filter(d => !d.rejected).length) {
        console.log('✓ 冲突记录与领取记录一致');
    } else {
        console.log('⚠️  冲突记录与领取记录不一致');
    }
    
    console.log('\n=== 检查完成 ===');
    
    return {
        supplies: supplies.length,
        distributions: distributions.length,
        synced: synced.length,
        conflicts: conflicts.length,
        pendingConflicts: unresolvedConflicts.length,
        queue: queue.length,
        auditLogs: auditLogs.length,
        stockConsistent
    };
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

window.createTestScenario = createTestScenario;
window.switchToAdmin = switchToAdmin;
window.switchToVolunteer = switchToVolunteer;
window.simulateOffline = simulateOffline;
window.simulateOnline = simulateOnline;
window.verifyDataConsistency = verifyDataConsistency;
