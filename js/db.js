const DB_VERSION = 4;
const DB_NAME = 'shelter_supply_db';

const STORES = {
    SUPPLIES: 'supplies',
    RESIDENTS: 'residents',
    DISTRIBUTIONS: 'distributions',
    OFFLINE_QUEUE: 'offline_queue',
    CONFLICTS: 'conflicts',
    AUDIT_LOGS: 'audit_logs',
    SERVER_STATE: 'server_state',
    BATCHES: 'batches',
    SESSION_CARDS: 'session_cards',
    PERMISSION_DENIALS: 'permission_denials',
    EXPORT_RECORDS: 'export_records',
    HANDOFF_CONFIGS: 'handoff_configs',
    HANDOFF_TICKETS: 'handoff_tickets'
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

class Database {
    constructor() {
        this.db = null;
        this.initPromise = null;
    }

    init() {
        if (this.initPromise) return this.initPromise;
        
        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;

                if (!db.objectStoreNames.contains(STORES.SUPPLIES)) {
                    const supplyStore = db.createObjectStore(STORES.SUPPLIES, { keyPath: 'id' });
                    supplyStore.createIndex('category', 'category', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.RESIDENTS)) {
                    const residentStore = db.createObjectStore(STORES.RESIDENTS, { keyPath: 'id' });
                    residentStore.createIndex('idCard', 'idCard', { unique: true });
                    residentStore.createIndex('name', 'name', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.DISTRIBUTIONS)) {
                    const distStore = db.createObjectStore(STORES.DISTRIBUTIONS, { keyPath: 'id' });
                    distStore.createIndex('residentId', 'residentId', { unique: false });
                    distStore.createIndex('supplyId', 'supplyId', { unique: false });
                    distStore.createIndex('status', 'status', { unique: false });
                    distStore.createIndex('timestamp', 'timestamp', { unique: false });
                    distStore.createIndex('resident_supply', ['residentId', 'supplyId'], { unique: false });
                    distStore.createIndex('batchId', 'batchId', { unique: false });
                } else if (oldVersion < 2) {
                    const distStore = event.target.transaction.objectStore(STORES.DISTRIBUTIONS);
                    if (!distStore.indexNames.contains('batchId')) {
                        distStore.createIndex('batchId', 'batchId', { unique: false });
                    }
                }

                if (!db.objectStoreNames.contains(STORES.OFFLINE_QUEUE)) {
                    const queueStore = db.createObjectStore(STORES.OFFLINE_QUEUE, { keyPath: 'id' });
                    queueStore.createIndex('timestamp', 'timestamp', { unique: false });
                    queueStore.createIndex('status', 'status', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.CONFLICTS)) {
                    const conflictStore = db.createObjectStore(STORES.CONFLICTS, { keyPath: 'id' });
                    conflictStore.createIndex('distributionId', 'distributionId', { unique: true });
                    conflictStore.createIndex('status', 'status', { unique: false });
                    conflictStore.createIndex('timestamp', 'timestamp', { unique: false });
                    conflictStore.createIndex('batchId', 'batchId', { unique: false });
                } else if (oldVersion < 2) {
                    const conflictStore = event.target.transaction.objectStore(STORES.CONFLICTS);
                    if (!conflictStore.indexNames.contains('batchId')) {
                        conflictStore.createIndex('batchId', 'batchId', { unique: false });
                    }
                }

                if (!db.objectStoreNames.contains(STORES.AUDIT_LOGS)) {
                    const auditStore = db.createObjectStore(STORES.AUDIT_LOGS, { keyPath: 'id' });
                    auditStore.createIndex('timestamp', 'timestamp', { unique: false });
                    auditStore.createIndex('action', 'action', { unique: false });
                    auditStore.createIndex('batchId', 'batchId', { unique: false });
                } else if (oldVersion < 2) {
                    const auditStore = event.target.transaction.objectStore(STORES.AUDIT_LOGS);
                    if (!auditStore.indexNames.contains('batchId')) {
                        auditStore.createIndex('batchId', 'batchId', { unique: false });
                    }
                }

                if (!db.objectStoreNames.contains(STORES.SERVER_STATE)) {
                    db.createObjectStore(STORES.SERVER_STATE, { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains(STORES.BATCHES)) {
                    const batchStore = db.createObjectStore(STORES.BATCHES, { keyPath: 'id' });
                    batchStore.createIndex('timestamp', 'timestamp', { unique: false });
                    batchStore.createIndex('status', 'status', { unique: false });
                    batchStore.createIndex('source', 'source', { unique: false });
                    batchStore.createIndex('createdBy', 'createdBy', { unique: false });
                    batchStore.createIndex('fileHash', 'fileHash', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.SESSION_CARDS)) {
                    const sessionStore = db.createObjectStore(STORES.SESSION_CARDS, { keyPath: 'id' });
                    sessionStore.createIndex('batchId', 'batchId', { unique: false });
                    sessionStore.createIndex('userId', 'userId', { unique: false });
                    sessionStore.createIndex('sourceView', 'sourceView', { unique: false });
                    sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
                    sessionStore.createIndex('status', 'status', { unique: false });
                } else if (oldVersion < 3) {
                    const sessionStore = event.target.transaction.objectStore(STORES.SESSION_CARDS);
                    if (!sessionStore.indexNames.contains('batchId')) {
                        sessionStore.createIndex('batchId', 'batchId', { unique: false });
                    }
                }

                if (!db.objectStoreNames.contains(STORES.PERMISSION_DENIALS)) {
                    const denialStore = db.createObjectStore(STORES.PERMISSION_DENIALS, { keyPath: 'id' });
                    denialStore.createIndex('timestamp', 'timestamp', { unique: false });
                    denialStore.createIndex('userId', 'userId', { unique: false });
                    denialStore.createIndex('action', 'action', { unique: false });
                    denialStore.createIndex('batchId', 'batchId', { unique: false });
                } else if (oldVersion < 3) {
                    const denialStore = event.target.transaction.objectStore(STORES.PERMISSION_DENIALS);
                    if (!denialStore.indexNames.contains('batchId')) {
                        denialStore.createIndex('batchId', 'batchId', { unique: false });
                    }
                }

                if (!db.objectStoreNames.contains(STORES.EXPORT_RECORDS)) {
                    const exportStore = db.createObjectStore(STORES.EXPORT_RECORDS, { keyPath: 'id' });
                    exportStore.createIndex('timestamp', 'timestamp', { unique: false });
                    exportStore.createIndex('batchId', 'batchId', { unique: false });
                    exportStore.createIndex('userId', 'userId', { unique: false });
                } else if (oldVersion < 3) {
                    const exportStore = event.target.transaction.objectStore(STORES.EXPORT_RECORDS);
                    if (!exportStore.indexNames.contains('batchId')) {
                        exportStore.createIndex('batchId', 'batchId', { unique: false });
                    }
                }

                if (!db.objectStoreNames.contains(STORES.HANDOFF_CONFIGS)) {
                    const configStore = db.createObjectStore(STORES.HANDOFF_CONFIGS, { keyPath: 'id' });
                    configStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.HANDOFF_TICKETS)) {
                    const ticketStore = db.createObjectStore(STORES.HANDOFF_TICKETS, { keyPath: 'id' });
                    ticketStore.createIndex('batchId', 'batchId', { unique: false });
                    ticketStore.createIndex('sessionCardId', 'sessionCardId', { unique: false });
                    ticketStore.createIndex('createdBy', 'createdBy', { unique: false });
                    ticketStore.createIndex('assignedTo', 'assignedTo', { unique: false });
                    ticketStore.createIndex('status', 'status', { unique: false });
                    ticketStore.createIndex('createdAt', 'createdAt', { unique: false });
                    ticketStore.createIndex('expiresAt', 'expiresAt', { unique: false });
                }

                if (oldVersion < 4) {
                    try {
                        const sessionStore = event.target.transaction.objectStore(STORES.SESSION_CARDS);
                        const addFieldIfMissing = (store, fieldName) => {
                            try {
                                const cursorReq = store.openCursor();
                                cursorReq.onsuccess = (e) => {
                                    const cursor = e.target.result;
                                    if (cursor) {
                                        const data = cursor.value;
                                        if (data[fieldName] === undefined) {
                                            data[fieldName] = fieldName === 'pendingActions' ? [] : 
                                                              fieldName === 'exportPreview' ? null :
                                                              fieldName === 'batchSnapshot' ? null :
                                                              fieldName === 'handoffTicketId' ? null : null;
                                            cursor.update(data);
                                        }
                                        cursor.continue();
                                    }
                                };
                            } catch (e) {}
                        };
                        ['pendingActions', 'exportPreview', 'batchSnapshot', 'handoffTicketId'].forEach(f => addFieldIfMissing(sessionStore, f));
                    } catch (e) {}
                }
            };
        });

        return this.initPromise;
    }

    async transaction(storeName, mode, callback) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = callback(store, tx);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    async get(storeName, id) {
        return this.transaction(storeName, 'readonly', (store) => store.get(id));
    }

    async getAll(storeName, indexName = null, query = null) {
        return this.transaction(storeName, 'readonly', (store) => {
            const target = indexName ? store.index(indexName) : store;
            return target.getAll(query);
        });
    }

    async put(storeName, data) {
        return this.transaction(storeName, 'readwrite', (store) => store.put(data));
    }

    async add(storeName, data) {
        return this.transaction(storeName, 'readwrite', (store) => store.add(data));
    }

    async delete(storeName, id) {
        return this.transaction(storeName, 'readwrite', (store) => store.delete(id));
    }

    async count(storeName, indexName = null, query = null) {
        return this.transaction(storeName, 'readonly', (store) => {
            const target = indexName ? store.index(indexName) : store;
            return target.count(query);
        });
    }

    async bulkPut(storeName, items) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            
            items.forEach(item => store.put(item));
            
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }

    async clear(storeName) {
        return this.transaction(storeName, 'readwrite', (store) => store.clear());
    }
}

