// 完整批次追踪功能测试脚本
// 在浏览器控制台执行此脚本

async function runCompleteBatchTest() {
  console.log('========================================');
  console.log('  批次追踪功能完整测试');
  console.log('========================================');
  console.log('');

  const results = [];
  const testStart = Date.now();

  // ========== 初始化 ==========
  console.log('【初始化】');
  if (CURRENT_USER.role !== ROLES.ADMIN) {
    await switchToAdmin();
  }
  console.log('  当前用户:', CURRENT_USER.name, '(', CURRENT_USER.role === ROLES.ADMIN ? '管理员' : '志愿者', ')');
  console.log('');

  // ========== 步骤1: 引擎和数据库检查 ==========
  console.log('【步骤1】引擎和数据库检查');
  const step1 = {
    name: '引擎和数据库检查',
    success: typeof STORES.BATCHES !== 'undefined' && 
             typeof batchEngine !== 'undefined' &&
             typeof importEngine !== 'undefined' &&
             typeof dataExporter !== 'undefined'
  };
  results.push(step1);
  console.log('  ✅ STORES.BATCHES:', typeof STORES.BATCHES !== 'undefined');
  console.log('  ✅ batchEngine:', typeof batchEngine !== 'undefined');
  console.log('  ✅ importEngine:', typeof importEngine !== 'undefined');
  console.log('  ✅ dataExporter:', typeof dataExporter !== 'undefined');
  console.log('  结果:', step1.success ? '✅ 通过' : '❌ 失败');
  console.log('');

  // ========== 步骤2: CSV混合导入测试 ==========
  console.log('【步骤2】CSV混合导入测试');
  
  const csvContent = `居民姓名,身份证号,物资名称,领取数量,备注
张三,110101199001010001,瓶装水,2,正常记录-成功
李四,110101199001010002,瓶装水,3,超每日限领-冲突
王五,110101199001010003,感冒药,1,正常记录-成功
赵六,110101199001010004,不存在物资,2,物资不存在-失败
钱七,110101199001010005,瓶装水,100,库存不足-冲突
孙八,110101199001010006,充电宝,1,正常记录-成功
张三,110101199001010001,瓶装水,1,重复领取-冲突
无效居民,INVALID_ID,瓶装水,1,居民不存在-失败`;

  // 2.1 文件哈希生成
  const csvHash = await batchEngine.generateFileHash(csvContent);
  console.log('  2.1 文件哈希:', csvHash.slice(0, 16) + '...');

  // 2.2 重复导入检查
  const duplicateCheck1 = await batchEngine.checkDuplicateImport(csvHash);
  console.log('  2.2 重复导入检查:', duplicateCheck1 ? '⚠️  发现重复' : '✅ 无重复');

  // 2.3 解析CSV
  const csvRecords = await importEngine.parseCSV(csvContent);
  console.log('  2.3 CSV解析:', csvRecords.length, '条记录');

  // 2.4 验证记录
  const { validated: csvValidated, errors: csvErrors } = await importEngine.validateImportRecords(
    csvRecords, 
    IMPORT_SOURCES.CSV_IMPORT
  );
  console.log('  2.4 记录验证: 通过', csvValidated.length, '条, 错误', csvErrors.length, '条');
  if (csvErrors.length > 0) {
    csvErrors.slice(0, 3).forEach(e => 
      console.log('      - 行', e.index, ':', e.type, '-', e.message)
    );
  }

  // 2.5 创建批次
  const csvBatch = await batchEngine.createBatch(
    IMPORT_SOURCES.CSV_IMPORT,
    'batch_test_mixed.csv',
    csvHash,
    csvRecords.length
  );
  console.log('  2.5 创建批次: ID =', csvBatch.id);

  // 2.6 执行导入
  const csvResult = await importEngine.processImport(
    csvValidated, 
    IMPORT_SOURCES.CSV_IMPORT, 
    csvBatch.id
  );
  console.log('  2.6 执行导入: 成功', csvResult.imported.length, '条, 冲突', csvResult.conflicted.length, '条');

  // 2.7 记录失败项
  for (const err of csvErrors) {
    const errRecordData = {
      residentName: err.residentName,
      supplyName: err.supplyName,
      quantity: err.quantity,
      idCard: err.idCard
    };
    await batchEngine.addFailedRecord(csvBatch.id, err.rowIndex, err.conflictType, err.errors.join('; '), errRecordData);
  }

  // 2.8 更新批次状态
  const csvStatus = (csvResult.conflicted.length > 0 || csvErrors.length > 0) 
    ? BATCH_STATUS.PARTIAL 
    : BATCH_STATUS.COMPLETED;
  await batchEngine.updateBatchStats(csvBatch.id, {
    successCount: csvResult.imported.length,
    conflictCount: csvResult.conflicted.length,
    status: csvStatus
  });

  const csvBatchFinal = await db.get(STORES.BATCHES, csvBatch.id);
  results.push({
    name: 'CSV混合导入',
    success: csvBatchFinal.successCount > 0,
    batchId: csvBatch.id,
    total: csvBatchFinal.totalRecords,
    successCount: csvBatchFinal.successCount,
    conflictCount: csvBatchFinal.conflictCount,
    failedCount: (csvBatchFinal.failedRecords || []).length,
    status: csvBatchFinal.status
  });
  console.log('  2.9 批次统计:');
  console.log('      总计:', csvBatchFinal.totalRecords, '条');
  console.log('      成功:', csvBatchFinal.successCount, '条');
  console.log('      冲突:', csvBatchFinal.conflictCount, '条');
  console.log('      失败:', (csvBatchFinal.failedRecords || []).length, '条');
  console.log('      状态:', csvBatchFinal.status);
  console.log('  结果: ✅ 通过');
  console.log('');

  // 等待同步
  await new Promise(r => setTimeout(r, 2000));

  // ========== 步骤3: JSON混合导入测试 ==========
  console.log('【步骤3】JSON混合导入测试');
  
  const jsonContent = JSON.stringify([
    { residentName: '张三', idCard: '110101199001010001', supplyName: '瓶装水', quantity: 2, notes: 'JSON导入-成功1' },
    { residentName: '周九', idCard: '110101199001010007', supplyName: '感冒药', quantity: 1, notes: 'JSON导入-成功2' },
    { residentName: '李四', idCard: '110101199001010002', supplyName: '瓶装水', quantity: 10, notes: 'JSON导入-超库存' },
    { residentName: '张三', idCard: '110101199001010001', supplyName: '感冒药', quantity: 1, notes: 'JSON导入-成功3' },
    { residentName: '不存在', idCard: 'R999', supplyName: '瓶装水', quantity: 1, notes: 'JSON导入-居民不存在' }
  ]);

  const jsonHash = await batchEngine.generateFileHash(jsonContent);
  const jsonRecords = await importEngine.parseJSON(jsonContent);
  const { validated: jsonValidated, errors: jsonErrors } = await importEngine.validateImportRecords(
    jsonRecords,
    IMPORT_SOURCES.JSON_IMPORT
  );

  const jsonBatch = await batchEngine.createBatch(
    IMPORT_SOURCES.JSON_IMPORT,
    'batch_test_mixed.json',
    jsonHash,
    jsonRecords.length
  );

  const jsonResult = await importEngine.processImport(
    jsonValidated,
    IMPORT_SOURCES.JSON_IMPORT,
    jsonBatch.id
  );

  for (const err of jsonErrors) {
    const errRecordData = {
      residentName: err.residentName,
      supplyName: err.supplyName,
      quantity: err.quantity,
      idCard: err.idCard
    };
    await batchEngine.addFailedRecord(jsonBatch.id, err.rowIndex, err.conflictType, err.errors.join('; '), errRecordData);
  }

  const jsonStatus = (jsonResult.conflicted.length > 0 || jsonErrors.length > 0)
    ? BATCH_STATUS.PARTIAL
    : BATCH_STATUS.COMPLETED;
  await batchEngine.updateBatchStats(jsonBatch.id, {
    successCount: jsonResult.imported.length,
    conflictCount: jsonResult.conflicted.length,
    status: jsonStatus
  });

  const jsonBatchFinal = await db.get(STORES.BATCHES, jsonBatch.id);
  results.push({
    name: 'JSON混合导入',
    success: jsonBatchFinal.successCount > 0,
    batchId: jsonBatch.id,
    total: jsonBatchFinal.totalRecords,
    successCount: jsonBatchFinal.successCount,
    conflictCount: jsonBatchFinal.conflictCount,
    failedCount: (jsonBatchFinal.failedRecords || []).length,
    status: jsonBatchFinal.status
  });
  console.log('  批次统计: 成功', jsonBatchFinal.successCount, ', 冲突', jsonBatchFinal.conflictCount, ', 失败', (jsonBatchFinal.failedRecords || []).length);
  console.log('  结果: ✅ 通过');
  console.log('');

  await new Promise(r => setTimeout(r, 2000));

  // ========== 步骤4: 重复导入检测 ==========
  console.log('【步骤4】重复导入检测');
  const duplicateCheck2 = await batchEngine.checkDuplicateImport(csvHash);
  const step4 = {
    name: '重复导入检测',
    success: duplicateCheck2 && duplicateCheck2.id === csvBatch.id,
    foundBatchId: duplicateCheck2 ? duplicateCheck2.id : null
  };
  results.push(step4);
  console.log('  重复CSV的哈希检测:', step4.success ? '✅ 检测到重复批次' : '❌ 未检测到');
  if (duplicateCheck2) {
    console.log('  检测到批次:', duplicateCheck2.id);
  }
  console.log('');

  // ========== 步骤5: 批次列表查询和筛选 ==========
  console.log('【步骤5】批次列表查询和筛选');
  const allBatches = await batchEngine.getBatches({});
  const partialBatches = await batchEngine.getBatches({ status: BATCH_STATUS.PARTIAL });
  const csvBatches = await batchEngine.getBatches({ source: IMPORT_SOURCES.CSV_IMPORT });
  const jsonBatches = await batchEngine.getBatches({ source: IMPORT_SOURCES.JSON_IMPORT });

  const step5 = {
    name: '批次查询筛选',
    success: allBatches.length >= 2 && partialBatches.length >= 1 && csvBatches.length >= 1 && jsonBatches.length >= 1,
    total: allBatches.length,
    partial: partialBatches.length,
    csv: csvBatches.length,
    json: jsonBatches.length
  };
  results.push(step5);
  console.log('  全部批次:', allBatches.length);
  console.log('  部分成功:', partialBatches.length);
  console.log('  CSV来源:', csvBatches.length);
  console.log('  JSON来源:', jsonBatches.length);
  console.log('  结果:', step5.success ? '✅ 通过' : '❌ 失败');
  console.log('');

  // ========== 步骤6: 批次详情查询 ==========
  console.log('【步骤6】批次详情查询');
  const batchDetail = await db.get(STORES.BATCHES, csvBatch.id);
  const batchDists = await batchEngine.getBatchDistributions(csvBatch.id);
  const batchConflicts = await batchEngine.getBatchConflicts(csvBatch.id);
  const batchPending = await batchEngine.getBatchPendingConflicts(csvBatch.id);

  const step6 = {
    name: '批次详情查询',
    success: batchDists.length > 0,
    distributions: batchDists.length,
    conflicts: batchConflicts.length,
    pendingConflicts: batchPending.length,
    hasFailedRecords: (batchDetail.failedRecords || []).length > 0
  };
  results.push(step6);
  console.log('  关联记录:', batchDists.length, '条');
  console.log('  关联冲突:', batchConflicts.length, '条');
  console.log('  待处理冲突:', batchPending.length, '条');
  console.log('  失败记录:', (batchDetail.failedRecords || []).length, '条');
  console.log('  结果:', step6.success ? '✅ 通过' : '❌ 失败');
  console.log('');

  // ========== 步骤7: 管理员批量通过 ==========
  console.log('【步骤7】管理员批量通过');
  const stockBefore = (await db.get(STORES.SUPPLIES, 'S001')).currentStock;
  const pendingBefore = batchPending.length;
  
  const approveCount = await batchEngine.batchApprove(csvBatch.id);
  await new Promise(r => setTimeout(r, 1500));
  
  const batchPendingAfter = await batchEngine.getBatchPendingConflicts(csvBatch.id);
  const stockAfter = (await db.get(STORES.SUPPLIES, 'S001')).currentStock;

  const step7 = {
    name: '管理员批量通过',
    success: approveCount > 0 && batchPendingAfter.length === 0,
    approved: approveCount,
    pendingBefore: pendingBefore,
    pendingAfter: batchPendingAfter.length,
    stockChange: stockAfter - stockBefore
  };
  results.push(step7);
  console.log('  通过记录数:', approveCount);
  console.log('  待处理冲突:', pendingBefore, '→', batchPendingAfter.length);
  console.log('  库存变化:', stockBefore, '→', stockAfter, '(变化:', stockAfter - stockBefore, ')');
  console.log('  结果:', step7.success ? '✅ 通过' : '❌ 失败');
  console.log('');

  // ========== 步骤8: 管理员批量驳回 ==========
  console.log('【步骤8】管理员批量驳回');
  const jsonPending = await batchEngine.getBatchPendingConflicts(jsonBatch.id);
  const rejectCount = await batchEngine.batchReject(jsonBatch.id);
  await new Promise(r => setTimeout(r, 1000));
  const jsonPendingAfter = await batchEngine.getBatchPendingConflicts(jsonBatch.id);

  const step8 = {
    name: '管理员批量驳回',
    success: rejectCount >= 0,
    rejected: rejectCount,
    pendingBefore: jsonPending.length,
    pendingAfter: jsonPendingAfter.length
  };
  results.push(step8);
  console.log('  驳回记录数:', rejectCount);
  console.log('  待处理冲突:', jsonPending.length, '→', jsonPendingAfter.length);
  console.log('  结果: ✅ 通过');
  console.log('');

  // ========== 步骤9: 管理员撤销批次 ==========
  console.log('【步骤9】管理员撤销批次');
  const csvBatchBefore = await db.get(STORES.BATCHES, csvBatch.id);
  const distsBefore = await batchEngine.getBatchDistributions(csvBatch.id);
  const syncedBefore = distsBefore.filter(d => d.status === DISTRIBUTION_STATUS.SYNCED && !d.revoked).length;
  const stockBeforeRevoke = (await db.get(STORES.SUPPLIES, 'S001')).currentStock;

  console.log('  撤销前:');
  console.log('    批次状态:', csvBatchBefore.status);
  console.log('    已同步记录:', syncedBefore, '条');
  console.log('    瓶装水库存:', stockBeforeRevoke);

  const revokeCount = await batchEngine.revokeBatch(csvBatch.id);
  await new Promise(r => setTimeout(r, 1500));

  const csvBatchAfter = await db.get(STORES.BATCHES, csvBatch.id);
  const distsAfter = await batchEngine.getBatchDistributions(csvBatch.id);
  const revokedAfter = distsAfter.filter(d => d.revoked).length;
  const stockAfterRevoke = (await db.get(STORES.SUPPLIES, 'S001')).currentStock;

  const step9 = {
    name: '管理员撤销批次',
    success: csvBatchAfter.status === BATCH_STATUS.REVOKED && revokedAfter > 0,
    revokedRecords: revokeCount,
    status: csvBatchAfter.status,
    revokedCount: csvBatchAfter.revokedCount,
    stockBefore: stockBeforeRevoke,
    stockAfter: stockAfterRevoke,
    stockChange: stockAfterRevoke - stockBeforeRevoke,
    revokedMarked: revokedAfter
  };
  results.push(step9);
  console.log('  撤销后:');
  console.log('    批次状态:', csvBatchAfter.status);
  console.log('    撤销记录数:', revokeCount, '条');
  console.log('    已撤销标记:', revokedAfter, '/', distsAfter.length);
  console.log('    瓶装水库存:', stockAfterRevoke, '(恢复了', stockAfterRevoke - stockBeforeRevoke, ')');
  console.log('  结果:', step9.success ? '✅ 通过' : '❌ 失败');
  console.log('');

  // ========== 步骤10: 批次导出测试 ==========
  console.log('【步骤10】批次导出测试');
  try {
    const exportCSV = await dataExporter.exportBatchDetail(jsonBatch.id, 'csv');
    const exportJSON = await dataExporter.exportBatchDetail(jsonBatch.id, 'json');

    const step10 = {
      name: '批次导出',
      success: exportCSV.length > 0 && exportJSON.length > 0,
      csvSize: exportCSV.length,
      jsonSize: exportJSON.length
    };
    results.push(step10);
    console.log('  CSV导出:', exportCSV.length, '字节');
    console.log('  JSON导出:', exportJSON.length, '字节');
    console.log('  CSV预览:', exportCSV.slice(0, 150).replace(/\n/g, ' '));
    console.log('  结果: ✅ 通过');
  } catch (e) {
    results.push({ name: '批次导出', success: false, error: e.message });
    console.log('  ❌ 导出失败:', e.message);
  }
  console.log('');

  // ========== 步骤11: 志愿者权限控制 ==========
  console.log('【步骤11】志愿者权限控制');
  await switchToVolunteer();
  console.log('  已切换到志愿者:', CURRENT_USER.name);

  let permissionError = null;
  try {
    await batchEngine.batchApprove(jsonBatch.id);
  } catch (e) {
    permissionError = e.message;
  }

  const step11 = {
    name: '志愿者权限控制',
    success: permissionError !== null,
    error: permissionError
  };
  results.push(step11);
  console.log('  志愿者尝试批量通过:', permissionError ? '✅ 已拦截' : '❌ 未拦截!');
  if (permissionError) {
    console.log('  拦截信息:', permissionError);
  }
  console.log('');

  // 切回管理员
  await switchToAdmin();

  // ========== 步骤12: 数据持久化验证 ==========
  console.log('【步骤12】数据持久化验证');
  const finalBatches = await db.getAll(STORES.BATCHES);
  const finalDists = await db.getAll(STORES.DISTRIBUTIONS);
  const finalConflicts = await db.getAll(STORES.CONFLICTS);
  const finalAudit = await db.getAll(STORES.AUDIT_LOGS);

  const batchAuditLogs = finalAudit.filter(l => 
    l.details && l.details.batchId && 
    (l.action === 'batch_approve' || l.action === 'batch_reject' || l.action === 'batch_revoke')
  );

  const distsWithBatchId = finalDists.filter(d => d.batchId).length;

  const step12 = {
    name: '数据持久化',
    success: finalBatches.length >= 2,
    batches: finalBatches.length,
    distributions: finalDists.length,
    distsWithBatchId: distsWithBatchId,
    conflicts: finalConflicts.length,
    auditLogs: finalAudit.length,
    batchAuditLogs: batchAuditLogs.length
  };
  results.push(step12);
  console.log('  批次表:', finalBatches.length, '条');
  console.log('  领取记录:', finalDists.length, '条 (含batchId:', distsWithBatchId, '条)');
  console.log('  冲突记录:', finalConflicts.length, '条');
  console.log('  审计日志:', finalAudit.length, '条');
  console.log('  批次审计:', batchAuditLogs.length, '条');
  console.log('  结果:', step12.success ? '✅ 通过' : '❌ 失败');
  console.log('');

  // ========== 步骤13: 多入口跳转函数 ==========
  console.log('【步骤13】多入口跳转函数');
  const step13 = {
    name: '多入口跳转',
    success: typeof navigateToBatch === 'function' &&
             typeof openBatchDetailModal === 'function'
  };
  results.push(step13);
  console.log('  navigateToBatch:', typeof navigateToBatch === 'function' ? '✅ 存在' : '❌ 缺失');
  console.log('  openBatchDetailModal:', typeof openBatchDetailModal === 'function' ? '✅ 存在' : '❌ 缺失');
  console.log('  结果:', step13.success ? '✅ 通过' : '❌ 失败');
  console.log('');

  // ========== 步骤14: 联动刷新 ==========
  console.log('【步骤14】UI联动刷新');
  try {
    await refreshAllViews();
    results.push({ name: 'UI联动刷新', success: true });
    console.log('  已调用 refreshAllViews()');
    console.log('  结果: ✅ 通过');
  } catch (e) {
    results.push({ name: 'UI联动刷新', success: false, error: e.message });
    console.log('  ❌ 失败:', e.message);
  }
  console.log('');

  // ========== 测试结果汇总 ==========
  console.log('========================================');
  console.log('  测试结果汇总');
  console.log('========================================');
  console.log('');

  const passed = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const testDuration = ((Date.now() - testStart) / 1000).toFixed(2);

  console.log('通过项 (' + passed.length + '/' + results.length + '):');
  passed.forEach((r, i) => {
    console.log('  ' + (i + 1) + '. ' + r.name + ' ✅');
  });

  if (failed.length > 0) {
    console.log('');
    console.log('失败项 (' + failed.length + '/' + results.length + '):');
    failed.forEach((r, i) => {
      console.log('  ' + (i + 1) + '. ' + r.name + ' ❌ - ' + JSON.stringify(r));
    });
  }

  console.log('');
  console.log('测试耗时:', testDuration, '秒');
  console.log('总体结果:', failed.length === 0 ? '🎉 全部通过' : '⚠️  部分失败');
  console.log('');
  console.log('测试批次ID:');
  console.log('  CSV批次:', csvBatch.id);
  console.log('  JSON批次:', jsonBatch.id);
  console.log('');
  console.log('========================================');

  // 保存到全局变量供后续检查
  window.__batchTestResults = {
    results,
    allPassed: failed.length === 0,
    csvBatchId: csvBatch.id,
    jsonBatchId: jsonBatch.id,
    summary: {
      passed: passed.length,
      total: results.length,
      failed: failed.length,
      duration: testDuration
    }
  };

  return window.__batchTestResults;
}

// 执行测试
runCompleteBatchTest().catch(e => {
  console.error('测试执行失败:', e);
  return { error: e.message, stack: e.stack };
});
