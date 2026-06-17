class DataExporter {
    async exportDistributions(format = 'csv', startDate = null, endDate = null) {
        let distributions = await db.getAll(STORES.DISTRIBUTIONS, 'timestamp');
        
        if (startDate) {
            const start = new Date(startDate).setHours(0, 0, 0, 0);
            distributions = distributions.filter(d => d.timestamp >= start);
        }
        
        if (endDate) {
            const end = new Date(endDate).setHours(23, 59, 59, 999);
            distributions = distributions.filter(d => d.timestamp <= end);
        }

        const supplies = await db.getAll(STORES.SUPPLIES);
        const residents = await db.getAll(STORES.RESIDENTS);
        
        const supplyMap = new Map(supplies.map(s => [s.id, s]));
        const residentMap = new Map(residents.map(r => [r.id, r]));

        const enriched = distributions.map(d => ({
            ...d,
            supplyName: supplyMap.get(d.supplyId)?.name || '未知物资',
            supplyCategory: supplyMap.get(d.supplyId)?.category || 'unknown',
            residentName: residentMap.get(d.residentId)?.name || '未知居民',
            residentIdCard: residentMap.get(d.residentId)?.idCard || '',
            statusText: this.getStatusText(d.status),
            formattedDate: formatDate(d.timestamp),
            syncedDateText: d.syncedAt ? formatDate(d.syncedAt) : ''
        }));

        if (format === 'csv') {
            return this.exportToCSV(enriched);
        } else {
            return this.exportToJSON(enriched);
        }
    }

    async exportAuditLogs(format = 'csv', startDate = null, endDate = null) {
        let logs = await db.getAll(STORES.AUDIT_LOGS, 'timestamp');
        
        if (startDate) {
            const start = new Date(startDate).setHours(0, 0, 0, 0);
            logs = logs.filter(l => l.timestamp >= start);
        }
        
        if (endDate) {
            const end = new Date(endDate).setHours(23, 59, 59, 999);
            logs = logs.filter(l => l.timestamp <= end);
        }

        const enriched = logs.map(l => ({
            ...l,
            formattedDate: formatDate(l.timestamp),
            actionText: this.getActionText(l.action),
            detailsText: JSON.stringify(l.details || {})
        }));

        if (format === 'csv') {
            return this.exportAuditToCSV(enriched);
        } else {
            return this.exportToJSON(enriched);
        }
    }

    getStatusText(status) {
        const map = {
            [DISTRIBUTION_STATUS.PENDING]: '待同步',
            [DISTRIBUTION_STATUS.SYNCED]: '已同步',
            [DISTRIBUTION_STATUS.CONFLICTED]: '冲突'
        };
        return map[status] || status;
    }

    getActionText(action) {
        const map = {
            'create_distribution': '创建领取记录',
            'queue_add': '加入同步队列',
            'sync_success': '同步成功',
            'sync_error': '同步失败',
            'conflict_detected': '检测到冲突',
            'conflict_resolved': '冲突已解决',
            'export_data': '导出数据'
        };
        return map[action] || action;
    }

    exportToCSV(data) {
        const headers = [
            '记录ID', '居民姓名', '身份证号', '物资名称', '物资类型',
            '领取数量', '领取时间', '状态', '同步时间', '操作员', '备注'
        ];

        const rows = data.map(d => [
            d.id,
            d.residentName,
            maskIdCard(d.residentIdCard),
            d.supplyName,
            d.supplyCategory,
            d.quantity,
            d.formattedDate,
            d.statusText,
            d.syncedDateText,
            d.operatorName || '',
            (d.notes || '').replace(/,/g, '，')
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const BOM = '\uFEFF';
        return BOM + csvContent;
    }

    exportAuditToCSV(data) {
        const headers = [
            '日志ID', '操作时间', '操作类型', '操作员', '角色', '详情'
        ];

        const rows = data.map(d => [
            d.id,
            d.formattedDate,
            d.actionText,
            d.userName || '',
            d.userRole || '',
            d.detailsText.replace(/,/g, '，').replace(/\n/g, ' ')
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const BOM = '\uFEFF';
        return BOM + csvContent;
    }

    exportToJSON(data) {
        return JSON.stringify(data, null, 2);
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        addAuditLog('export_data', {
            filename,
            type: mimeType.includes('csv') ? 'csv' : 'json'
        });
    }

    async exportAndDownload(type = 'distributions', format = 'csv', startDate = null, endDate = null) {
        let content;
        let filename;
        let mimeType;

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

        if (type === 'distributions') {
            content = await this.exportDistributions(format, startDate, endDate);
            filename = `领取记录_${dateStr}.${format}`;
        } else {
            content = await this.exportAuditLogs(format, startDate, endDate);
            filename = `审计日志_${dateStr}.${format}`;
        }

        mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
        
        this.downloadFile(content, filename, mimeType);
        
        return filename;
    }
}

const dataExporter = new DataExporter();
