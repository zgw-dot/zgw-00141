// 复查接力台功能完整测试脚本
// 在浏览器控制台执行此脚本，或按顺序复制执行

const TEST_RESULT = [];
const TEST_START = Date.now();
let TEST_BATCH_ID = null;
let TEST_SESSION_CARD_ID = null;
let TEST_SECOND_BATCH_ID = null;

function logTest(name, success, details = '') {
  const status = success ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} ${name}`);
  if (details) {
    console.log(`   ${details}`);
  }
  TEST_RESULT.push({ name, success, details, timestamp: Date.now() });
}

async function runAllTests() {
  console.log('═'.repeat(60));
  console.log('  复查接力台 - 完整功能测试');
  console.log('═'.repeat(60));
  console.log('');

  // ========== 初始化 ==========
  console.log('【初始化】');
  if (CURRENT_USER.role !== ROLES.ADMIN) {
    await switchToAdmin();
    console.log('  已切换到管理员账号');
  }
  console.log('  当前用户:', CURRENT_USER.name, '(管理员)');
  console.log('');

  // ========== 测试1: 核心引擎初始化 ==========
  console.log('【测试1】核心引擎初始化检查');
  try {
    const hasSessionCard = typeof sessionCardEngine !== 'undefined';
    const hasPermission = typeof permissionGate !== 'undefined';
    const hasExportRecord = typeof exportRecordEngine !== 'undefined';
    const hasStores = typeof STORES.SESSION_CARDS !== 'undefined' &&
                      typeof STORES.PERMISSION_DENIALS !== 'undefined' &&
                      typeof STORES.EXPORT_RECORDS !== 'undefined';
    
    logTest('会话卡引擎存在', hasSessionCard);
    logTest('权限闸门引擎存在', hasPermission);
    logTest('导出记录引擎存在', hasExportRecord);
    logTest('新增存储存在', hasStores);
    
    if (!hasSessionCard || !hasPermission || !hasExportRecord || !hasStores) {
      console.log('  ❌ 核心引擎初始化失败，终止测试');
      return printSummary();
    }
  } catch (e) {
    logTest('核心引擎初始化', false, e.message);
    return printSummary();
  }
  console.log('');

  // ========== 测试2: 创建测试批次 ==========
  console.log('【测试2】创建测试批次');
  try {
    const testCSV = `居民姓名,身份证号,物资名称,领取数量,备注