const db = new Database();

const SAMPLE_SUPPLIES = [
    { id: 'supply_1', name: '瓶装饮用水', category: 'water', unit: '瓶', totalStock: 500, currentStock: 500, icon: '💧', dailyLimit: 3 },
    { id: 'supply_2', name: '应急药品包', category: 'medicine', unit: '包', totalStock: 100, currentStock: 100, icon: '💊', dailyLimit: 1 },
    { id: 'supply_3', name: '充电宝', category: 'power', unit: '个', totalStock: 50, currentStock: 50, icon: '🔌', dailyLimit: 1 },
    { id: 'supply_4', name: '方便面', category: 'food', unit: '桶', totalStock: 300, currentStock: 300, icon: '🍜', dailyLimit: 2 },
    { id: 'supply_5', name: '毛毯', category: 'food', unit: '条', totalStock: 80, currentStock: 80, icon: '🛏️', dailyLimit: 1 }
];

const SAMPLE_RESIDENTS = [
    { id: 'resident_1', name: '张三', idCard: '110101199001011234', phone: '13800138001', address: '朝阳区幸福小区1号楼', isDisabled: false, hasKids: false },
    { id: 'resident_2', name: '李四', idCard: '110101199102022345', phone: '13800138002', address: '朝阳区幸福小区2号楼', isDisabled: true, hasKids: false },
    { id: 'resident_3', name: '王五', idCard: '110101199203033456', phone: '13800138003', address: '朝阳区幸福小区3号楼', isDisabled: false, hasKids: true },
    { id: 'resident_4', name: '赵六', idCard: '110101199304044567', phone: '13800138004', address: '朝阳区幸福小区4号楼', isDisabled: false, hasKids: false },
    { id: 'resident_5', name: '孙七', idCard: '110101199405055678', phone: '13800138005', address: '朝阳区幸福小区5号楼', isDisabled: true, hasKids: true },
    { id: 'resident_6', name: '周八', idCard: '110101199506066789', phone: '13800138006', address: '朝阳区幸福小区6号楼', isDisabled: false, hasKids: false },
    { id: 'resident_7', name: '吴九', idCard: '110101199607077890', phone: '13800138007', address: '朝阳区幸福小区7号楼', isDisabled: false, hasKids: true },
    { id: 'resident_8', name: '郑十', idCard: '110101199708088901', phone: '13800138008', address: '朝阳区幸福小区8号楼', isDisabled: false, hasKids: false }
];

