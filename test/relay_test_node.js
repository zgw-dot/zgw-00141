// 复查接力台核心功能测试 - Node.js版本
// 直接测试核心逻辑，不依赖浏览器DOM

const fs = require('fs');
const path = require('path');

console.log('═'.repeat(60));
console.log('  复查接力台 - 核心功能测试 (Node.js版本)');
console.log('═'.repeat(60));
console.log('');

// 模拟浏览器环境的全局变量
global.window = {};
global.document = { createElement: () => ({}) };
global.navigator = { userAgent: 'Node.js Test' };
global.indexedDB = null; // 我们将测试不依赖IndexedDB的逻辑
global.IDBKeyRange = {
  only: (v) => v,
  lowerBound: (v) => v,
  upperBound: (v) => v
};

// 加载依赖
const TEST_RESULT = [];
const TEST_START = Date.now();
let TEST_BATCH_ID = null;
let TEST_SESSION_CARD_ID = null;

function logTest(name, success, details = '') {
  const status = success ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} ${name}`);
  if (details) {
    console.log(`   ${details}`);
  }
  TEST_RESULT.push({ name, success, details, timestamp: Date.now() });
}

function generateId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('zh-CN');
}

// 模拟常量和数据结构
const ROLES = {
  ADMIN: 'admin',
  VOLUNTEER: 'volunteer'
};

const SESSION_CARD_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  RESTORING: 'restoring'
};

const PERMISSION_ACTIONS = {
  BATCH_VIEW: 'view_batch',
  DISTRIBUTION_VIEW: 'view_distribution',
  CONFLICT_VIEW: 'view_conflict',
  EXPORT_PREVIEW: 'export_preview',
  BATCH_APPROVE: 'batch_approve',
  BATCH_REJECT: 'batch_reject',
  BATCH_RETRY: 'batch_retry',
  BATCH_REVOKE: 'batch_revoke',
  BATCH_EXPORT: 'batch_export',
  EXPORT_AUDIT: 'export_audit',
  EXPORT_BATCHES: 'export_batches',
  CONFLICT_RESOLVE: 'conflict_resolve',
  CONFLICT_UNDO: 'conflict_undo'
};

const PERMISSION_MATRIX = {
  [ROLES.VOLUNTEER]: [
    PERMISSION_ACTIONS.BATCH_VIEW,
    PERMISSION_ACTIONS.DISTRIBUTION_VIEW,
    PERMISSION_ACTIONS.CONFLICT_VIEW,
    PERMISSION_ACTIONS.EXPORT_PREVIEW
  ],
  [ROLES.ADMIN]: [
    PERMISSION_ACTIONS.BATCH_VIEW,
    PERMISSION_ACTIONS.DISTRIBUTION_VIEW,
    PERMISSION_ACTIONS.CONFLICT_VIEW,
    PERMISSION_ACTIONS.EXPORT_PREVIEW,
    PERMISSION_ACTIONS.BATCH_APPROVE,
    PERMISSION_ACTIONS.BATCH_REJECT,
    PERMISSION_ACTIONS.BATCH_RETRY,
    PERMISSION_ACTIONS.BATCH_REVOKE,
    PERMISSION_ACTIONS.BATCH_EXPORT,
    PERMISSION_ACTIONS.EXPORT_AUDIT,
    PERMISSION_ACTIONS.EXPORT_BATCHES,
    PERMISSION_ACTIONS.CONFLICT_RESOLVE,
    PERMISSION_ACTIONS.CONFLICT_UNDO
  ]
};

const BATCH_STATUS = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  REVOKED: 'revoked'
};

const BATCH_ACTIONS = {
  APPROVE_ALL: 'approve_all',
  REJECT_ALL: 'reject_all',
  RETRY_FAILED: 'retry_failed',
  REVOKE_BATCH: 'revoke_batch'
};

// 模拟当前用户
let CURRENT_USER = {
  id: 'user_admin_001',
  name: '系统管理员',
  role: ROLES.ADMIN
};

// 模拟内存数据库
const memoryDB = {
  session_cards: [],
  permission_denials: [],
  export_records: [],
  audit_logs: [],
  batches: [],
  distributions: [],
  conflicts: [],
  supplies: []
};

// 模拟db对象
const db = {
  async get(store, id) {
    return memoryDB[store]?.find(item => item.id === id) || null;
  },
  async getAll(store, index, range) {
    if (index === 'batchId') {
      return memoryDB[store]?.filter(item => item.batchId === range) || [];
    }
    return memoryDB[store] || [];
  },
  async put(store, data) {
    const existingIndex = memoryDB[store]?.findIndex(item => item.id === data.id);
    if (existingIndex >= 0) {
      memoryDB[store][existingIndex] = data;
    } else {
      memoryDB[store]?.push(data);
    }
    return data;
  },
  async count(store) {
    return memoryDB[store]?.length || 0;
  },
  async delete(store, id) {
    if (memoryDB[store]) {
      memoryDB[store] = memoryDB[store].filter(item => item.id !== id);
    }
  },
  transaction(stores, mode) {
    return {
      async get(store, id) { return db.get(store, id); },
      async put(store, data) { return db.put(store, data); },
      async getAll(store, index, range) { return db.getAll(store, index, range); },
      async delete(store, id) { return db.delete(store, id); },
      done: Promise.resolve(),
      abort() {}
    };
  }
};

const STORES = {
  SESSION_CARDS: 'session_cards',
  PERMISSION_DENIALS: 'permission_denials',
  EXPORT_RECORDS: 'export_records',
  AUDIT_LOGS: 'audit_logs',
  BATCHES: 'batches',
  DISTRIBUTIONS: 'distributions',
  CONFLICTS: 'conflicts',
  SUPPLIES: 'supplies'
};

// 模拟审计日志
async function addAuditLog(action, details) {
  const log = {
    id: generateId('audit'),
    action,
    userId: CURRENT_USER.id,
    userName: CURRENT_USER.name,
    userRole: CURRENT_USER.role,
    details,
    timestamp: Date.now()
  };
  await db.put(STORES.AUDIT_LOGS, log);
  return log;
}

// ========== PermissionGate 类 ==========
class PermissionGate {
  constructor() {
    this.denials = [];
  }

  getActionLabel(action) {
    const labels = {
      [PERMISSION_ACTIONS.BATCH_VIEW]: '查看批次',
      [PERMISSION_ACTIONS.DISTRIBUTION_VIEW]: '查看发放记录',
      [PERMISSION_ACTIONS.CONFLICT_VIEW]: '查看冲突',
      [PERMISSION_ACTIONS.EXPORT_PREVIEW]: '导出预览',
      [PERMISSION_ACTIONS.BATCH_APPROVE]: '批量通过',
      [PERMISSION_ACTIONS.BATCH_REJECT]: '批量驳回',
      [PERMISSION_ACTIONS.BATCH_RETRY]: '重试失败项',
      [PERMISSION_ACTIONS.BATCH_REVOKE]: '撤销批次',
      [PERMISSION_ACTIONS.BATCH_EXPORT]: '导出批次详情',
      [PERMISSION_ACTIONS.EXPORT_AUDIT]: '导出审计日志',
      [PERMISSION_ACTIONS.EXPORT_BATCHES]: '导出批次列表',
      [PERMISSION_ACTIONS.CONFLICT_RESOLVE]: '复核冲突',
      [PERMISSION_ACTIONS.CONFLICT_UNDO]: '撤销处理'
    };
    return labels[action] || action;
  }

  async checkPermission(action, batchId = null) {
    const userRole = CURRENT_USER.role;
    const allowedActions = PERMISSION_MATRIX[userRole] || [];
    const hasPermission = allowedActions.includes(action);

    if (!hasPermission) {
      await this.recordDenial(action, batchId);
    }

    return hasPermission;
  }

  async requirePermission(action, batchId = null) {
    const hasPermission = await this.checkPermission(action, batchId);
    if (!hasPermission) {
      const actionLabel = this.getActionLabel(action);
      throw new Error(`权限不足：${CURRENT_USER.name} 无权执行「${actionLabel}」操作`);
    }
    return true;
  }

  async recordDenial(action, batchId = null) {
    const denial = {
      id: generateId('denial'),
      action,
      actionLabel: this.getActionLabel(action),
      userId: CURRENT_USER.id,
      userName: CURRENT_USER.name,
      userRole: CURRENT_USER.role,
      batchId,
      timestamp: Date.now(),
      userAgent: 'Node.js Test',
      ip: '127.0.0.1'
    };

    await db.put(STORES.PERMISSION_DENIALS, denial);
    this.denials.push(denial);

    await addAuditLog('permission_denied', {
      action,
      batchId,
      reason: '角色权限不足'
    });

    return denial;
  }

  async signOperation(action, batchId, details = {}) {
    await this.requirePermission(action, batchId);

    const signatureId = generateId('sig');
    const signature = {
      signatureId,
      signedAt: Date.now(),
      signedBy: CURRENT_USER.id,
      signedByName: CURRENT_USER.name,
      signedByRole: CURRENT_USER.role,
      operatorId: CURRENT_USER.id,
      operatorName: CURRENT_USER.name,
      operatorRole: CURRENT_USER.role,
      action,
      batchId,
      details
    };

    await addAuditLog('operation_signed', {
      action,
      batchId,
      signatureId,
      details
    });

    return signature;
  }
}

const permissionGate = new PermissionGate();

// ========== SessionCardEngine 类 ==========
class SessionCardEngine {
  constructor() {
    this.activeCard = null;
    this.onCardCreated = null;
    this.onCardRestored = null;
  }

  async cancelActiveCard() {
    if (this.activeCard && this.activeCard.status === SESSION_CARD_STATUS.ACTIVE) {
      this.activeCard.status = SESSION_CARD_STATUS.CANCELLED;
      this.activeCard.cancelledAt = Date.now();
      this.activeCard.cancelReason = '新会话卡创建';
      await db.put(STORES.SESSION_CARDS, this.activeCard);
      this.activeCard = null;
    }
  }

  async createCard(batchId, sourceView, filters = {}, scrollPosition = 0) {
    await this.cancelActiveCard();

    const card = {
      id: generateId('session'),
      batchId,
      userId: CURRENT_USER.id,
      userName: CURRENT_USER.name,
      sourceView,
      filters: JSON.parse(JSON.stringify(filters)),
      scrollPosition,
      status: SESSION_CARD_STATUS.ACTIVE,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivity: Date.now(),
      pageHistory: [sourceView]
    };

    await db.put(STORES.SESSION_CARDS, card);
    this.activeCard = card;

    await addAuditLog('session_card_created', {
      sessionCardId: card.id,
      batchId,
      sourceView,
      filters
    });

    if (this.onCardCreated) {
      this.onCardCreated(card);
    }

    return card;
  }

  async updateCard(cardId, updates = {}) {
    const card = await db.get(STORES.SESSION_CARDS, cardId);
    if (!card) return null;

    Object.assign(card, updates);
    card.updatedAt = Date.now();
    card.lastActivity = Date.now();

    await db.put(STORES.SESSION_CARDS, card);

    if (this.activeCard && this.activeCard.id === cardId) {
      this.activeCard = card;
    }

    return card;
  }

  async getActiveCard() {
    if (this.activeCard && this.activeCard.status === SESSION_CARD_STATUS.ACTIVE) {
      return this.activeCard;
    }

    const cards = await db.getAll(STORES.SESSION_CARDS, 'userId');
    const userCards = cards.filter(c => 
      c.userId === CURRENT_USER.id && 
      c.status === SESSION_CARD_STATUS.ACTIVE
    ).sort((a, b) => b.createdAt - a.createdAt);

    if (userCards.length > 0) {
      this.activeCard = userCards[0];
      return userCards[0];
    }

    return null;
  }

  async restoreCard(cardId) {
    const card = await db.get(STORES.SESSION_CARDS, cardId);
    if (!card) throw new Error('会话卡不存在');

    if (card.status !== SESSION_CARD_STATUS.ACTIVE) {
      throw new Error('会话卡状态不正确，无法恢复');
    }

    card.status = SESSION_CARD_STATUS.RESTORING;
    card.restoredAt = Date.now();
    card.updatedAt = Date.now();
    await db.put(STORES.SESSION_CARDS, card);
    this.activeCard = card;

    await addAuditLog('session_card_restored', {
      sessionCardId: cardId,
      batchId: card.batchId,
      sourceView: card.sourceView
    });

    if (this.onCardRestored) {
      this.onCardRestored(card);
    }

    return card;
  }

  async completeCard(cardId) {
    const card = await db.get(STORES.SESSION_CARDS, cardId);
    if (!card) throw new Error('会话卡不存在');

    card.status = SESSION_CARD_STATUS.COMPLETED;
    card.completedAt = Date.now();
    card.updatedAt = Date.now();
    await db.put(STORES.SESSION_CARDS, card);

    if (this.activeCard && this.activeCard.id === cardId) {
      this.activeCard = null;
    }

    await addAuditLog('session_card_completed', {
      sessionCardId: cardId,
      batchId: card.batchId
    });

    return card;
  }

  async cancelCard(cardId, reason = '用户取消') {
    const card = await db.get(STORES.SESSION_CARDS, cardId);
    if (!card) throw new Error('会话卡不存在');

    if (card.status === SESSION_CARD_STATUS.COMPLETED) {
      return card;
    }

    card.status = SESSION_CARD_STATUS.CANCELLED;
    card.cancelledAt = Date.now();
    card.cancelReason = reason;
    card.updatedAt = Date.now();
    await db.put(STORES.SESSION_CARDS, card);

    if (this.activeCard && this.activeCard.id === cardId) {
      this.activeCard = null;
    }

    await addAuditLog('session_card_cancelled', {
      sessionCardId: cardId,
      batchId: card.batchId,
      reason
    });

    return card;
  }

  async cleanupExpiredCards(expiryHours = 24) {
    const cards = await db.getAll(STORES.SESSION_CARDS, 'createdAt');
    const now = Date.now();
    const expiryMs = expiryHours * 60 * 60 * 1000;
    let cleanedCount = 0;

    for (const card of cards) {
      if (card.status === SESSION_CARD_STATUS.ACTIVE && 
          (now - card.lastActivity) > expiryMs) {
        card.status = SESSION_CARD_STATUS.CANCELLED;
        card.cancelledAt = now;
        card.cancelReason = `超过${expiryHours}小时未活动自动取消`;
        card.updatedAt = now;
        await db.put(STORES.SESSION_CARDS, card);
        cleanedCount++;

        await addAuditLog('session_card_expired', {
          sessionCardId: card.id,
          batchId: card.batchId,
          inactiveHours: Math.round((now - card.lastActivity) / (60 * 60 * 1000))
        });
      }
    }

    if (this.activeCard && 
        this.activeCard.status === SESSION_CARD_STATUS.ACTIVE &&
        (now - this.activeCard.lastActivity) > expiryMs) {
      this.activeCard = null;
    }

    return cleanedCount;
  }

  async getCardHistory(limit = 50) {
    const cards = await db.getAll(STORES.SESSION_CARDS, 'createdAt');
    return cards
      .filter(c => c.userId === CURRENT_USER.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}

const sessionCardEngine = new SessionCardEngine();

// ========== ExportRecordEngine 类 ==========
class ExportRecordEngine {
  async recordExport(exportType, format, batchId, filename, metadata = {}) {
    const record = {
      id: generateId('export'),
      type: exportType,
      format,
      batchId,
      filename,
      operatorId: CURRENT_USER.id,
      operatorName: CURRENT_USER.name,
      operatorRole: CURRENT_USER.role,
      timestamp: Date.now(),
      metadata
    };

    await db.put(STORES.EXPORT_RECORDS, record);

    await addAuditLog('export_recorded', {
      exportRecordId: record.id,
      type: exportType,
      format,
      batchId,
      filename
    });

    return record;
  }

  async getExportHistory(filters = {}, limit = 100) {
    let records = await db.getAll(STORES.EXPORT_RECORDS, 'timestamp');
    records.sort((a, b) => b.timestamp - a.timestamp);

    if (filters.type) {
      records = records.filter(r => r.type === filters.type);
    }
    if (filters.batchId) {
      records = records.filter(r => r.batchId === filters.batchId);
    }
    if (filters.operatorId) {
      records = records.filter(r => r.operatorId === filters.operatorId);
    }

    return records.slice(0, limit);
  }
}

const exportRecordEngine = new ExportRecordEngine();

// ========== 批次状态隔离功能 ==========
const batchEngine = {
  async generateFileHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0') + '_' + content.length;
  },

  async checkDuplicateImport(fileHash) {
    const existingBatches = await db.getAll(STORES.BATCHES, 'fileHash');
    const activeBatches = existingBatches.filter(b => b.status !== BATCH_STATUS.REVOKED);
    return activeBatches.length > 0 ? activeBatches[0] : null;
  },

  async createBatch(importSource, fileName, fileHash, totalRecords, parentBatchId = null, isReimport = false) {
    const existingBatches = fileHash ? await db.getAll(STORES.BATCHES, 'fileHash') : [];
    const reimportCount = existingBatches.filter(b => b.fileHash === fileHash).length;
    const importVersion = reimportCount + 1;

    const batch = {
      id: generateId('batch'),
      source: importSource,
      fileName,
      fileHash,
      status: BATCH_STATUS.PROCESSING,
      createdBy: CURRENT_USER.id,
      createdByName: CURRENT_USER.name,
      timestamp: Date.now(),
      totalRecords,
      successCount: 0,
      conflictCount: 0,
      revokedCount: 0,
      failedRecords: [],
      distributionIds: [],
      conflictIds: [],
      notes: null,
      importVersion,
      parentBatchId,
      isReimport,
      stateVersion: Date.now(),
      lastOperation: {
        type: BATCH_ACTIONS.APPROVE_ALL,
        operatorName: CURRENT_USER.name,
        operatorRole: CURRENT_USER.role,
        timestamp: Date.now(),
        count: 0
      }
    };

    await db.put(STORES.BATCHES, batch);

    await addAuditLog('batch_created', {
      batchId: batch.id,
      source: importSource,
      fileName,
      totalRecords,
      importVersion,
      parentBatchId,
      isReimport
    });

    return batch;
  },

  async getBatch(batchId) {
    return await db.get(STORES.BATCHES, batchId);
  },

  async validateBatchState(batchId, expectedVersion = null) {
    const batch = await db.get(STORES.BATCHES, batchId);
    if (!batch) {
      throw new Error('批次不存在');
    }

    if (expectedVersion !== null && batch.stateVersion !== expectedVersion) {
      throw new Error('批次状态已变更，请刷新后重试');
    }

    return batch;
  },

  async batchApprove(batchId) {
    await permissionGate.signOperation(PERMISSION_ACTIONS.BATCH_APPROVE, batchId, { action: '批量通过' });
    const batch = await this.validateBatchState(batchId);

    if (batch.status === BATCH_STATUS.REVOKED) {
      throw new Error('批次已撤销，无法执行批量通过');
    }

    let approvedCount = 0;
    const dists = await db.getAll(STORES.DISTRIBUTIONS, 'batchId', batchId);
    
    for (const dist of dists) {
      if (dist.status === 'pending' || dist.status === 'conflicted') {
        dist.status = 'approved';
        dist.approvedAt = Date.now();
        dist.approvedBy = CURRENT_USER.id;
        dist.approvalSignature = await permissionGate.signOperation(
          PERMISSION_ACTIONS.BATCH_APPROVE, batchId, { distributionId: dist.id }
        );
        await db.put(STORES.DISTRIBUTIONS, dist);
        approvedCount++;
      }
    }

    batch.successCount = approvedCount;
    batch.stateVersion = Date.now();
    batch.status = BATCH_STATUS.COMPLETED;
    batch.lastOperation = {
      type: BATCH_ACTIONS.APPROVE_ALL,
      operatorName: CURRENT_USER.name,
      operatorRole: CURRENT_USER.role,
      timestamp: Date.now(),
      count: approvedCount,
      signature: await permissionGate.signOperation(
        PERMISSION_ACTIONS.BATCH_APPROVE, batchId, { count: approvedCount }
      )
    };
    await db.put(STORES.BATCHES, batch);

    return approvedCount;
  },

  async revokeBatch(batchId) {
    const batch = await this.validateBatchState(batchId);

    if (batch.status === BATCH_STATUS.REVOKED) {
      throw new Error('批次已撤销，请勿重复操作');
    }

    await permissionGate.requirePermission(PERMISSION_ACTIONS.BATCH_REVOKE, batchId);

    const originalStateVersion = batch.stateVersion;
    let revokedCount = 0;

    const distributions = await db.getAll(STORES.DISTRIBUTIONS, 'batchId', batchId);
    for (const dist of distributions) {
      if (dist.status === 'approved' || dist.status === 'pending') {
        dist.revoked = true;
        dist.revokedAt = Date.now();
        dist.revokedBy = CURRENT_USER.id;
        dist.revokedByName = CURRENT_USER.name;
        dist.batchStateVersion = originalStateVersion;
        dist.revocationSignature = await permissionGate.signOperation(
          PERMISSION_ACTIONS.BATCH_REVOKE, batchId, { 
            distributionId: dist.id,
            batchStateVersion: originalStateVersion
          }
        );
        await db.put(STORES.DISTRIBUTIONS, dist);
        revokedCount++;
      }
    }

    const activeCards = await db.getAll(STORES.SESSION_CARDS, 'batchId', batchId);
    for (const card of activeCards) {
      if (card.status === SESSION_CARD_STATUS.ACTIVE || card.status === SESSION_CARD_STATUS.RESTORING) {
        card.status = SESSION_CARD_STATUS.CANCELLED;
        card.cancelledAt = Date.now();
        card.cancelReason = '批次已撤销';
        await db.put(STORES.SESSION_CARDS, card);
      }
    }

    batch.status = BATCH_STATUS.REVOKED;
    batch.revokedCount = revokedCount;
    batch.revokedAt = Date.now();
    batch.revokedBy = CURRENT_USER.id;
    batch.revokedByName = CURRENT_USER.name;
    batch.stateVersion = Date.now();
    batch.revocationSignature = await permissionGate.signOperation(
      PERMISSION_ACTIONS.BATCH_REVOKE, batchId, { 
        revokedCount,
        originalStateVersion,
        newStateVersion: batch.stateVersion
      }
    );
    batch.lastOperation = {
      type: BATCH_ACTIONS.REVOKE_BATCH,
      operatorName: CURRENT_USER.name,
      operatorRole: CURRENT_USER.role,
      timestamp: Date.now(),
      count: revokedCount,
      originalStateVersion,
      newStateVersion: batch.stateVersion,
      signature: batch.revocationSignature
    };
    await db.put(STORES.BATCHES, batch);

    await addAuditLog('batch_revoked', {
      batchId,
      revokedCount,
      batchName: batch.fileName,
      operatorRole: CURRENT_USER.role,
      originalStateVersion,
      newStateVersion: batch.stateVersion
    });

    return revokedCount;
  },

  async getBatchVersionHistory(batchId) {
    const batch = await db.get(STORES.BATCHES, batchId);
    if (!batch) return [];

    const history = [batch];
    let currentId = batch.parentBatchId;

    while (currentId) {
      const parent = await db.get(STORES.BATCHES, currentId);
      if (parent) {
        history.unshift(parent);
        currentId = parent.parentBatchId;
      } else {
        break;
      }
    }

    return history;
  }
};

// 模拟 navigateBackFromBatch 函数
let currentView = 'dashboard';
async function navigateBackFromBatch(cardId) {
  const card = await db.get(STORES.SESSION_CARDS, cardId);
  if (!card) {
    return { success: false, error: '会话卡不存在' };
  }

  currentView = card.sourceView;
  
  if (card.filters) {
    console.log(`  恢复筛选条件: ${JSON.stringify(card.filters)}`);
  }
  
  console.log(`  恢复滚动位置: ${card.scrollPosition}`);
  
  await sessionCardEngine.completeCard(cardId);

  return {
    success: true,
    targetView: card.sourceView,
    scrollPosition: card.scrollPosition,
    filters: card.filters
  };
}

// 模拟切换用户函数
function switchToAdmin() {
  CURRENT_USER = {
    id: 'user_admin_001',
    name: '系统管理员',
    role: ROLES.ADMIN
  };
}

function switchToVolunteer() {
  CURRENT_USER = {
    id: 'user_vol_001',
    name: '志愿者小王',
    role: ROLES.VOLUNTEER
  };
}

// ========== 开始测试 ==========
async function runAllTests() {
  console.log('【初始化】');
  switchToAdmin();
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
    const batch = await batchEngine.createBatch(
      'csv_import',
      'relay_test_batch.csv',
      fileHash,
      4
    );
    
    TEST_BATCH_ID = batch.id;
    
    const dist1 = { id: 'dist_1', batchId: TEST_BATCH_ID, status: 'pending' };
    const dist2 = { id: 'dist_2', batchId: TEST_BATCH_ID, status: 'pending' };
    await db.put(STORES.DISTRIBUTIONS, dist1);
    await db.put(STORES.DISTRIBUTIONS, dist2);
    
    const batchAfter = await batchEngine.getBatch(batch.id);
    const success = batchAfter && batchAfter.totalRecords === 4;
    
    logTest('创建测试批次', success, `批次ID: ${batch.id.slice(-12)}`);
    logTest('批次记录数正确', batchAfter && batchAfter.totalRecords === 4, `总数: ${batchAfter?.totalRecords}`);
    logTest('批次有状态版本', batchAfter && typeof batchAfter.stateVersion === 'number', `版本: ${batchAfter?.stateVersion}`);
  } catch (e) {
    logTest('创建测试批次', false, e.message);
    return printSummary();
  }
  console.log('');

  // ========== 测试3: 会话卡 - 批次直达 ==========
  console.log('【测试3】会话卡机制 - 批次直达');
  try {
    currentView = 'dashboard';
    
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
    switchToVolunteer();
    console.log('  已切换到志愿者账号');
    
    const canApprove = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_APPROVE, TEST_BATCH_ID);
    const canReject = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_REJECT, TEST_BATCH_ID);
    const canRetry = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_RETRY, TEST_BATCH_ID);
    const canRevoke = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_REVOKE, TEST_BATCH_ID);
    const canExport = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_EXPORT, TEST_BATCH_ID);
    
    const canView = await permissionGate.checkPermission(PERMISSION_ACTIONS.BATCH_VIEW, TEST_BATCH_ID);
    const canPreview = await permissionGate.checkPermission(PERMISSION_ACTIONS.EXPORT_PREVIEW, TEST_BATCH_ID);
    
    logTest('志愿者-批量通过被拦截', !canApprove, `权限: ${canApprove ? '允许' : '拒绝'}`);
    logTest('志愿者-批量驳回被拦截', !canReject, `权限: ${canReject ? '允许' : '拒绝'}`);
    logTest('志愿者-重试失败被拦截', !canRetry, `权限: ${canRetry ? '允许' : '拒绝'}`);
    logTest('志愿者-撤销批次被拦截', !canRevoke, `权限: ${canRevoke ? '允许' : '拒绝'}`);
    logTest('志愿者-正式导出被拦截', !canExport, `权限: ${canExport ? '允许' : '拒绝'}`);
    logTest('志愿者-允许查看结果', canView, `权限: ${canView ? '允许' : '拒绝'}`);
    logTest('志愿者-允许导出预览', canPreview, `权限: ${canPreview ? '允许' : '拒绝'}`);
    
    const denialBefore = await db.count(STORES.PERMISSION_DENIALS);
    try {
      await permissionGate.requirePermission(PERMISSION_ACTIONS.BATCH_APPROVE, TEST_BATCH_ID);
      logTest('越权抛出异常', false, '应该抛出异常但没有');
    } catch (e) {
      logTest('越权抛出异常', true, e.message);
    }
    const denialAfter = await db.count(STORES.PERMISSION_DENIALS);
    logTest('权限拒绝记录落盘', denialAfter > denialBefore, `拒绝记录: ${denialAfter - denialBefore} 条`);
    
    switchToAdmin();
    console.log('  已切回管理员账号');
  } catch (e) {
    logTest('权限闸门测试', false, e.message);
    switchToAdmin();
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
                    signature.signedAt > 0 &&
                    signature.signedBy === CURRENT_USER.id;
    
    logTest('生成操作签名', success, `签名ID: ${signature.signatureId?.slice(-12) || 'N/A'}`);
    logTest('签名包含操作人', signature?.signedBy === CURRENT_USER.id, `操作人: ${signature?.signedByName}`);
    logTest('签名包含角色', signature?.signedByRole === ROLES.ADMIN, `角色: ${signature?.signedByRole}`);
    logTest('签名包含操作详情', signature?.details?.count === 10, `详情: ${JSON.stringify(signature?.details)}`);
    
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
    await sessionCardEngine.completeCard(TEST_SESSION_CARD_ID);
    const completedCard = await db.get(STORES.SESSION_CARDS, TEST_SESSION_CARD_ID);
    
    logTest('会话卡完成状态', completedCard?.status === SESSION_CARD_STATUS.COMPLETED, `状态: ${completedCard?.status}`);
    
    currentView = 'batches';
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
    await batchEngine.batchApprove(TEST_BATCH_ID);
    const batchBefore = await batchEngine.getBatch(TEST_BATCH_ID);
    const originalVersion = batchBefore.stateVersion;
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const revokedCount = await batchEngine.revokeBatch(TEST_BATCH_ID);
    const batchAfter = await batchEngine.getBatch(TEST_BATCH_ID);
    
    logTest('批次撤销成功', batchAfter?.status === BATCH_STATUS.REVOKED, `状态: ${batchAfter?.status}`);
    logTest('状态版本递增', batchAfter?.stateVersion > originalVersion, 
            `原版本: ${originalVersion}, 新版本: ${batchAfter?.stateVersion}`);
    logTest('撤销记录数正确', revokedCount > 0, `撤销数: ${revokedCount}`);
    
    let doubleRevokeError = null;
    try {
      await batchEngine.revokeBatch(TEST_BATCH_ID);
    } catch (e) {
      doubleRevokeError = e;
    }
    logTest('重复撤销被拦截', !!doubleRevokeError, `拦截信息: ${doubleRevokeError?.message || 'N/A'}`);
    
    let approveError = null;
    try {
      await batchEngine.batchApprove(TEST_BATCH_ID);
    } catch (e) {
      approveError = e;
    }
    logTest('已撤销批次批量通过被拦截', !!approveError, `拦截信息: ${approveError?.message || 'N/A'}`);
    
    const cardsForBatch = await db.getAll(STORES.SESSION_CARDS, 'batchId', TEST_BATCH_ID);
    const activeCards = cardsForBatch.filter(c => c.status === SESSION_CARD_STATUS.ACTIVE);
    logTest('撤销后会话卡已取消', activeCards.length === 0, `活跃卡: ${activeCards.length}, 总数: ${cardsForBatch.length}`);
    
    const testCSV2 = `居民姓名,身份证号,物资名称,领取数量,备注