张三,110101199001010001,瓶装水,2,测试记录1
李四,110101199001010002,瓶装水,3,测试记录2
王五,110101199001010003,感冒药,1,测试记录3
赵六,110101199001010004,充电宝,1,测试记录4`;

    const fileHash = await batchEngine.generateFileHash(testCSV);
    const records = importEngine.parseCSV(testCSV);
    const validated = await importEngine.validateImportRecords(records, IMPORT_SOURCES.CSV_IMPORT);
    
    const batch = await batchEngine.createBatch(
      IMPORT_SOURCES.CSV_IMPORT,
      'relay_test_batch.csv',
      fileHash,
      records.length
    );
    
    TEST_BATCH_ID = batch.id;
    
    await importEngine.processImport(validated.validated, IMPORT_SOURCES.CSV_IMPORT, batch.id);
    
    const batchAfter = await batchEngine.getBatch(batch.id);
    const success = batchAfter && batchAfter.totalRecords === 4;
    
    logTest('创建测试批次', success, `批次ID: ${batch.id.slice(-12)}`);
    logTest('批次记录数正确', batchAfter && batchAfter.totalRecords === 4, `总数: ${batchAfter?.totalRecords}`);
  } catch (e) {
    logTest('创建测试批次', false, e.message);
    return printSummary();
  }
  console.log('');

  // ========== 测试3: 会话卡 - 批次直达 ==========
  console.log('【测试3】会话卡机制 - 批次直达');
  try {
    // 模拟从首页进入
    currentView = 'dashboard';
    window.scrollTo(0, 100);
    
    const card = await sessionCardEngine.createCard(
      TEST_BATCH_ID,
      'dashboard',
      { dateRange: '7days' },
      100
    );
    
    TEST_SESSION_CARD_ID = card.id;
    
    const savedCard = await db.get(STORES.SESSION_CARDS, card.id);
    const success = savedCard && 
                    savedCard.batchId === TEST_BATCH_ID &&
                    savedCard.sourceView === 'dashboard' &&
                    savedCard.scrollPosition === 100 &&
                    savedCard.status === SESSION_CARD_STATUS.ACTIVE;
    
    logTest('创建会话卡成功', success, `卡号: ${card.id.slice(-12)}`);
    logTest('记录来源页面', savedCard?.sourceView === 'dashboard', `来源: ${savedCard?.sourceView}`);
    logTest('记录滚动位置', savedCard?.scrollPosition === 100, `位置: ${savedCard?.scrollPosition}`);
    logTest('记录筛选条件', savedCard?.filters?.dateRange === '7days', `筛选: ${JSON.stringify(savedCard?.filters)}`);
    logTest('会话卡状态活跃', savedCard?.status === SESSION_CARD_STATUS.ACTIVE, `状态: ${savedCard?.status}`);
  } catch (e) {
    logTest('会话卡创建', false, e.message);
  }
  console.log('');

  // ========== 测试4: 权限闸门 - 志愿者越权拦截 ==========
  console.log('【测试4】权限闸门 - 志愿者越权拦截');
  try {
    await switchToVolunteer();
    console.log('  已切换到志愿者账号');
    
    // 测试各项需要管理员权限的操作
    const canApprove = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_APPROVE, TEST_BATCH_ID);
    const canReject = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_REJECT, TEST_BATCH_ID);
    const canRetry = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_RETRY, TEST_BATCH_ID);
    const canRevoke = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_REVOKE, TEST_BATCH_ID);
    const canExport = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_EXPORT, TEST_BATCH_ID);
    
    // 志愿者应该可以预览和查看
    const canView = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_VIEW, TEST_BATCH_ID);
    const canPreview = await permissionGate.checkPermission(PERMISSION_ACTIONS.EXPORT_PREVIEW, TEST_BATCH_ID);
    
    logTest('志愿者-批量通过被拦截', !canApprove, `权限: ${canApprove ? '允许' : '拒绝'}`);
    logTest('志愿者-批量驳回被拦截', !canReject, `权限: ${canReject ? '允许' : '拒绝'}`);
    logTest('志愿者-重试失败被拦截', !canRetry, `权限: ${canRetry ? '允许' : '拒绝'}`);
    logTest('志愿者-撤销批次被拦截', !canRevoke, `权限: ${canRevoke ? '允许' : '拒绝'}`);
    logTest('志愿者-正式导出被拦截', !canExport, `权限: ${canExport ? '允许' : '拒绝'}`);
    logTest('志愿者-允许查看结果', canView, `权限: ${canView ? '允许' : '拒绝'}`);
    logTest('志愿者-允许导出预览', canPreview, `权限: ${canPreview ? '允许' : '拒绝'}`);
    
    // 测试越权拒绝记录落盘
    const denialBefore = await db.count(STORES.PERMISSION_DENIALS);
    try {
      await permissionGate.requirePermission(PERMISSION_ACTIONS.BATCH_APPROVE, TEST_BATCH_ID);
      logTest('越权抛出异常', false, '应该抛出异常但没有');
    } catch (e) {
      logTest('越权抛出异常', true, e.message);
    }
    const denialAfter = await db.count(STORES.PERMISSION_DENIALS);
    logTest('权限拒绝记录落盘', denialAfter > denialBefore, `拒绝记录: ${denialAfter - denialBefore} 条`);
    
    // 切回管理员
    await switchToAdmin();
    console.log('  已切回管理员账号');
  } catch (e) {
    logTest('权限闸门测试', false, e.message);
    await switchToAdmin();
  }
  console.log('');

  // ========== 测试5: 操作签名 ==========
  console.log('【测试5】操作签名机制');
  try {
    const signature = await permissionGate.signOperation(
      PERMISSION_ACTIONS.BATCH_APPROVE,
      TEST_BATCH_ID,
      { count: 10, note: '测试签名' }
    );
    
    const success = signature && 
                    typeof signature.signatureId === 'string' &&
                    signature.timestamp > 0 &&
                    signature.operatorId === CURRENT_USER.id;
    
    logTest('生成操作签名', success, `签名ID: ${signature.signatureId?.slice(-12) || 'N/A'}`);
    logTest('签名包含操作人', signature?.operatorId === CURRENT_USER.id, `操作人: ${signature?.operatorName}`);
    logTest('签名包含角色', signature?.operatorRole === ROLES.ADMIN, `角色: ${signature?.operatorRole}`);
    logTest('签名包含操作详情', signature?.details?.count === 10, `详情: ${JSON.stringify(signature?.details)}`);
    
    // 检查签名是否已落盘到审计日志
    const auditLogs = await db.getAll(STORES.AUDIT_LOGS, 'timestamp');
    const signLog = auditLogs.find(l => l.details?.signatureId === signature.signatureId);
    logTest('签名记录落盘', !!signLog, `签名ID匹配: ${signLog?.details?.signatureId?.slice(-12) || 'N/A'}`);
  } catch (e) {
    logTest('操作签名测试', false, e.message);
  }
  console.log('');

  // ========== 测试6: 会话卡 - 回位续查 ==========
  console.log('【测试6】会话卡机制 - 回位续查');
  try {
    // 完成会话卡，模拟关闭详情
    await sessionCardEngine.completeCard(TEST_SESSION_CARD_ID);
    const completedCard = await db.get(STORES.SESSION_CARDS, TEST_SESSION_CARD_ID);
    
    logTest('会话卡完成状态', completedCard?.status === SESSION_CARD_STATUS.COMPLETED, `状态: ${completedCard?.status}`);
    
    // 测试回位导航
    currentView = 'batches'; // 先切换到别的页面
    const result = await navigateBackFromBatch(TEST_SESSION_CARD_ID);
    
    logTest('回位导航执行成功', result?.success, `目标视图: ${result?.targetView}`);
    logTest('回位到原来源页面', result?.targetView === 'dashboard', `目标: ${result?.targetView}`);
    logTest('滚动位置恢复', result?.scrollPosition === 100, `恢复位置: ${result?.scrollPosition}`);
  } catch (e) {
    logTest('回位续查测试', false, e.message);
  }
  console.log('');

  // ========== 测试7: 批次状态隔离 - 撤销重开 ==========
  console.log('【测试7】批次状态隔离 - 撤销重开');
  try {
    // 先批量通过批次
    await batchEngine.batchApprove(TEST_BATCH_ID);
    const batchBefore = await batchEngine.getBatch(TEST_BATCH_ID);
    const originalVersion = batchBefore.stateVersion;
    
    // 撤销批次
    const revokedCount = await batchEngine.revokeBatch(TEST_BATCH_ID);
    const batchAfter = await batchEngine.getBatch(TEST_BATCH_ID);
    
    logTest('批次撤销成功', batchAfter?.status === BATCH_STATUS.REVOKED, `状态: ${batchAfter?.status}`);
    logTest('状态版本递增', batchAfter?.stateVersion > originalVersion, 
            `原版本: ${originalVersion}, 新版本: ${batchAfter?.stateVersion}`);
    logTest('撤销记录数正确', revokedCount > 0, `撤销数: ${revokedCount}`);
    
    // 测试已撤销批次不能重复操作
    let doubleRevokeError = null;
    try {
      await batchEngine.revokeBatch(TEST_BATCH_ID);
    } catch (e) {
      doubleRevokeError = e;
    }
    logTest('重复撤销被拦截', !!doubleRevokeError, `拦截信息: ${doubleRevokeError?.message || 'N/A'}`);
    
    // 测试已撤销批次不能批量通过
    let approveError = null;
    try {
      await batchEngine.batchApprove(TEST_BATCH_ID);
    } catch (e) {
      approveError = e;
    }
    logTest('已撤销批次批量通过被拦截', !!approveError, `拦截信息: ${approveError?.message || 'N/A'}`);
    
    // 测试撤销后相关会话卡被取消
    const cardsForBatch = await db.getAll(STORES.SESSION_CARDS, 'batchId', IDBKeyRange.only(TEST_BATCH_ID));
    const activeCards = cardsForBatch.filter(c => c.status === SESSION_CARD_STATUS.ACTIVE);
    logTest('撤销后会话卡已取消', activeCards.length === 0, `活跃卡: ${activeCards.length}, 总数: ${cardsForBatch.length}`);
    
    // 创建新批次（模拟重开）
    const testCSV2 = `居民姓名,身份证号,物资名称,领取数量,备注