const ROLES = {
    VOLUNTEER: 'volunteer',
    ADMIN: 'admin'
};

const CURRENT_USER = {
    id: 'user_1',
    name: '志愿者小王',
    role: ROLES.VOLUNTEER
};

const USER_STORAGE_KEY = 'shelter_current_user';

function loadUserFromStorage() {
    try {
        const stored = localStorage.getItem(USER_STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            CURRENT_USER.id = data.id || 'user_1';
            CURRENT_USER.name = data.name || '志愿者小王';
            CURRENT_USER.role = data.role || ROLES.VOLUNTEER;
        }
    } catch (e) {
        console.warn('读取用户信息失败，使用默认身份', e);
    }
}

function saveUserToStorage() {
    try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({
            id: CURRENT_USER.id,
            name: CURRENT_USER.name,
            role: CURRENT_USER.role
        }));
    } catch (e) {
        console.warn('保存用户信息失败', e);
    }
}

function isAdmin() {
    return CURRENT_USER.role === ROLES.ADMIN;
}

const ADMIN_PASSWORD = 'admin123';

function verifyAdminPassword(password) {
    return password === ADMIN_PASSWORD;
}

const DISTRIBUTION_STATUS = {
    PENDING: 'pending',
    SYNCED: 'synced',
    CONFLICTED: 'conflicted'
};

const CONFLICT_STATUS = {
    PENDING: 'pending',
    RESOLVED: 'resolved',
    REJECTED: 'rejected'
};

const CONFLICT_TYPES = {
    STOCK_OVERFLOW: 'stock_overflow',
    DUPLICATE_DISTRIBUTION: 'duplicate_distribution',
    VERSION_CONFLICT: 'version_conflict',
    PERMISSION_DENIED: 'permission_denied',
    INVALID_RESIDENT: 'invalid_resident',
    INVALID_SUPPLY: 'invalid_supply',
    DAILY_LIMIT_EXCEEDED: 'daily_limit_exceeded',
    IMPORT_VALIDATION_ERROR: 'import_validation_error'
};

const IMPORT_SOURCES = {
    MANUAL: 'manual',
    CSV_IMPORT: 'csv_import',
    JSON_IMPORT: 'json_import',
    BATCH_IMPORT: 'batch_import'
};

const QUEUE_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    FAILED: 'failed',
    CONFLICTED: 'conflicted'
};

function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatLocalDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function maskIdCard(idCard) {
    if (!idCard || idCard.length < 8) return idCard;
    return idCard.substr(0, 6) + '********' + idCard.substr(-4);
}

async function initSampleData() {
    await db.init();
    
    const existingSupplies = await db.getAll(STORES.SUPPLIES);
    if (existingSupplies.length === 0) {
        await db.bulkPut(STORES.SUPPLIES, SAMPLE_SUPPLIES);
    }

    const existingResidents = await db.getAll(STORES.RESIDENTS);
    if (existingResidents.length === 0) {
        await db.bulkPut(STORES.RESIDENTS, SAMPLE_RESIDENTS);
    }

    const serverState = await db.get(STORES.SERVER_STATE, 'server_supplies');
    if (!serverState) {
        await db.put(STORES.SERVER_STATE, {
            id: 'server_supplies',
            data: JSON.parse(JSON.stringify(SAMPLE_SUPPLIES)),
            lastSync: Date.now()
        });
    }

    const lastInit = await db.get(STORES.SERVER_STATE, 'last_init');
    if (!lastInit) {
        await db.put(STORES.SERVER_STATE, {
            id: 'last_init',
            timestamp: Date.now()
        });
    }
}

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

