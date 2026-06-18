const DB_VERSION = 3;
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
    EXPORT_RECORDS: 'export_records'
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

    async signOperation(action, batchId, details = {}) {
        await this.requirePermission(action, batchId);

        const signature = {
            signedAt: Date.now(),
            signedBy: CURRENT_USER.id,
            signedByName: CURRENT_USER.name,
            signedByRole: CURRENT_USER.role,
            action,
            batchId,
            details
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