张三,110101199001010001,瓶装水,2,重开测试1
李四,110101199001010002,瓶装水,3,重开测试2`;

    const fileHash2 = await batchEngine.generateFileHash(testCSV2);
    const records2 = importEngine.parseCSV(testCSV2);
    const validated2 = await importEngine.validateImportRecords(records2, IMPORT_SOURCES.CSV_IMPORT);
    
    const batch2 = await batchEngine.createBatch(
      IMPORT_SOURCES.CSV_IMPORT,
      'relay_test_batch_reopened.csv',
      fileHash2,
      records2.length,
      TEST_BATCH_ID, // 父批次ID
      true // 标记为重导
    );
    
    TEST_SECOND_BATCH_ID = batch2.id;
    await importEngine.processImport(validated2.validated, IMPORT_SOURCES.CSV_IMPORT, batch2.id);
    
    const batch2After = await batchEngine.getBatch(batch2.id);
    
    logTest('重开批次创建成功', !!batch2After, `新批次ID: ${batch2.id.slice(-12)}`);
    logTest('重开批次版本独立', batch2After?.importVersion === 1, `版本: v${batch2After?.importVersion}`);
    logTest('父批次关联正确', batch2After?.parentBatchId === TEST_BATCH_ID, `父批次: ${batch2After?.parentBatchId?.slice(-12)}`);
    logTest('重开标记正确', batch2After?.isReimport === true, `isReimport: ${batch2After?.isReimport}`);
    
    // 验证两个批次状态独立
    const batch1Now = await batchEngine.getBatch(TEST_BATCH_ID);
    const batch2Now = await batchEngine.getBatch(TEST_SECOND_BATCH_ID);
    const statesIndependent = batch1Now.status === BATCH_STATUS.REVOKED && 
                              batch2Now.status !== BATCH_STATUS.REVOKED;
    logTest('批次状态独立不串', statesIndependent, 
            `批次1: ${batch1Now.status}, 批次2: ${batch2Now.status}`);
    
    // 测试版本历史查询
    const history = await batchEngine.getBatchVersionHistory(TEST_SECOND_BATCH_ID);
    logTest('版本历史可追溯', history.length >= 2, `历史长度: ${history.length}`);
  } catch (e) {
    logTest('批次状态隔离测试', false, e.message);
    console.error(e);
  }
  console.log('');

  // ========== 测试8: 导出文件落盘 ==========
  console.log('【测试8】导出文件落盘');
  try {
    const exportCountBefore = await db.count(STORES.EXPORT_RECORDS);
    
    // 模拟导出并落盘
    const filename = await dataExporter.exportBatchAndDownload(TEST_SECOND_BATCH_ID, 'csv');
    
    const exportCountAfter = await db.count(STORES.EXPORT_RECORDS);
    const newExports = exportCountAfter - exportCountBefore;
    
    logTest('导出记录落盘', newExports >= 1, `新增导出记录: ${newExports}`);
    
    // 检查导出记录详情
    const exportRecords = await db.getAll(STORES.EXPORT_RECORDS, 'timestamp');
    const latestExport = exportRecords[exportRecords.length - 1];
    
    logTest('导出记录关联批次', latestExport?.batchId === TEST_SECOND_BATCH_ID, 
            `批次ID: ${latestExport?.batchId?.slice(-12)}`);
    logTest('导出记录包含操作人', latestExport?.operatorId === CURRENT_USER.id, 
            `操作人: ${latestExport?.operatorName}`);
    logTest('导出记录包含文件名', latestExport?.filename?.includes('.csv'), 
            `文件名: ${latestExport?.filename}`);
  } catch (e) {
    logTest('导出文件落盘测试', false, e.message);
  }
  console.log('');

  // ========== 测试9: 会话卡持久化（模拟重启回查）==========
  console.log('【测试9】会话卡持久化 - 重启回查');
  try {
    // 创建新的活跃会话卡
    const card2 = await sessionCardEngine.createCard(
      TEST_SECOND_BATCH_ID,
      'batches',
      { status: BATCH_STATUS.PARTIAL },
      250
    );
    
    // 验证卡片已持久化
    const savedCard2 = await db.get(STORES.SESSION_CARDS, card2.id);
    logTest('会话卡持久化存储', !!savedCard2, `卡号: ${card2.id.slice(-12)}`);
    
    // 获取活跃卡片
    const activeCard = await sessionCardEngine.getActiveCard();
    logTest('可查询活跃会话卡', activeCard?.id === card2.id, `活跃卡ID: ${activeCard?.id?.slice(-12)}`);
    
    // 模拟刷新页面，应用初始化时恢复
    // 这里直接调用恢复函数
    const restored = await sessionCardEngine.restoreCard(card2.id);
    logTest('会话卡可恢复', restored?.status === SESSION_CARD_STATUS.RESTORING, 
            `恢复后状态: ${restored?.status}`);
    
    // 清理：取消该卡片
    await sessionCardEngine.cancelCard(card2.id);
    const cancelledCard = await db.get(STORES.SESSION_CARDS, card2.id);
    logTest('会话卡可取消', cancelledCard?.status === SESSION_CARD_STATUS.CANCELLED, 
            `取消后状态: ${cancelledCard?.status}`);
  } catch (e) {
    logTest('会话卡持久化测试', false, e.message);
  }
  console.log('');

  // ========== 测试10: 过期会话卡清理 ==========
  console.log('【测试10】过期会话卡清理');
  try {
    // 手动创建一个25小时前的"活跃"卡片
    const oldCardId = 'test_old_card_' + Date.now();
    const oldCard = {
      id: oldCardId,
      batchId: TEST_BATCH_ID,
      sourceView: 'dashboard',
      filters: {},
      scrollPosition: 0,
      status: SESSION_CARD_STATUS.ACTIVE,
      createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25小时前
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
      createdBy: CURRENT_USER.id
    };
    await db.put(STORES.SESSION_CARDS, oldCard);
    
    const countBefore = await db.count(STORES.SESSION_CARDS);
    const cleaned = await sessionCardEngine.cleanupExpiredCards();
    const countAfter = await db.count(STORES.SESSION_CARDS);
    
    logTest('过期卡片清理执行', cleaned >= 1, `清理数量: ${cleaned}`);
    logTest('数据库记录减少', countAfter < countBefore, `清理前: ${countBefore}, 清理后: ${countAfter}`);
    
    const oldCardAfter = await db.get(STORES.SESSION_CARDS, oldCardId);
    logTest('过期卡片已失效', !oldCardAfter || oldCardAfter.status === SESSION_CARD_STATUS.CANCELLED, 
            `状态: ${oldCardAfter?.status || '已删除'}`);
  } catch (e) {
    logTest('过期清理测试', false, e.message);
  }
  console.log('');

  // ========== 测试11: 数据完整性检查 ==========
  console.log('【测试11】数据完整性检查');
  try {
    const sessionCardCount = await db.count(STORES.SESSION_CARDS);
    const denialCount = await db.count(STORES.PERMISSION_DENIALS);
    const exportCount = await db.count(STORES.EXPORT_RECORDS);
    
    logTest('会话卡存储正常', sessionCardCount >= 0, `记录数: ${sessionCardCount}`);
    logTest('权限拒绝存储正常', denialCount >= 1, `记录数: ${denialCount}`);
    logTest('导出记录存储正常', exportCount >= 1, `记录数: ${exportCount}`);
    
    // 检查所有批次都有状态版本
    const allBatches = await db.getAll(STORES.BATCHES, 'timestamp');
    const batchesWithVersion = allBatches.filter(b => typeof b.stateVersion === 'number');
    logTest('所有批次有状态版本', batchesWithVersion.length === allBatches.length, 
            `有版本: ${batchesWithVersion.length}/${allBatches.length}`);
  } catch (e) {
    logTest('数据完整性检查', false, e.message);
  }
  console.log('');

  printSummary();
}

function printSummary() {
  const TEST_END = Date.now();
  const DURATION = ((TEST_END - TEST_START) / 1000).toFixed(2);
  
  const PASS_COUNT = TEST_RESULT.filter(r => r.success).length;
  const FAIL_COUNT = TEST_RESULT.filter(r => !r.success).length;
  const TOTAL_COUNT = TEST_RESULT.length;
  const PASS_RATE = TOTAL_COUNT > 0 ? ((PASS_COUNT / TOTAL_COUNT) * 100).toFixed(1) : '0';
  
  console.log('═'.repeat(60));
  console.log('  测试结果汇总');
  console.log('═'.repeat(60));
  console.log(`  总测试数: ${TOTAL_COUNT}`);
  console.log(`  ✅ 通过: ${PASS_COUNT}`);
  console.log(`  ❌ 失败: ${FAIL_COUNT}`);
  console.log(`  📊 通过率: ${PASS_RATE}%`);
  console.log(`  ⏱️  耗时: ${DURATION} 秒`);
  console.log('═'.repeat(60));
  console.log('');
  
  if (FAIL_COUNT > 0) {
    console.log('  失败项详情:');
    TEST_RESULT.filter(r => !r.success).forEach(r => {
      console.log(`    ❌ ${r.name}: ${r.details}`);
    });
    console.log('');
  }
  
  // 保存测试结果到全局变量，方便后续查看
  window.RELAY_TEST_RESULT = {
    summary: {
      total: TOTAL_COUNT,
      passed: PASS_COUNT,
      failed: FAIL_COUNT,
      passRate: PASS_RATE,
      duration: DURATION
    },
    details: TEST_RESULT,
    testBatchId: TEST_BATCH_ID,
    secondBatchId: TEST_SECOND_BATCH_ID,
    sessionCardId: TEST_SESSION_CARD_ID
  };
  
  console.log('  💡 测试结果已保存到 window.RELAY_TEST_RESULT');
  console.log('');
  
  return window.RELAY_TEST_RESULT;
}

// 如果在浏览器环境，直接运行
if (typeof window !== 'undefined') {
  window.runRelayTest = runAllTests;
  console.log('💡 测试脚本已加载，执行 runRelayTest() 开始测试');
}

// 导出供Node.js环境使用
if (typeof module !== 'undefined') {
  module.exports = { runAllTests };
}