class PermissionGate {
    constructor() {
        this.denials = [];
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
            userAgent: navigator.userAgent,
            ip: '127.0.0.1'
        };

        await db.put(STORES.PERMISSION_DENIALS, denial);
        this.denials.push(denial);

        await addAuditLog('permission_denied', {
            action,
            batchId,
            reason: '角色权限不足'
        });

        if (typeof fetch === 'function') {
            try {
                fetch('/api/permission_denials/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({
                        filename: `denial_${denial.id.slice(-12)}.json`,
                        content: denial,
                        type: 'permission_denials',
                        batchId,
                        operator: { id: CURRENT_USER.id, name: CURRENT_USER.name, role: CURRENT_USER.role }
                    })
                }).catch(() => {});
            } catch (_) {}
        }

        return denial;
    }

    async getDenials(filters = {}) {
        let denials = await db.getAll(STORES.PERMISSION_DENIALS, 'timestamp');
        denials.sort((a, b) => b.timestamp - a.timestamp);

        if (filters.userId) {
            denials = denials.filter(d => d.userId === filters.userId);
        }
        if (filters.action) {
            denials = denials.filter(d => d.action === filters.action);
        }
        if (filters.batchId) {
            denials = denials.filter(d => d.batchId === filters.batchId);
        }

        return denials;
    }

    async signOperation(action, batchId, details = {}, password = null) {
        await this.requirePermission(action, batchId);

        if (password !== null && password !== undefined) {
            if (CURRENT_USER.role !== ROLES.ADMIN || !verifyAdminPassword(password)) {
                await this.recordDenial(action, batchId);
                throw new Error('管理员签名验证失败');
            }
        }

        const signature = {
            signedAt: Date.now(),
            signedBy: CURRENT_USER.id,
            signedByName: CURRENT_USER.name,
            signedByRole: CURRENT_USER.role,
            action,
            batchId,
            details,
            passwordVerified: password !== null && password !== undefined
        };

        await addAuditLog('operation_signed', {
            action,
            batchId,
            signature,
            details
        });

        return signature;
    }
}

const permissionGate = new PermissionGate();

class SessionCardEngine {
    constructor() {
        this.activeCard = null;
        this.onCardCreated = null;
        this.onCardRestored = null;
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

        Object.assign(card, updates, {
            updatedAt: Date.now(),
            lastActivity: Date.now()
        });

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

        const activeCards = await db.getAll(
            STORES.SESSION_CARDS,
            'status',
            IDBKeyRange.only(SESSION_CARD_STATUS.ACTIVE)
        );

        const userActiveCards = activeCards
            .filter(c => c.userId === CURRENT_USER.id)
            .sort((a, b) => b.createdAt - a.timestamp);

        if (userActiveCards.length > 0) {
            this.activeCard = userActiveCards[0];
            return this.activeCard;
        }

        return null;
    }

    async getCard(cardId) {
        return await db.get(STORES.SESSION_CARDS, cardId);
    }

