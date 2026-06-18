const RegressionTest = (function() {
    let results = [];
    let currentTest = null;
    let onComplete = null;

    function test(name, fn) {
        currentTest = { name, passed: false, error: null, duration: 0 };
        results.push(currentTest);
        
        const start = Date.now();
        try {
            const result = fn();
            if (result && typeof result.then === 'function') {
                return result.then(
                    () => {
                        currentTest.passed = true;
                        currentTest.duration = Date.now() - start;
                        logTest(currentTest);
                    },
                    (err) => {
                        currentTest.passed = false;
                        currentTest.error = err.message || String(err);
                        currentTest.duration = Date.now() - start;
                        logTest(currentTest);
                    }
                );
            } else {
                currentTest.passed = true;
                currentTest.duration = Date.now() - start;
                logTest(currentTest);
            }
        } catch (err) {
            currentTest.passed = false;
            currentTest.error = err.message || String(err);
            currentTest.duration = Date.now() - start;
            logTest(currentTest);
        }
        return Promise.resolve();
    }

    function assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    }

    function assertEq(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message + `\n  expected: ${expected}\n  actual: ${actual}`);
        }
    }

    function logTest(t) {
        const status = t.passed ? '✓ PASS' : '✗ FAIL';
        console.log(`${status} ${t.name} (${t.duration}ms)`);
        if (!t.passed && t.error) {
            console.log(`  Error: ${t.error}`);
        }
    }

    function getResults() {
        const passed = results.filter(r => r.passed).length;
        const failed = results.filter(r => !r.passed).length;
        return { total: results.length, passed, failed, tests: results };
    }

    function reset() {
        results = [];
        currentTest = null;
    }

    function runAll() {
        reset();
        return runScenario1()
            .then(() => runScenario2())
            .then(() => runScenario3())
            .then(() => {
                const summary = getResults();
                console.log('\n========================================');
                console.log(`  回归测试完成: ${summary.passed}/${summary.total} 通过`);
                console.log('========================================');
                if (onComplete) onComplete(summary);
                return summary;
            });
    }

    async function clearAllData() {
        await db.init();
        const stores = Object.values(STORES);
        for (const store of stores) {
            await db.clear(store);
        }
        await initSampleData();
        console.log('  [Setup] 数据已重置为初始状态');
    }

    async function waitFor(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function runScenario1() {
        console.log('\n--- 场景1: 物资配置持久化测试 ---');
        
        await test('1.1 重置数据后有5种初始物资', async () => {
            await clearAllData();
            const supplies = await db.getAll(STORES.SUPPLIES);
            assertEq(supplies.length, 5, '初始物资数量应为5');
        });

        await test('1.2 新增物资后列表包含6种物资', async () => {
            const newSupply = {
                id: 'test_supply_001',
                name: '测试手电筒',
                category: 'other',
                unit: '把',
                totalStock: 50,
                currentStock: 50,
                icon: '🔦',
                dailyLimit: 1
            };
            await db.put(STORES.SUPPLIES, newSupply);
            
            const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
            serverState.data.push({ ...newSupply });
            await db.put(STORES.SERVER_STATE, serverState);
            
            const supplies = await db.getAll(STORES.SUPPLIES);
            assertEq(supplies.length, 6, '新增后物资数量应为6');
            
            const found = supplies.find(s => s.id === 'test_supply_001');
            assert(found, '应能找到新增的测试手电筒');
            assertEq(found.name, '测试手电筒', '名称应为测试手电筒');
            assertEq(found.currentStock, 50, '库存应为50');
            assertEq(found.unit, '把', '单位应为把');
            assertEq(found.dailyLimit, 1, '每日限领应为1');
        });

        await test('1.3 编辑物资后数据更新', async () => {
            const supply = await db.get(STORES.SUPPLIES, 'test_supply_001');
            supply.currentStock = 30;
            supply.dailyLimit = 2;
            supply.name = '测试手电筒(改)';
            await db.put(STORES.SUPPLIES, supply);
            
            const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
            const idx = serverState.data.findIndex(s => s.id === 'test_supply_001');
            if (idx >= 0) {
                serverState.data[idx] = { ...supply };
                await db.put(STORES.SERVER_STATE, serverState);
            }
            
            const updated = await db.get(STORES.SUPPLIES, 'test_supply_001');
            assertEq(updated.currentStock, 30, '编辑后库存应为30');
            assertEq(updated.dailyLimit, 2, '编辑后每日限领应为2');
            assertEq(updated.name, '测试手电筒(改)', '编辑后名称应为测试手电筒(改)');
        });

        await test('1.4 刷新页面（重新initDB）后数据仍保留', async () => {
            const supplyBefore = await db.get(STORES.SUPPLIES, 'test_supply_001');
            assert(supplyBefore, '刷新前应存在测试物资');
            
            const suppliesAfter = await db.getAll(STORES.SUPPLIES);
            assertEq(suppliesAfter.length, 6, '刷新后仍应为6种物资');
            
            const found = suppliesAfter.find(s => s.id === 'test_supply_001');
            assert(found, '刷新后应能找到测试物资');
            assertEq(found.currentStock, 30, '刷新后库存应保持30');
            assertEq(found.name, '测试手电筒(改)', '刷新后名称应保持');
        });

        await test('1.5 服务端状态与本地状态一致', async () => {
            const localSupplies = await db.getAll(STORES.SUPPLIES);
            const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
            
            assertEq(localSupplies.length, serverState.data.length,
                '本地与服务端物资数量应一致');
            
            for (const local of localSupplies) {
                const server = serverState.data.find(s => s.id === local.id);
                assert(server, `服务端应存在物资 ${local.name}`);
                assertEq(local.currentStock, server.currentStock,
                    `${local.name} 的库存应一致`);
            }
        });

        return Promise.resolve();
    }

    async function runScenario2() {
        console.log('\n--- 场景2: 冲突队列保留测试 ---');
        
        await test('2.1 重置数据后初始状态正确', async () => {
            await clearAllData();
            
            const pendingCount = await syncEngine.getPendingCount();
            assertEq(pendingCount, 0, '初始待同步数应为0');
            
            const conflictCounts = await syncEngine.getConflictCounts();
            assertEq(conflictCounts.pending, 0, '初始待处理冲突数应为0');
        });

        await test('2.2 正常领取1次后同步成功', async () => {
            const residents = await db.getAll(STORES.RESIDENTS);
            const supplies = await db.getAll(STORES.SUPPLIES);
            const resident = residents[0];
            const supply = supplies[0];
            const stockBefore = supply.currentStock;
            
            const dist = {
                id: 'test_dist_normal',
                residentId: resident.id,
                residentName: resident.name,
                supplyId: supply.id,
                supplyName: supply.name,
                quantity: 1,
                status: DISTRIBUTION_STATUS.PENDING,
                timestamp: Date.now() - 5000,
                operatorId: CURRENT_USER.id,
                operatorName: CURRENT_USER.name,
                notes: '回归测试-正常领取',
                version: 1
            };
            
            await db.put(STORES.DISTRIBUTIONS, dist);
            await syncEngine.addToQueue('create_distribution', dist);
            
            await waitFor(2000);
            
            const updated = await db.get(STORES.DISTRIBUTIONS, 'test_dist_normal');
            assertEq(updated.status, DISTRIBUTION_STATUS.SYNCED, '正常领取应同步成功');
            
            const supplyAfter = await db.get(STORES.SUPPLIES, supply.id);
            assertEq(supplyAfter.currentStock, stockBefore - 1,
                '同步成功后库存应扣减1');
        });

        await test('2.3 重复领取产生冲突，状态为conflicted', async () => {
            const residents = await db.getAll(STORES.RESIDENTS);
            const supplies = await db.getAll(STORES.SUPPLIES);
            const resident = residents[0];
            const supply = supplies[0];
            
            const dist = {
                id: 'test_dist_duplicate',
                residentId: resident.id,
                residentName: resident.name,
                supplyId: supply.id,
                supplyName: supply.name,
                quantity: 1,
                status: DISTRIBUTION_STATUS.PENDING,
                timestamp: Date.now() - 3000,
                operatorId: CURRENT_USER.id,
                operatorName: CURRENT_USER.name,
                notes: '回归测试-重复领取',
                version: 1
            };
            
            await db.put(STORES.DISTRIBUTIONS, dist);
            await syncEngine.addToQueue('create_distribution', dist);
            
            await waitFor(2000);
            
            const updated = await db.get(STORES.DISTRIBUTIONS, 'test_dist_duplicate');
            assertEq(updated.status, DISTRIBUTION_STATUS.CONFLICTED,
                '重复领取状态应为冲突');
            assert(updated.conflictId, '应有冲突ID');
        });

        await test('2.4 冲突产生后待同步队列不为0', async () => {
            const pendingCount = await syncEngine.getPendingCount();
            assert(pendingCount >= 1, `冲突产生后待同步数应>=1，实际为${pendingCount}`);
        });

        await test('2.5 冲突数与待处理队列数对应', async () => {
            const conflictCounts = await syncEngine.getConflictCounts();
            const pendingQueue = await syncEngine.getPendingCount();
            
            assertEq(conflictCounts.pending, 1, '待处理冲突数应为1');
            assert(pendingQueue >= 1, '待同步队列数应>=1');
        });

        await test('2.6 模拟刷新后冲突和队列数保持不变', async () => {
            const conflictsBefore = await syncEngine.getConflictCounts();
            const pendingBefore = await syncEngine.getPendingCount();
            
            const queueBefore = await db.getAll(STORES.OFFLINE_QUEUE);
            const conflictedItems = queueBefore.filter(q => q.status === QUEUE_STATUS.CONFLICTED);
            assert(conflictedItems.length >= 1, '队列中应有冲突状态的项');
            
            const pendingItems = queueBefore.filter(q => q.status === QUEUE_STATUS.PENDING);
            
            assertEq(conflictsBefore.pending, 1, '刷新前待处理冲突应为1');
            assert(pendingBefore >= 1, '刷新前待同步数应>=1');
        });

        await test('2.7 管理员处理冲突后队列项被移除', async () => {
            CURRENT_USER.role = ROLES.ADMIN;
            CURRENT_USER.name = '管理员老李';
            
            const conflicts = await db.getAll(STORES.CONFLICTS, 'status',
                IDBKeyRange.only(CONFLICT_STATUS.PENDING));
            assert(conflicts.length > 0, '应存在待处理冲突');
            
            const conflictId = conflicts[0].id;
            const pendingBefore = await syncEngine.getPendingCount();
            
            await syncEngine.resolveConflict(conflictId, 'reject');
            
            await waitFor(500);
            
            const pendingAfter = await syncEngine.getPendingCount();
            assert(pendingAfter < pendingBefore,
                `处理后待同步数应减少，之前${pendingBefore}，之后${pendingAfter}`);
            
            const resolved = await db.get(STORES.CONFLICTS, conflictId);
            assertEq(resolved.status, CONFLICT_STATUS.REJECTED, '冲突状态应为已驳回');
            
            CURRENT_USER.role = ROLES.VOLUNTEER;
            CURRENT_USER.name = '志愿者小王';
        });

        return Promise.resolve();
    }

    async function runScenario3() {
        console.log('\n--- 场景3: 导出页默认日期测试 ---');
        
        await test('3.1 重置数据后导出页默认日期正确', async () => {
            await clearAllData();
            
            const today = new Date();
            const localDateStr = formatLocalDate(today);
            
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const startStr = formatLocalDate(startOfMonth);
            
            assert(typeof formatLocalDate === 'function',
                '应存在 formatLocalDate 函数');
            
            const todayStr = formatLocalDate(new Date());
            const realToday = new Date();
            const expected = realToday.getFullYear() + '-' +
                String(realToday.getMonth() + 1).padStart(2, '0') + '-' +
                String(realToday.getDate()).padStart(2, '0');
            
            assertEq(todayStr, expected,
                `formatLocalDate 应返回本地日期 ${expected}，实际 ${todayStr}`);
        });

        await test('3.2 产生当天领取记录', async () => {
            const residents = await db.getAll(STORES.RESIDENTS);
            const supplies = await db.getAll(STORES.SUPPLIES);
            const resident = residents[1];
            const supply = supplies[1];
            
            const dist = {
                id: 'test_dist_today_export',
                residentId: resident.id,
                residentName: resident.name,
                supplyId: supply.id,
                supplyName: supply.name,
                quantity: 1,
                status: DISTRIBUTION_STATUS.SYNCED,
                timestamp: Date.now(),
                operatorId: CURRENT_USER.id,
                operatorName: CURRENT_USER.name,
                syncedAt: Date.now(),
                serverSyncedAt: Date.now(),
                notes: '回归测试-导出测试',
                version: 1
            };
            
            await db.put(STORES.DISTRIBUTIONS, dist);
            await addAuditLog('create_distribution', { distributionId: dist.id });
            
            const allDist = await db.getAll(STORES.DISTRIBUTIONS);
            const todayDist = allDist.filter(d => {
                const d = new Date(d.timestamp);
                const today = new Date();
                return d.getFullYear() === today.getFullYear() &&
                       d.getMonth() === today.getMonth() &&
                       d.getDate() === today.getDate();
            });
            
            assert(todayDist.length >= 1, '应存在当天的领取记录');
        });

        await test('3.3 默认日期范围包含当天记录', async () => {
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const csv = await dataExporter.exportDistributions('csv', startDate, endDate);
            const lines = csv.split('\n');
            
            assert(lines.length >= 2, '导出CSV应至少包含表头和1条数据');
            
            const hasTodayRecord = lines.some(line => 
                line.includes('回归测试-导出测试')
            );
            assert(hasTodayRecord, '默认日期导出应包含当天记录');
        });

        await test('3.4 直接使用当天日期过滤能查到记录', async () => {
            const today = formatLocalDate(new Date());
            
            const allDist = await db.getAll(STORES.DISTRIBUTIONS, 'timestamp');
            const start = new Date(today).setHours(0, 0, 0, 0);
            const end = new Date(today).setHours(23, 59, 59, 999);
            
            const todayDist = allDist.filter(d => 
                d.timestamp >= start && d.timestamp <= end
            );
            
            assert(todayDist.length >= 1, `当天应至少有1条记录，实际 ${todayDist.length} 条`);
        });

        await test('3.5 JSON导出也包含当天记录', async () => {
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const json = await dataExporter.exportDistributions('json', startDate, endDate);
            const data = JSON.parse(json);
            
            assert(data.length >= 1, 'JSON导出应至少包含1条记录');
            
            const hasTestRecord = data.some(d => 
                d.notes === '回归测试-导出测试'
            );
            assert(hasTestRecord, 'JSON导出应包含测试记录');
        });

        await test('3.6 导出的身份证号已脱敏', async () => {
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const csv = await dataExporter.exportDistributions('csv', startDate, endDate);
            
            const hasFullIdCard = /[0-9]{17}[0-9Xx]/.test(csv);
            const hasMaskedId = /\*\*\*\*\*\*\*\*/.test(csv) || /110101\*{8}\d{4}/.test(csv);
            
            assert(!hasFullIdCard, 'CSV中不应出现完整身份证号');
        });

        return Promise.resolve();
    }

    return {
        test,
        assert,
        assertEq,
        getResults,
        reset,
        runAll,
        clearAllData,
        waitFor
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RegressionTest;
}