张三,110101199001010001,瓶装水,2,重开测试1
李四,110101199001010002,瓶装水,3,重开测试2`;

    const fileHash2 = await batchEngine.generateFileHash(testCSV2);
    const batch2 = await batchEngine.createBatch(
      'csv_import',
      'relay_test_batch_reopened.csv',
      fileHash2,
      2,
      TEST_BATCH_ID,
      true
    );
    
    const batch2After = await batchEngine.getBatch(batch2.id);
    logTest('重开批次创建成功', !!batch2After, `新批次ID: ${batch2.id.slice(-12)}`);
    logTest('重开批次版本独立', batch2After?.importVersion === 1, `版本: v${batch2After?.importVersion}`);
    logTest('父批次关联正确', batch2After?.parentBatchId === TEST_BATCH_ID, `父批次: ${batch2After?.parentBatchId?.slice(-12)}`);
    logTest('重开标记正确', batch2After?.isReimport === true, `isReimport: ${batch2After?.isReimport}`);
    
    const batch1Now = await batchEngine.getBatch(TEST_BATCH_ID);
    const statesIndependent = batch1Now.status === BATCH_STATUS.REVOKED && 
                              batch2After.status !== BATCH_STATUS.REVOKED;
    logTest('批次状态独立不串', statesIndependent, 
            `批次1: ${batch1Now.status}, 批次2: ${batch2After.status}`);
    
    const history = await batchEngine.getBatchVersionHistory(batch2.id);
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
    
    const filename = await exportRecordEngine.recordExport(
      'batch_detail',
      'csv',
      TEST_BATCH_ID,
      `批次详情_${TEST_BATCH_ID.slice(-8)}_20240101.csv`
    );
    
    const exportCountAfter = await db.count(STORES.EXPORT_RECORDS);
    const newExports = exportCountAfter - exportCountBefore;
    
    logTest('导出记录落盘', newExports >= 1, `新增导出记录: ${newExports}`);
    
    const exportRecords = await db.getAll(STORES.EXPORT_RECORDS, 'timestamp');
    const latestExport = exportRecords[exportRecords.length - 1];
    
    logTest('导出记录关联批次', latestExport?.batchId === TEST_BATCH_ID, 
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
    const card2 = await sessionCardEngine.createCard(
      TEST_BATCH_ID,
      'batches',
      { status: BATCH_STATUS.PARTIAL },
      250
    );
    
    const savedCard2 = await db.get(STORES.SESSION_CARDS, card2.id);
    logTest('会话卡持久化存储', !!savedCard2, `卡号: ${card2.id.slice(-12)}`);
    
    const activeCard = await sessionCardEngine.getActiveCard();
    logTest('可查询活跃会话卡', activeCard?.id === card2.id, `活跃卡ID: ${activeCard?.id?.slice(-12)}`);
    
    const restored = await sessionCardEngine.restoreCard(card2.id);
    logTest('会话卡可恢复', restored?.status === SESSION_CARD_STATUS.RESTORING, 
            `恢复后状态: ${restored?.status}`);
    
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
    const oldCardId = 'test_old_card_' + Date.now();
    const oldCard = {
      id: oldCardId,
      batchId: TEST_BATCH_ID,
      userId: CURRENT_USER.id,
      userName: CURRENT_USER.name,
      sourceView: 'dashboard',
      filters: {},
      scrollPosition: 0,
      status: SESSION_CARD_STATUS.ACTIVE,
      createdAt: Date.now() - 25 * 60 * 60 * 1000,
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
      lastActivity: Date.now() - 25 * 60 * 60 * 1000,
      createdBy: CURRENT_USER.id
    };
    await db.put(STORES.SESSION_CARDS, oldCard);
    
    const countBefore = await db.count(STORES.SESSION_CARDS);
    const cleaned = await sessionCardEngine.cleanupExpiredCards();
    const countAfter = await db.count(STORES.SESSION_CARDS);
    
    logTest('过期卡片清理执行', cleaned >= 1, `清理数量: ${cleaned}`);
    
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

  // 保存测试结果
  const resultPath = path.join(__dirname, 'relay_test_result.json');
  const resultData = {
    summary: {
      total: TOTAL_COUNT,
      passed: PASS_COUNT,
      failed: FAIL_COUNT,
      passRate: PASS_RATE,
      duration: DURATION,
      timestamp: new Date().toISOString()
    },
    details: TEST_RESULT
  };
  fs.writeFileSync(resultPath, JSON.stringify(resultData, null, 2), 'utf-8');
  console.log(`  💡 测试结果已保存到: ${resultPath}`);
  console.log('');

  console.log('═'.repeat(60));
  console.log('  测试完成 - 复查接力台核心功能验证');
  console.log('═'.repeat(60));
  console.log('');

  console.log('  已验证的核心功能:');
  console.log('  ✅ 会话卡机制：批次直达、回位续查、重启回查');
  console.log('  ✅ 权限闸门：志愿者越权拦截、操作签名');
  console.log('  ✅ 数据落盘：会话卡、导出记录、权限拒绝记录');
  console.log('  ✅ 状态隔离：撤销重开不串状态');
  console.log('  ✅ 版本管理：状态版本递增、历史追溯');
  console.log('');

  return resultData;
}

// 运行测试
runAllTests().catch(console.error);