    async restoreCard(cardId) {
        const card = await db.get(STORES.SESSION_CARDS, cardId);
        if (!card) {
            throw new Error('会话卡不存在');
        }

        if (card.status !== SESSION_CARD_STATUS.ACTIVE) {
            throw new Error('会话卡已失效');
        }

        card.lastActivity = Date.now();
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
        if (!card) return null;

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

    async cancelCard(cardId) {
        const card = await db.get(STORES.SESSION_CARDS, cardId);
        if (!card) return null;

        card.status = SESSION_CARD_STATUS.CANCELLED;
        card.cancelledAt = Date.now();
        card.updatedAt = Date.now();

        await db.put(STORES.SESSION_CARDS, card);

        if (this.activeCard && this.activeCard.id === cardId) {
            this.activeCard = null;
        }

        await addAuditLog('session_card_cancelled', {
            sessionCardId: cardId,
            batchId: card.batchId
        });

        return card;
    }

    async cancelActiveCard() {
        if (this.activeCard && this.activeCard.status === SESSION_CARD_STATUS.ACTIVE) {
            return await this.cancelCard(this.activeCard.id);
        }
        return null;
    }

    async getUserCards(userId = CURRENT_USER.id, filters = {}) {
        let cards = await db.getAll(STORES.SESSION_CARDS, 'userId', IDBKeyRange.only(userId));
        cards.sort((a, b) => b.createdAt - a.createdAt);

        if (filters.status) {
            cards = cards.filter(c => c.status === filters.status);
        }
        if (filters.batchId) {
            cards = cards.filter(c => c.batchId === filters.batchId);
        }
        if (filters.sourceView) {
            cards = cards.filter(c => c.sourceView === filters.sourceView);
        }

        return cards;
    }

    async getBatchCards(batchId) {
        return await db.getAll(STORES.SESSION_CARDS, 'batchId', IDBKeyRange.only(batchId));
    }

    async navigateWithCard(cardId, targetView) {
        const card = await this.getCard(cardId);
        if (!card) return null;

        if (!card.pageHistory) card.pageHistory = [];
        card.pageHistory.push(targetView);
        card.lastActivity = Date.now();

        await db.put(STORES.SESSION_CARDS, card);
        this.activeCard = card;

        return card;
    }

    async goBackWithCard(cardId) {
        const card = await this.getCard(cardId);
        if (!card || !card.pageHistory || card.pageHistory.length < 2) {
            return null;
        }

        card.pageHistory.pop();
        const previousView = card.pageHistory[card.pageHistory.length - 1];
        card.lastActivity = Date.now();

        await db.put(STORES.SESSION_CARDS, card);
        this.activeCard = card;

        return { card, previousView };
    }

    async cleanupExpiredCards(maxAgeMs = 24 * 60 * 60 * 1000) {
        const allCards = await db.getAll(STORES.SESSION_CARDS);
        const now = Date.now();
        let cleanedCount = 0;

        for (const card of allCards) {
            if (card.status === SESSION_CARD_STATUS.ACTIVE && 
                now - card.lastActivity > maxAgeMs) {
                card.status = SESSION_CARD_STATUS.CANCELLED;
                card.cancelledAt = now;
                card.cancelledReason = 'expired';
                await db.put(STORES.SESSION_CARDS, card);
                cleanedCount++;
            }
        }

        return cleanedCount;
    }
}

const sessionCardEngine = new SessionCardEngine();

class ExportRecordEngine {
    async recordExport(type, format, batchId = null, filename = null) {
        const record = {
            id: generateId('export'),
            type,
            format,
            batchId,
            filename,
            userId: CURRENT_USER.id,
            userName: CURRENT_USER.name,
            userRole: CURRENT_USER.role,
            timestamp: Date.now(),
            status: 'completed'
        };

        await db.put(STORES.EXPORT_RECORDS, record);

        await addAuditLog('export_recorded', {
            exportId: record.id,
            type,
            format,
            batchId,
            filename
        });

        return record;
    }

    async getExportRecords(filters = {}) {
        let records = await db.getAll(STORES.EXPORT_RECORDS, 'timestamp');
        records.sort((a, b) => b.timestamp - a.timestamp);

        if (filters.userId) {
            records = records.filter(r => r.userId === filters.userId);
        }
        if (filters.batchId) {
            records = records.filter(r => r.batchId === filters.batchId);
        }
        if (filters.type) {
            records = records.filter(r => r.type === filters.type);
        }

        return records;
    }
}

const exportRecordEngine = new ExportRecordEngine();

const HANDOFF_TICKET_STATUS = {
    DRAFT: 'draft',
    OPEN: 'open',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    EXPIRED: 'expired',
    CANCELLED: 'cancelled',
    CONFLICT: 'conflict'
};

const DUPLICATE_IMPORT_STRATEGY = {
    ASK: 'ask',
    MERGE: 'merge',
    REJECT: 'reject',
    NEW_VERSION: 'new_version'
};

const EXPORT_NAMING_TEMPLATES = {
    BATCH_DETAIL: '批次详情_{batchName}_{date}_{time}',
    BATCH_LIST: '批次列表_{date}',
    DISTRIBUTIONS: '领取记录_{date}',
    AUDIT_LOG: '审计日志_{date}',
    batch_csv: '批次详情_{batchShort}_{date}_{time}.csv',
    batch_json: '批次详情_{batchShort}_{date}_{time}.json'
};

class HandoffConfigEngine {
    constructor() {
        this.defaultConfig = {
            id: 'global',
            ticketRetentionHours: 24,
            duplicateImportStrategy: DUPLICATE_IMPORT_STRATEGY.ASK,
            exportNamingTemplates: { ...EXPORT_NAMING_TEMPLATES },
            requireAdminSignature: true,
            autoCleanupExpired: true,
            allowCrossUserHandoff: true,
            updatedAt: Date.now()
        };
        this._cache = null;
    }

    async getConfig() {
        if (this._cache && Date.now() - this._cache.updatedAt < 60000) {
            return this._cache;
        }
        let config = await db.get(STORES.HANDOFF_CONFIGS, 'global');
        if (!config) {
            config = { ...this.defaultConfig };
            await db.put(STORES.HANDOFF_CONFIGS, config);
        }
        if (!config.exportNamingTemplates) {
            config.exportNamingTemplates = { ...EXPORT_NAMING_TEMPLATES };
        }
        this._cache = config;
        return config;
    }

    async updateConfig(updates) {
        const config = await this.getConfig();
        Object.assign(config, updates, { updatedAt: Date.now() });
        await db.put(STORES.HANDOFF_CONFIGS, config);
        this._cache = config;
        await addAuditLog('handoff_config_updated', { updates });
        return config;
    }

    async getRetentionMs() {
        const config = await this.getConfig();
        return config.ticketRetentionHours * 60 * 60 * 1000;
    }

    async getDuplicateStrategy() {
        const config = await this.getConfig();
        return config.duplicateImportStrategy;
    }

