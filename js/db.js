const DB_VERSION = 1;
const DB_NAME = 'shelter_supply_db';

const STORES = {
    SUPPLIES: 'supplies',
    RESIDENTS: 'residents',
    DISTRIBUTIONS: 'distributions',
    OFFLINE_QUEUE: 'offline_queue',
    CONFLICTS: 'conflicts',
    AUDIT_LOGS: 'audit_logs',
    SERVER_STATE: 'server_state'
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
                }

                if (!db.objectStoreNames.contains(STORES.AUDIT_LOGS)) {
                    const auditStore = db.createObjectStore(STORES.AUDIT_LOGS, { keyPath: 'id' });
                    auditStore.createIndex('timestamp', 'timestamp', { unique: false });
                    auditStore.createIndex('action', 'action', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.SERVER_STATE)) {
                    db.createObjectStore(STORES.SERVER_STATE, { keyPath: 'id' });
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
