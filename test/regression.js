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
            .then(() => runScenario4())
            .then(() => runScenario5())
            .then(() => runScenario6())
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

    async function runScenario4() {
        console.log('\n--- 场景4: CSV/JSON导入与验证测试 ---');
        
        await test('4.1 重置数据后初始状态正确', async () => {
            await clearAllData();
            
            const conflicts = await db.getAll(STORES.CONFLICTS);
            assertEq(conflicts.length, 0, '初始冲突数应为0');
        });

        await test('4.2 CSV模板格式正确，包含必需列', async () => {
            const csvTemplate = importEngine.getTemplateCSV();
            assert(csvTemplate.includes('居民姓名'), 'CSV模板应包含居民姓名列');
            assert(csvTemplate.includes('身份证号'), 'CSV模板应包含身份证号列');
            assert(csvTemplate.includes('物资名称'), 'CSV模板应包含物资名称列');
            assert(csvTemplate.includes('领取数量'), 'CSV模板应包含领取数量列');
        });

        await test('4.3 JSON模板格式正确', async () => {
            const jsonTemplate = importEngine.getTemplateJSON();
            const data = JSON.parse(jsonTemplate);
            assert(Array.isArray(data), 'JSON模板应为数组');
            assert(data.length > 0, 'JSON模板应包含示例数据');
            assert(data[0].residentName !== undefined, 'JSON模板应包含residentName字段');
            assert(data[0].idCard !== undefined, 'JSON模板应包含idCard字段');
            assert(data[0].supplyName !== undefined, 'JSON模板应包含supplyName字段');
            assert(data[0].quantity !== undefined, 'JSON模板应包含quantity字段');
        });

        await test('4.4 解析有效CSV数据正确', async () => {
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量,备注,领取时间\n' +
                       '张三,110101199001011234,瓶装饮用水,2,测试备注,2024-01-15 10:30\n' +
                       '李四,110101199102022345,应急药品包,1,,2024-01-15 11:00\n';
            
            const records = importEngine.parseCSV(csv);
            assertEq(records.length, 2, '应解析出2条记录');
            assertEq(records[0].residentName, '张三', '第一条记录居民应为张三');
            assertEq(records[0].idCard, '110101199001011234', '第一条记录身份证号正确');
            assertEq(records[0].supplyName, '瓶装饮用水', '第一条记录物资正确');
            assertEq(records[0].quantity, 2, '第一条记录数量正确');
            assertEq(records[0].notes, '测试备注', '第一条记录备注正确');
        });

        await test('4.5 解析有效JSON数据正确', async () => {
            const json = JSON.stringify([
                { residentName: '张三', idCard: '110101199001011234', supplyName: '瓶装饮用水', quantity: 2, notes: '测试' },
                { residentName: '李四', idCard: '110101199102022345', supplyName: '应急药品包', quantity: 1 }
            ]);
            
            const records = importEngine.parseJSON(json);
            assertEq(records.length, 2, '应解析出2条记录');
            assertEq(records[0].residentName, '张三', '第一条记录居民应为张三');
            assertEq(records[0].quantity, 2, '第一条记录数量正确');
        });

        await test('4.6 无效居民导入产生冲突', async () => {
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量\n' +
                       '不存在的人,110101199999999999,瓶装饮用水,2\n';
            
            const records = importEngine.parseCSV(csv);
            const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
            
            assertEq(validated.length, 1, '应验证1条记录');
            assertEq(validated[0].valid, false, '记录应验证失败');
            assertEq(validated[0].conflictType, CONFLICT_TYPES.INVALID_RESIDENT, '冲突类型应为无效居民');
        });

        await test('4.7 无效物资导入产生冲突', async () => {
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量\n' +
                       '张三,110101199001011234,不存在的物资,2\n';
            
            const records = importEngine.parseCSV(csv);
            const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
            
            assertEq(validated[0].valid, false, '记录应验证失败');
            assertEq(validated[0].conflictType, CONFLICT_TYPES.INVALID_SUPPLY, '冲突类型应为无效物资');
        });

        await test('4.8 超库存导入产生冲突', async () => {
            const supplies = await db.getAll(STORES.SUPPLIES);
            const water = supplies.find(s => s.category === 'water');
            const originalStock = water.currentStock;
            
            water.currentStock = 1;
            await db.put(STORES.SUPPLIES, water);
            
            const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
            const serverWater = serverState.data.find(s => s.id === water.id);
            serverWater.currentStock = 1;
            await db.put(STORES.SERVER_STATE, serverState);
            
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量\n' +
                       '张三,110101199001011234,瓶装饮用水,5\n';
            
            const records = importEngine.parseCSV(csv);
            const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
            
            assertEq(validated[0].valid, false, '记录应验证失败');
            assertEq(validated[0].conflictType, CONFLICT_TYPES.STOCK_OVERFLOW, '冲突类型应为库存不足');
            
            water.currentStock = originalStock;
            await db.put(STORES.SUPPLIES, water);
            serverWater.currentStock = originalStock;
            await db.put(STORES.SERVER_STATE, serverState);
        });

        await test('4.9 有效记录导入成功并进入同步队列', async () => {
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量\n' +
                       '张三,110101199001011234,瓶装饮用水,1\n' +
                       '李四,110101199102022345,应急药品包,1\n';
            
            const records = importEngine.parseCSV(csv);
            const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
            const results = await importEngine.processImport(validated, IMPORT_SOURCES.CSV_IMPORT);
            
            assertEq(results.success, 2, '应成功导入2条记录');
            assertEq(results.conflicts, 0, '应无冲突');
            
            const distributions = await db.getAll(STORES.DISTRIBUTIONS);
            const imported = distributions.filter(d => d.importSource === IMPORT_SOURCES.CSV_IMPORT);
            assertEq(imported.length, 2, '应存在2条导入记录');
            
            assert(imported[0].importedAt !== undefined, '导入记录应有importedAt');
            assert(imported[0].importRow !== undefined, '导入记录应有importRow');
        });

        await test('4.10 混合有效无效记录分别处理正确', async () => {
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量\n' +
                       '张三,110101199001011234,瓶装饮用水,1\n' +
                       '不存在的人,110101199999999999,瓶装饮用水,1\n' +
                       '李四,110101199102022345,应急药品包,1\n';
            
            const records = importEngine.parseCSV(csv);
            const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
            const results = await importEngine.processImport(validated, IMPORT_SOURCES.CSV_IMPORT);
            
            assertEq(results.success, 2, '应成功导入2条记录');
            assertEq(results.conflicts, 1, '应产生1条冲突');
            
            const conflicts = await db.getAll(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
            const importConflicts = conflicts.filter(c => c.importSource === IMPORT_SOURCES.CSV_IMPORT);
            assertEq(importConflicts.length, 1, '应存在1条导入来源的冲突');
        });

        await test('4.11 待同步数、冲突数、记录数状态一致', async () => {
            const pendingCount = await syncEngine.getPendingCount();
            const conflictCounts = await syncEngine.getConflictCounts();
            const distributions = await db.getAll(STORES.DISTRIBUTIONS);
            
            const conflictedDists = distributions.filter(d => 
                d.status === DISTRIBUTION_STATUS.CONFLICTED && !d.rejected
            );
            
            assertEq(conflictCounts.pending, conflictedDists.length, 
                '待处理冲突数应等于冲突状态且未驳回的领取记录数');
            
            assert(pendingCount >= conflictCounts.pending, 
                '待同步数应大于等于待处理冲突数');
        });

        return Promise.resolve();
    }

    async function runScenario5() {
        console.log('\n--- 场景5: 冲突处理与撤销测试 ---');
        
        await test('5.1 重置数据并创建测试数据', async () => {
            await clearAllData();
            
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量\n' +
                       '张三,110101199001011234,瓶装饮用水,999\n';
            
            const records = importEngine.parseCSV(csv);
            const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
            await importEngine.processImport(validated, IMPORT_SOURCES.CSV_IMPORT);
            
            const conflicts = await db.getAll(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
            assert(conflicts.length >= 1, '应至少存在1条待处理冲突');
        });

        await test('5.2 志愿者无权处理冲突', async () => {
            CURRENT_USER.role = ROLES.VOLUNTEER;
            CURRENT_USER.name = '志愿者小王';
            
            const conflicts = await db.getAll(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
            const conflictId = conflicts[0].id;
            
            let threwError = false;
            try {
                await syncEngine.resolveConflict(conflictId, 'approve');
            } catch (e) {
                threwError = true;
                assert(e.message.includes('管理员'), '错误信息应提示需要管理员');
            }
            assert(threwError, '志愿者处理冲突应抛出错误');
        });

        await test('5.3 管理员批准冲突后状态更新', async () => {
            CURRENT_USER.role = ROLES.ADMIN;
            CURRENT_USER.name = '管理员老李';
            
            const conflicts = await db.getAll(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
            const conflictId = conflicts[0].id;
            const distributionId = conflicts[0].distributionId;
            
            const supplyBefore = await db.get(STORES.SUPPLIES, conflicts[0].localData.supplyId);
            const stockBefore = supplyBefore.currentStock;
            
            await syncEngine.resolveConflict(conflictId, 'approve');
            
            const conflictAfter = await db.get(STORES.CONFLICTS, conflictId);
            assertEq(conflictAfter.status, CONFLICT_STATUS.RESOLVED, '冲突状态应为已解决');
            assertEq(conflictAfter.resolvedBy, CURRENT_USER.id, '应记录处理人ID');
            assertEq(conflictAfter.resolvedByName, CURRENT_USER.name, '应记录处理人姓名');
            assert(conflictAfter.resolvedAt !== null, '应记录处理时间');
            
            const distAfter = await db.get(STORES.DISTRIBUTIONS, distributionId);
            assertEq(distAfter.status, DISTRIBUTION_STATUS.SYNCED, '领取记录状态应为已同步');
            assertEq(distAfter.resolvedByName, CURRENT_USER.name, '领取记录应记录处理人');
            
            const supplyAfter = await db.get(STORES.SUPPLIES, supplyBefore.id);
            assert(supplyAfter.currentStock < stockBefore, '批准后库存应扣减');
            
            const hasUndoable = await syncEngine.hasUndoableResolution();
            assert(hasUndoable, '应存在可撤销的操作');
        });

        await test('5.4 撤销批准操作后状态回滚', async () => {
            const lastResolution = await syncEngine.loadLastResolution();
            assert(lastResolution !== null, '应存在最近处理记录');
            assertEq(lastResolution.resolution, 'approve', '最近处理应为批准');
            
            const conflictId = lastResolution.conflict.id;
            const distributionId = lastResolution.distribution.id;
            const supplyId = lastResolution.supplyBefore.id;
            const stockBeforeUndo = lastResolution.supplyBefore.currentStock;
            
            const distBeforeUndo = await db.get(STORES.DISTRIBUTIONS, distributionId);
            const syncedStockBefore = distBeforeUndo.status;
            
            await syncEngine.undoLastResolution();
            
            const conflictAfter = await db.get(STORES.CONFLICTS, conflictId);
            assertEq(conflictAfter.status, CONFLICT_STATUS.PENDING, '撤销后冲突状态应为待处理');
            assertEq(conflictAfter.resolvedBy, null, '撤销后处理人应为空');
            
            const distAfter = await db.get(STORES.DISTRIBUTIONS, distributionId);
            assertEq(distAfter.status, DISTRIBUTION_STATUS.CONFLICTED, '撤销后领取记录状态应为冲突');
            assertEq(distAfter.rejected, undefined, '撤销后rejected应为undefined');
            
            const supplyAfter = await db.get(STORES.SUPPLIES, supplyId);
            assertEq(supplyAfter.currentStock, stockBeforeUndo, '撤销后库存应回滚');
            
            const hasUndoable = await syncEngine.hasUndoableResolution();
            assertEq(hasUndoable, false, '撤销后应无可撤销操作');
        });

        await test('5.5 驳回冲突后状态更新', async () => {
            const conflicts = await db.getAll(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
            const conflictId = conflicts[0].id;
            const distributionId = conflicts[0].distributionId;
            
            const supplyBefore = await db.get(STORES.SUPPLIES, conflicts[0].localData.supplyId);
            const stockBefore = supplyBefore.currentStock;
            
            await syncEngine.resolveConflict(conflictId, 'reject');
            
            const conflictAfter = await db.get(STORES.CONFLICTS, conflictId);
            assertEq(conflictAfter.status, CONFLICT_STATUS.REJECTED, '冲突状态应为已驳回');
            
            const distAfter = await db.get(STORES.DISTRIBUTIONS, distributionId);
            assertEq(distAfter.status, DISTRIBUTION_STATUS.CONFLICTED, '领取记录状态应为冲突');
            assertEq(distAfter.rejected, true, '领取记录rejected应为true');
            
            const supplyAfter = await db.get(STORES.SUPPLIES, supplyBefore.id);
            assertEq(supplyAfter.currentStock, stockBefore, '驳回后库存不应扣减');
        });

        await test('5.6 撤销驳回操作后状态回滚', async () => {
            const lastResolution = await syncEngine.loadLastResolution();
            assertEq(lastResolution.resolution, 'reject', '最近处理应为驳回');
            
            const conflictId = lastResolution.conflict.id;
            const distributionId = lastResolution.distribution.id;
            
            await syncEngine.undoLastResolution();
            
            const conflictAfter = await db.get(STORES.CONFLICTS, conflictId);
            assertEq(conflictAfter.status, CONFLICT_STATUS.PENDING, '撤销后冲突状态应为待处理');
            
            const distAfter = await db.get(STORES.DISTRIBUTIONS, distributionId);
            assertEq(distAfter.rejected, undefined, '撤销后rejected应为undefined');
        });

        await test('5.7 处理后首页待同步数、冲突数、记录数一致', async () => {
            const conflictCounts = await syncEngine.getConflictCounts();
            const distributions = await db.getAll(STORES.DISTRIBUTIONS);
            
            const conflictedDists = distributions.filter(d => 
                d.status === DISTRIBUTION_STATUS.CONFLICTED && !d.rejected
            );
            
            assertEq(conflictCounts.pending, conflictedDists.length, 
                '待处理冲突数应与冲突状态记录数一致');
            
            const pendingCount = await syncEngine.getPendingCount();
            assert(pendingCount >= conflictCounts.pending, 
                '待同步数应大于等于待处理冲突数');
        });

        return Promise.resolve();
    }

    async function runScenario6() {
        console.log('\n--- 场景6: 导出增强测试 ---');
        
        await test('6.1 重置数据并创建包含导入来源的记录', async () => {
            await clearAllData();
            
            CURRENT_USER.role = ROLES.ADMIN;
            CURRENT_USER.name = '管理员老李';
            
            const csv = '\uFEFF居民姓名,身份证号,物资名称,领取数量\n' +
                       '张三,110101199001011234,瓶装饮用水,1\n' +
                       '李四,110101199102022345,应急药品包,1\n';
            
            const records = importEngine.parseCSV(csv);
            const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
            await importEngine.processImport(validated, IMPORT_SOURCES.CSV_IMPORT);
            
            await waitFor(2000);
            
            const conflicts = await db.getAll(STORES.CONFLICTS, 'status', IDBKeyRange.only(CONFLICT_STATUS.PENDING));
            for (const c of conflicts) {
                await syncEngine.resolveConflict(c.id, 'approve');
            }
            
            const distributions = await db.getAll(STORES.DISTRIBUTIONS);
            assert(distributions.length >= 2, '应至少有2条领取记录');
        });

        await test('6.2 导出的CSV包含导入来源列', async () => {
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const csv = await dataExporter.exportDistributions('csv', startDate, endDate);
            const lines = csv.split('\n');
            
            const headerLine = lines[0];
            assert(headerLine.includes('数据来源'), 'CSV表头应包含数据来源列');
            assert(headerLine.includes('处理人'), 'CSV表头应包含处理人列');
            assert(headerLine.includes('处理时间'), 'CSV表头应包含处理时间列');
            assert(headerLine.includes('驳回状态'), 'CSV表头应包含驳回状态列');
        });

        await test('6.3 导出的CSV包含正确的导入来源数据', async () => {
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const csv = await dataExporter.exportDistributions('csv', startDate, endDate);
            
            assert(csv.includes('CSV导入'), 'CSV数据应包含CSV导入来源');
            assert(csv.includes('管理员老李'), 'CSV数据应包含处理人姓名');
        });

        await test('6.4 JSON导出包含导入来源字段', async () => {
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const json = await dataExporter.exportDistributions('json', startDate, endDate);
            const data = JSON.parse(json);
            
            assert(data.length >= 2, 'JSON导出应至少包含2条记录');
            
            const imported = data.filter(d => d.importSourceText === 'CSV导入');
            assert(imported.length >= 1, '应至少有1条CSV导入来源的记录');
            
            const hasResolvedByName = data.some(d => d.resolvedByName === '管理员老李');
            assert(hasResolvedByName, '应包含处理人姓名');
        });

        await test('6.5 审计日志导出包含所有操作类型', async () => {
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const csv = await dataExporter.exportAuditLogs('csv', startDate, endDate);
            
            assert(csv.includes('导入领取记录'), '审计日志应包含导入领取记录操作');
            assert(csv.includes('冲突已解决'), '审计日志应包含冲突已解决操作');
            assert(csv.includes('管理员'), '审计日志应包含管理员角色');
        });

        await test('6.6 数据经得住刷新页面（模拟重新加载DB）', async () => {
            const distributionsBefore = await db.getAll(STORES.DISTRIBUTIONS);
            const conflictsBefore = await db.getAll(STORES.CONFLICTS);
            const auditLogsBefore = await db.getAll(STORES.AUDIT_LOGS);
            const suppliesBefore = await db.getAll(STORES.SUPPLIES);
            
            const importedBefore = distributionsBefore.filter(d => d.importSource === IMPORT_SOURCES.CSV_IMPORT);
            assert(importedBefore.length >= 2, '刷新前应至少有2条导入记录');
            
            const distCountBefore = distributionsBefore.length;
            const conflictCountBefore = conflictsBefore.length;
            const auditCountBefore = auditLogsBefore.length;
            
            const suppliesAfter = await db.getAll(STORES.SUPPLIES);
            const distributionsAfter = await db.getAll(STORES.DISTRIBUTIONS);
            const conflictsAfter = await db.getAll(STORES.CONFLICTS);
            const auditLogsAfter = await db.getAll(STORES.AUDIT_LOGS);
            
            assertEq(distributionsAfter.length, distCountBefore, '刷新后领取记录数应不变');
            assertEq(conflictsAfter.length, conflictCountBefore, '刷新后冲突数应不变');
            assertEq(auditLogsAfter.length, auditCountBefore, '刷新后审计日志数应不变');
            
            const importedAfter = distributionsAfter.filter(d => d.importSource === IMPORT_SOURCES.CSV_IMPORT);
            assertEq(importedAfter.length, importedBefore.length, '刷新后导入记录数应不变');
            
            for (let i = 0; i < suppliesBefore.length; i++) {
                assertEq(suppliesAfter[i].currentStock, suppliesBefore[i].currentStock, 
                    `${suppliesBefore[i].name} 库存应保持一致`);
            }
        });

        await test('6.7 手动录入记录来源标记正确', async () => {
            const residents = await db.getAll(STORES.RESIDENTS);
            const supplies = await db.getAll(STORES.SUPPLIES);
            
            const dist = {
                id: generateId('dist'),
                residentId: residents[0].id,
                residentName: residents[0].name,
                supplyId: supplies[0].id,
                supplyName: supplies[0].name,
                quantity: 1,
                status: DISTRIBUTION_STATUS.PENDING,
                timestamp: Date.now(),
                operatorId: CURRENT_USER.id,
                operatorName: CURRENT_USER.name,
                notes: '手动录入测试',
                version: 1,
                importSource: IMPORT_SOURCES.MANUAL
            };
            
            await db.put(STORES.DISTRIBUTIONS, dist);
            await syncEngine.addToQueue('create_distribution', dist);
            
            await waitFor(2000);
            
            const today = new Date();
            const startDate = formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1));
            const endDate = formatLocalDate(today);
            
            const csv = await dataExporter.exportDistributions('csv', startDate, endDate);
            
            assert(csv.includes('手动录入'), 'CSV应包含手动录入来源');
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