    async saveConfig(newConfig) {
        const existing = await this.getConfig();
        const merged = {
            ...existing,
            ...newConfig,
            id: 'global',
            updatedAt: Date.now()
        };
        await db.put(STORES.HANDOFF_CONFIGS, merged);
        this._cache = merged;
        return merged;
    }

    async generateExportFilename(templateKey, context = {}) {
        const config = await this.getConfig();
        let template = config.exportNamingTemplates[templateKey] || templateKey;
        const now = new Date();
        const date = now.toISOString().slice(0, 10).replace(/-/g, '');
        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const replacements = {
            date, time, ...context };
        let filename = template;
        for (const [key, val] of Object.entries(replacements)) {
            filename = filename.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val));
        }
        return filename;
    }
}

const handoffConfig = new HandoffConfigEngine();

class HandoffTicketEngine {
    constructor() {
        this.onTicketCreated = null;
        this.onTicketAssigned = null;
    }

    async createTicketFromSession(sessionCardId, batch, assignedTo = null) {
        const card = await db.get(STORES.SESSION_CARDS, sessionCardId);
        if (!card) throw new Error('会话卡不存在');
        const retentionMs = await handoffConfig.getRetentionMs();
        const now = Date.now();
        const ticket = {
            id: generateId('handoff'),
            sessionCardId,
            batchId: batch.id,
            batchSnapshot: {
                id: batch.id, fileName: batch.fileName, status: batch.status,
                totalRecords: batch.totalRecords, successCount: batch.successCount,
                conflictCount: batch.conflictCount, revokedCount: batch.revokedCount || 0,
                createdByName: batch.createdByName, timestamp: batch.timestamp,
                fileHash: batch.fileHash || null, importVersion: batch.importVersion || 1
            },
            entryPage: card.sourceView,
            filtersSnapshot: JSON.parse(JSON.stringify(card.filters || {})),
            scrollPosition: card.scrollPosition || 0,
            pendingActions: card.pendingActions || [],
            exportPreview: card.exportPreview || null,
            createdBy: CURRENT_USER.id, createdByName: CURRENT_USER.name,
            createdByRole: CURRENT_USER.role,
            assignedTo: assignedTo ? (assignedTo.id || null) : null,
            assignedToName: assignedTo ? (assignedTo.name || null) : null,
            status: HANDOFF_TICKET_STATUS.OPEN,
            createdAt: now, updatedAt: now,
            expiresAt: now + retentionMs,
            activityLog: [{
                action: 'created', userId: CURRENT_USER.id,
                userName: CURRENT_USER.name,
                timestamp: now,
                detail: `从${this._getSourceLabel(card.sourceView)}进入，批次「${batch.fileName}」`
            }]
        };
        await db.put(STORES.HANDOFF_TICKETS, ticket);
        card.handoffTicketId = ticket.id;
        await db.put(STORES.SESSION_CARDS, card);
        await addAuditLog('handoff_ticket_created', {
            ticketId: ticket.id, batchId: batch.id, sessionCardId });
        if (this.onTicketCreated) this.onTicketCreated(ticket);
        return ticket;
    }

    _getSourceLabel(view) {
        const labels = { dashboard: '首页提醒', conflicts: '复核页', history: '记录页', batches: '导入中心', distribute: '签到页', export: '导出页' };
        return labels[view] || view;
    }

    async getTicket(ticketId) {
        return await db.get(STORES.HANDOFF_TICKETS, ticketId);
    }

    async getMyActiveTickets(userId = CURRENT_USER.id) {
        const now = Date.now();
        let tickets = await db.getAll(STORES.HANDOFF_TICKETS);
        tickets = tickets.filter(t =>
            (t.createdBy === userId || t.assignedTo === userId || t.assignedTo === null) &&
            t.status !== HANDOFF_TICKET_STATUS.COMPLETED &&
            t.status !== HANDOFF_TICKET_STATUS.EXPIRED &&
            t.status !== HANDOFF_TICKET_STATUS.CANCELLED
        );
        tickets = tickets.map(t => this._checkAndMarkExpired(t, now));
        tickets.sort((a, b) => b.createdAt - a.createdAt);
        return tickets;
    }

    async getAllTickets(filters = {}) {
        let tickets = await db.getAll(STORES.HANDOFF_TICKETS, 'createdAt');
        const now = Date.now();
        tickets = tickets.map(t => this._checkAndMarkExpired(t, now));
        tickets.sort((a, b) => b.createdAt - a.createdAt);
        if (filters.status) tickets = tickets.filter(t => t.status === filters.status);
        if (filters.batchId) tickets = tickets.filter(t => t.batchId === filters.batchId);
        if (filters.createdBy) tickets = tickets.filter(t => t.createdBy === filters.createdBy);
        if (filters.assignedTo) tickets = tickets.filter(t => t.assignedTo === filters.assignedTo);
        return tickets;
    }

    async _checkAndMarkExpired(ticket, now = Date.now()) {
        if (ticket.status === HANDOFF_TICKET_STATUS.OPEN ||
            ticket.status === HANDOFF_TICKET_STATUS.IN_PROGRESS) {
            if (now > ticket.expiresAt) {
                ticket.status = HANDOFF_TICKET_STATUS.EXPIRED;
                if (!ticket.activityLog) ticket.activityLog = [];
                ticket.activityLog.push({
                    action: 'expired', userId: 'system', userName: '系统', timestamp: now, detail: '交接票已过期'
                });
                ticket.updatedAt = now;
                await db.put(STORES.HANDOFF_TICKETS, ticket);
                await addAuditLog('handoff_ticket_expired', { ticketId: ticket.id, batchId: ticket.batchId });
            }
        }
        return ticket;
    }

