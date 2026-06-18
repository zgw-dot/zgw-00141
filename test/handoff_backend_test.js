/**
 * 批次交接箱 - 后端落盘API测试脚本
 * 验证5个POST落盘接口是否正常工作：
 *  1. POST /api/export
 *  2. POST /api/handoff/persist
 *  3. POST /api/failed_records/save
 *  4. POST /api/permission_denials/save
 *  5. POST /api/export_manifest/save
 *
 * 运行方式:
 *  先启动 server: python server.py --port 8081
 *  再运行: node test/handoff_backend_test.js 8081
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || 8081;
const BASE_URL = `http://localhost:${PORT}`;
const RESULTS = [];

function logResult(name, passed, detail = '') {
    const entry = { name, passed, detail, ts: new Date().toISOString() };
    RESULTS.push(entry);
    const icon = passed ? '✓' : '✗';
    console.log(`  ${icon} ${name}`);
    if (detail) console.log(`      -> ${detail}`);
}

function httpPost(pathSuffix, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const opts = {
            hostname: 'localhost',
            port: PORT,
            path: pathSuffix,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = http.request(opts, (res) => {
            let chunks = '';
            res.on('data', (c) => (chunks += c));
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
                catch (e) { resolve({ status: res.statusCode, body: chunks }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function runAll() {
    console.log(`\n=== 批次交接箱 后端落盘API测试 ===`);
    console.log(`目标地址: ${BASE_URL}`);
    console.log(`开始时间: ${new Date().toLocaleString()}\n`);

    // 0. 连通性测试
    console.log('[0] 连通性测试');
    try {
        const res = await httpPost('/api/handoff/persist', { ping: 1 });
        logResult('服务响应正常', res.status === 200, `status=${res.status}`);
    } catch (e) {
        logResult('服务响应正常', false, e.message);
        console.log('\n❌ 无法连接服务，请先启动 server.py');
        process.exit(1);
    }

    // 1. 交接票落盘测试
    console.log('\n[1] 交接票落盘 /api/handoff/persist');
    const ticketId = generateId('handoff');
    const ticketData = {
        ticketId,
        batchId: generateId('batch'),
        fileName: '物资批次_TEST_2024.xlsx',
        entryPage: 'dashboard',
        createdBy: 'user_admin_001',
        createdByName: '测试管理员',
        status: 'open',
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        activityLog: [{ action: 'created', timestamp: Date.now() }]
    };
    try {
        const res = await httpPost('/api/handoff/persist', ticketData);
        logResult('POST /api/handoff/persist 状态码200', res.status === 200, `status=${res.status}`);
        logResult('返回 success=true', res.body && res.body.success === true, `body=${JSON.stringify(res.body).slice(0,120)}`);
        const filePath = res.body.filePath;
        const exists = filePath && fs.existsSync(path.join(__dirname, '..', filePath));
        logResult('文件实际写入磁盘', exists, `path=${filePath}`);
    } catch (e) {
        logResult('交接票落盘', false, e.message);
    }

    // 2. 失败明细落盘测试
    console.log('\n[2] 失败明细落盘 /api/failed_records/save');
    const failedData = {
        batchId: generateId('batch'),
        fileName: '失败批次_F001.csv',
        totalFailed: 3,
        records: [
            { index: 1, name: '张三', errorType: '格式错误', message: '身份证长度不对', data: '...' },
            { index: 4, name: '李四', errorType: '物资不存在', message: 'N95未配置', data: '...' },
            { index: 8, name: '王五', errorType: '数量超限', message: '口罩最多领5只', data: '...' }
        ],
        exportedBy: 'user_admin_001',
        exportedAt: Date.now()
    };
    try {
        const res = await httpPost('/api/failed_records/save', failedData);
        logResult('POST /api/failed_records/save 状态码200', res.status === 200, `status=${res.status}`);
        logResult('返回 filePath 存在', res.body && res.body.success && !!res.body.filePath, `path=${res.body?.filePath || 'N/A'}`);
    } catch (e) {
        logResult('失败明细落盘', false, e.message);
    }

    // 3. 权限拒绝记录落盘测试
    console.log('\n[3] 权限拒绝落盘 /api/permission_denials/save');
    const denialData = {
        batchId: generateId('batch'),
        action: 'batch_export',
        userId: 'user_volunteer_002',
        userName: '测试志愿者',
        userRole: 'volunteer',
        reason: '权限不足：志愿者无法执行正式导出',
        timestamp: Date.now(),
        signaturePrompted: true
    };
    try {
        const res = await httpPost('/api/permission_denials/save', denialData);
        logResult('POST /api/permission_denials/save 状态码200', res.status === 200, `status=${res.status}`);
        logResult('返回包含 denialId', res.body && res.body.denialId, `denialId=${res.body?.denialId || 'N/A'}`);
    } catch (e) {
        logResult('权限拒绝落盘', false, e.message);
    }

    // 4. 导出清单落盘测试
    console.log('\n[4] 导出清单落盘 /api/export_manifest/save');
    const manifestData = {
        exportId: generateId('export'),
        batchId: generateId('batch'),
        batchName: '导出清单测试批次',
        fileName: '批次详情_TEST_2025.csv',
        format: 'csv',
        recordCount: 128,
        fileSize: 15234,
        exportedBy: 'user_admin_001',
        exportedByName: '测试管理员',
        exportedAt: Date.now(),
        signature: { signedAt: Date.now(), signedBy: 'user_admin_001', passwordVerified: true }
    };
    try {
        const res = await httpPost('/api/export_manifest/save', manifestData);
        logResult('POST /api/export_manifest/save 状态码200', res.status === 200, `status=${res.status}`);
        logResult('返回包含 manifestFilePath', !!res.body?.manifestFilePath, `path=${res.body?.manifestFilePath || 'N/A'}`);
    } catch (e) {
        logResult('导出清单落盘', false, e.message);
    }

    // 5. 导出文件落盘测试
    console.log('\n[5] 导出文件落盘 /api/export');
    const exportData = {
        fileName: '批次详情_EXPORT_DEMO_20250101.csv',
        content: '序号,姓名,物资,数量,状态\n1,张三,N95,2,已通过\n2,李四,口罩,5,已通过\n',
        format: 'csv',
        batchId: generateId('batch'),
        exportedBy: 'user_admin_001',
        signature: { signedAt: Date.now(), passwordVerified: true }
    };
    try {
        const res = await httpPost('/api/export', exportData);
        logResult('POST /api/export 状态码200', res.status === 200, `status=${res.status}`);
        logResult('返回包含 downloadUrl', !!res.body?.downloadUrl, `url=${res.body?.downloadUrl || 'N/A'}`);
    } catch (e) {
        logResult('导出文件落盘', false, e.message);
    }

    // 汇总
    console.log('\n=== 测试结果汇总 ===');
    const passed = RESULTS.filter(r => r.passed).length;
    const total = RESULTS.length;
    console.log(`通过: ${passed}/${total}`);
    console.log(`失败: ${total - passed}/${total}`);

    // 写测试报告
    const reportDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `handoff_backend_report_${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({ passed, total, results: RESULTS, timestamp: Date.now() }, null, 2));
    console.log(`\n报告写入: ${reportPath}`);

    process.exit(total - passed > 0 ? 1 : 0);
}

runAll().catch(e => { console.error('测试异常退出:', e); process.exit(2); });