    async claimTicket(ticketId) {
        let ticket = await this.getTicket(ticketId);
        if (!ticket) throw new Error('交接票不存在');
        ticket = await this._checkAndMarkExpired(ticket);
        if (ticket.status !== HANDOFF_TICKET_STATUS.OPEN &&
            ticket.status !== HANDOFF_TICKET_STATUS.IN_PROGRESS) {
            throw new Error(`交接票状态不可领取：${ticket.status}`);
        }
        const config = await handoffConfig.getConfig();
        if (ticket.assignedTo && ticket.assignedTo !== CURRENT_USER.id && !config.allowCrossUserHandoff) {
            throw new Error('此交接票已分配给其他人员');
        }
        const previousAssignee = ticket.assignedTo;
        const previousAssigneeName = ticket.assignedToName;
        ticket.assignedTo = CURRENT_USER.id;
        ticket.assignedToName = CURRENT_USER.name;
        ticket.status = HANDOFF_TICKET_STATUS.IN_PROGRESS;
        ticket.claimedAt = Date.now();
        ticket.updatedAt = Date.now();
        ticket.activityLog.push({
            action: 'claimed', userId: CURRENT_USER.id,
            userName: CURRENT_USER.name, timestamp: Date.now(),
            detail: previousAssignee ? `从${previousAssigneeName || previousAssignee}转交领取` : '从公开池领取'
        });
        await db.put(STORES.HANDOFF_TICKETS, ticket);
        const card = await db.get(STORES.SESSION_CARDS, ticket.sessionCardId);
        if (card) {
            card.userId = CURRENT_USER.id;
            card.userName = CURRENT_USER.name;
            card.lastActivity = Date.now();
            await db.put(STORES.SESSION_CARDS, card);
        }
        await addAuditLog('handoff_ticket_claimed', { ticketId, batchId: ticket.batchId, previousAssignee });
        return { ticket, sessionCard: card };
    }

    async completeTicket(ticketId, resultDetail = '') {
        const ticket = await this.getTicket(ticketId);
        if (!ticket) throw new Error('交接票不存在');
        ticket.status = HANDOFF_TICKET_STATUS.COMPLETED;
        ticket.completedAt = Date.now();
        ticket.completedBy = CURRENT_USER.id;
        ticket.completedByName = CURRENT_USER.name;
        ticket.updatedAt = Date.now();
        ticket.activityLog.push({
            action: 'completed', userId: CURRENT_USER.id, userName: CURRENT_USER.name,
            timestamp: Date.now(), detail: resultDetail || '处理完成'
        });
        await db.put(STORES.HANDOFF_TICKETS, ticket);
        const card = ticket.sessionCardId ?
            await sessionCardEngine.completeCard(ticket.sessionCardId) : null;
        await addAuditLog('handoff_ticket_completed', { ticketId, batchId: ticket.batchId });
        return ticket;
    }

    async cancelTicket(ticketId, reason = '') {
        const ticket = await this.getTicket(ticketId);
        if (!ticket) throw new Error('交接票不存在');
        ticket.status = HANDOFF_TICKET_STATUS.CANCELLED;
        ticket.cancelledAt = Date.now();
        ticket.cancelledBy = CURRENT_USER.id;
        ticket.cancelledByName = CURRENT_USER.name;
        ticket.cancelledReason = reason;
        ticket.updatedAt = Date.now();
        ticket.activityLog.push({
            action: 'cancelled', userId: CURRENT_USER.id, userName: CURRENT_USER.name,
            timestamp: Date.now(), detail: reason || '已取消'
        });
        await db.put(STORES.HANDOFF_TICKETS, ticket);
        if (ticket.sessionCardId) {
            await sessionCardEngine.cancelCard(ticket.sessionCardId);
        }
        await addAuditLog('handoff_ticket_cancelled', { ticketId, batchId: ticket.batchId, reason });
        return ticket;
    }

    async markConflict(ticketId, conflictDetail) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket) throw new Error('交接票不存在');
        ticket.status = HANDOFF_TICKET_STATUS.CONFLICT;
        ticket.updatedAt = Date.now();
        ticket.conflictDetail = conflictDetail;
        ticket.activityLog.push({
            action: 'conflict', userId: CURRENT_USER.id, userName: CURRENT_USER.name,
            timestamp: Date.now(), detail: conflictDetail
        });
        await db.put(STORES.HANDOFF_TICKETS, ticket);
        await addAuditLog('handoff_ticket_conflict', { ticketId, batchId: ticket.batchId, conflictDetail });
        return ticket;
    }

    async updatePendingActions(ticketId, actions) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket) throw new Error('交接票不存在');
        ticket.pendingActions = actions;
        ticket.updatedAt = Date.now();
        await db.put(STORES.HANDOFF_TICKETS, ticket);
        if (ticket.sessionCardId) {
            const card = await db.get(STORES.SESSION_CARDS, ticket.sessionCardId);
            if (card) {
                card.pendingActions = actions;
                await db.put(STORES.SESSION_CARDS, card);
            }
        }
        return ticket;
    }

    async updateExportPreview(ticketId, previewData) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket) throw new Error('交接票不存在');
        ticket.exportPreview = previewData;
        ticket.updatedAt = Date.now();
        await db.put(STORES.HANDOFF_TICKETS, ticket);
        if (ticket.sessionCardId) {
            const card = await db.get(STORES.SESSION_CARDS, ticket.sessionCardId);
            if (card) {
                card.exportPreview = previewData;
                await db.put(STORES.SESSION_CARDS, card);
            }
        }
        return ticket;
    }

    async cleanupExpired() {
        const config = await handoffConfig.getConfig();
        if (!config.autoCleanupExpired) return 0;
        const tickets = await db.getAll(STORES.HANDOFF_TICKETS);
        const now = Date.now();
        let cleaned = 0;
        const retentionMs = await handoffConfig.getRetentionMs();
        for (const t of tickets) {
            const shouldDelete = (t.status === HANDOFF_TICKET_STATUS.COMPLETED ||
                t.status === HANDOFF_TICKET_STATUS.CANCELLED ||
                t.status === HANDOFF_TICKET_STATUS.EXPIRED) &&
                (now - t.updatedAt) > retentionMs * 7;
            if (shouldDelete) {
                await db.delete(STORES.HANDOFF_TICKETS, t.id);
                cleaned++;
            } else if (t.status === HANDOFF_TICKET_STATUS.OPEN ||
                       t.status === HANDOFF_TICKET_STATUS.IN_PROGRESS) {
                this._checkAndMarkExpired(t, now);
            }
        }
        return cleaned;
    }

    async persistTicketToDisk(ticketId) {
        try {
            const ticket = await this.getTicket(ticketId);
            if (!ticket) throw new Error('交接票不存在');
            const payload = {
                filename: `handoff_${ticket.id.slice(-12)}.json`,
                content: JSON.stringify(ticket, null, 2),
                type: 'handoff_tickets',
                batchId: ticket.batchId,
                operator: { id: CURRENT_USER.id, name: CURRENT_USER.name, role: CURRENT_USER.role }
            };
            const resp = await fetch('/api/handoff/persist', {
                method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(payload)
            });
            return await resp.json();
        } catch (e) {
            return null;
        }
    }
}

const handoffTicketEngine = new HandoffTicketEngine();

SessionCardEngine.prototype.updateCardWithSnapshot = async function(cardId, updates = {}) {
    const card = await db.get(STORES.SESSION_CARDS, cardId);
    if (!card) return null;
    const now = Date.now();
    if (updates.pendingActions !== undefined) {
        card.pendingActions = updates.pendingActions;
    }
    if (updates.exportPreview !== undefined) {
        card.exportPreview = updates.exportPreview;
    }
    if (updates.batchSnapshot !== undefined) {
        card.batchSnapshot = updates.batchSnapshot;
    }
    card.updatedAt = now;
    card.lastActivity = now;
    await db.put(STORES.SESSION_CARDS, card);
    this.activeCard = card;
    if (card.handoffTicketId) {
        const ticketUpdates = {};
        if (updates.pendingActions !== undefined) ticketUpdates.pendingActions = updates.pendingActions;
        if (updates.exportPreview !== undefined) ticketUpdates.exportPreview = updates.exportPreview;
        if (Object.keys(ticketUpdates).length > 0) {
            try {
                const ticket = await db.get(STORES.HANDOFF_TICKETS, card.handoffTicketId);
                if (ticket) {
                    Object.assign(ticket, ticketUpdates, { updatedAt: now });
                    await db.put(STORES.HANDOFF_TICKETS, ticket);
                }
            } catch (e) {}
        }
    }
    return card;
};

SessionCardEngine.prototype.capturePendingActions = async function(cardId, batch) {
    const pending = [];
    const pendingConflicts = await batchEngine.getBatchPendingConflicts(batch.id);
    if (pendingConflicts.length > 0) {
        pending.push({ type: 'review_conflicts', label: `复核${pendingConflicts.length}条冲突`, count: pendingConflicts.length });
    }
    const failed = batch.failedRecords || [];
    if (failed.length > 0) {
        pending.push({ type: 'retry_failed', label: `重试${failed.length}条失败项`, count: failed.length });
    }
    const dists = await batchEngine.getBatchDistributions(batch.id);
    const pendingSync = dists.filter(d => d.status === DISTRIBUTION_STATUS.PENDING).length;
    if (pendingSync > 0) {
        pending.push({ type: 'wait_sync', label: `等待${pendingSync}条同步`, count: pendingSync });
    }
    if (batch.status !== BATCH_STATUS.COMPLETED) {
        pending.push({ type: 'export', label: '导出批次详情', count: 1 });
    }
    await this.updateCardWithSnapshot(cardId, {
        pendingActions: pending,
        batchSnapshot: {
            id: batch.id, fileName: batch.fileName, status: batch.status,
            totalRecords: batch.totalRecords, successCount: batch.successCount,
            conflictCount: batch.conflictCount, revokedCount: batch.revokedCount || 0
        }
    });
    return pending;
};
