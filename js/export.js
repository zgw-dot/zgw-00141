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
            syncedDateText: d.syncedAt ? formatDate(d.syncedAt) : '',
            importSourceText: d.importSource ? this.getImportSourceText(d.importSource) : '手动录入',
            resolvedDateText: d.resolvedAt ? formatDate(d.resolvedAt) : '',
            rejectedText: d.rejected ? '已驳回' : ''
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
            detailsText: JSON.stringify(l.details || {}),
            userRoleText: this.getRoleText(l.userRole)
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
            'conflict_undo': '撤销冲突处理',
            'export_data': '导出数据',
            'import_distribution': '导入领取记录',
            'import_conflict': '导入产生冲突',
            'create_supply': '新增物资',
            'update_supply': '更新物资',
            'delete_supply': '删除物资'
        };
        return map[action] || action;
    }

    getImportSourceText(source) {
        const map = {
            [IMPORT_SOURCES.MANUAL]: '手动录入',
            [IMPORT_SOURCES.CSV_IMPORT]: 'CSV导入',
            [IMPORT_SOURCES.JSON_IMPORT]: 'JSON导入',
            [IMPORT_SOURCES.BATCH_IMPORT]: '批量导入'
        };
        return map[source] || source;
    }

    getRoleText(role) {
        const map = {
            [ROLES.VOLUNTEER]: '志愿者',
            [ROLES.ADMIN]: '管理员'
        };
        return map[role] || role;
    }

    exportToCSV(data) {
        const headers = [
            '记录ID', '居民姓名', '身份证号', '物资名称', '物资类型',
            '领取数量', '领取时间', '状态', '同步时间', '操作员', 
            '数据来源', '处理人', '处理时间', '驳回状态', '备注'
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
            d.importSourceText,
            d.resolvedByName || '',
            d.resolvedDateText,
            d.rejectedText,
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
            d.userRoleText || '',
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

    async saveToServer(content, filename, exportType, batchId = null) {
        try {
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify({
                    filename,
                    content,
                    type: exportType,
                    batchId,
                    operator: {
                        id: CURRENT_USER.id,
                        name: CURRENT_USER.name,
                        role: CURRENT_USER.role
                    }
                })
            });
            
            const result = await response.json();
            if (result.success) {
                console.log('[导出落盘] 服务器保存成功:', result.filepath);
                return result;
            } else {
                console.warn('[导出落盘] 服务器保存失败:', result.error);
                return null;
            }
        } catch (error) {
            console.warn('[导出落盘] 无法连接服务器，仅本地下载:', error.message);
            return null;
        }
    }

    async downloadFile(content, filename, mimeType, exportType = 'unknown', batchId = null) {
        await this.saveToServer(content, filename, exportType, batchId);
        
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
            type: mimeType.includes('csv') ? 'csv' : 'json',
            exportType,
            batchId
        });
    }

    async exportBatches(format = 'csv', startDate = null, endDate = null, status = null, source = null) {
        let batches = await db.getAll(STORES.BATCHES, 'timestamp');
        batches.sort((a, b) => b.timestamp - a.timestamp);
        
        if (startDate) {
            const start = new Date(startDate).setHours(0, 0, 0, 0);
            batches = batches.filter(b => b.timestamp >= start);
        }
        
        if (endDate) {
            const end = new Date(endDate).setHours(23, 59, 59, 999);
            batches = batches.filter(b => b.timestamp <= end);
        }
        
        if (status && status !== 'all') {
            batches = batches.filter(b => b.status === status);
        }
        
        if (source && source !== 'all') {
            batches = batches.filter(b => b.source === source);
        }

        const enriched = batches.map(b => ({
            ...b,
            formattedDate: formatDate(b.timestamp),
            statusText: this.getBatchStatusText(b.status),
            sourceText: b.source ? this.getImportSourceText(b.source) : '未知'
        }));

        if (format === 'csv') {
            return this.exportBatchesToCSV(enriched);
        } else {
            return this.exportToJSON(enriched);
        }
    }

    async exportBatchDetail(batchId, format = 'csv') {
        const batch = await db.get(STORES.BATCHES, batchId);
        if (!batch) throw new Error('批次不存在');

        const distributions = await batchEngine.getBatchDistributions(batchId);
        const conflicts = await batchEngine.getBatchConflicts(batchId);
        const failedRecords = batch.failedRecords || [];

        const supplies = await db.getAll(STORES.SUPPLIES);
        const supplyMap = new Map(supplies.map(s => [s.id, s]));

        const residents = await db.getAll(STORES.RESIDENTS);
        const residentMap = new Map(residents.map(r => [r.id, r]));
        
        const enriched = distributions.map(d => {
            const resident = residentMap.get(d.residentId);
            const processingResult = d.revoked ? '已撤销' : 
                                   d.rejected ? '已驳回' : 
                                   d.status === DISTRIBUTION_STATUS.SYNCED ? '已通过' : 
                                   d.status === DISTRIBUTION_STATUS.CONFLICTED ? '待复核' : '处理中';
            return {
                ...d,
                residentIdCard: resident?.idCard || '',
                supplyName: supplyMap.get(d.supplyId)?.name || '未知物资',
                formattedDate: formatDate(d.timestamp),
                statusText: d.revoked ? '已撤销' : (d.rejected ? '已驳回' : this.getStatusText(d.status)),
                syncedDateText: d.syncedAt ? formatDate(d.syncedAt) : '',
                importSourceText: d.importSource ? this.getImportSourceText(d.importSource) : '手动录入',
                batchId: batch.id,
                batchFileName: batch.fileName,
                processingResult: processingResult,
                errorType: d.importErrors ? '导入验证错误' : '',
                errorTypeLabel: d.importErrors ? '导入验证错误' : '',
                errorMessage: d.importErrors ? d.importErrors.join('; ') : '',
                resolvedByName: d.resolvedByName || '',
                resolvedAt: d.resolvedAt ? formatDate(d.resolvedAt) : ''
            };
        });

        const failedEnriched = failedRecords.map((f, idx) => ({
            id: `failed_${idx}`,
            residentName: f.recordData?.residentName || '',
            residentIdCard: f.recordData?.idCard || '',
            supplyName: f.recordData?.supplyName || '',
            quantity: f.recordData?.quantity || '',
            formattedDate: formatDate(batch.timestamp),
            statusText: '导入失败',
            errorType: f.type,
            errorMessage: f.message,
            errorTypeLabel: this.getConflictTypeLabel(f.type),
            importSourceText: batch.source ? this.getImportSourceText(batch.source) : '未知',
            batchId: batch.id,
            batchFileName: batch.fileName,
            processingResult: '待复查',
            rowIndex: f.index
        }));

        const allRecords = [...enriched, ...failedEnriched];

        if (format === 'csv') {
            return this.exportBatchDetailToCSV(allRecords, batch);
        } else {
            return this.exportToJSON({
                batch,
                distributions: enriched,
                conflicts,
                failedRecords
            });
        }
    }

    getBatchStatusText(status) {
        const map = {
            [BATCH_STATUS.PROCESSING]: '处理中',
            [BATCH_STATUS.COMPLETED]: '已完成',
            [BATCH_STATUS.PARTIAL]: '部分成功',
            [BATCH_STATUS.REVOKED]: '已撤销'
        };
        return map[status] || status;
    }

    getConflictTypeLabel(type) {
        const labels = {
            [CONFLICT_TYPES.STOCK_OVERFLOW]: '库存不足',
            [CONFLICT_TYPES.DUPLICATE_DISTRIBUTION]: '重复领取',
            [CONFLICT_TYPES.DAILY_LIMIT_EXCEEDED]: '超每日限领',
            [CONFLICT_TYPES.INVALID_RESIDENT]: '居民不存在',
            [CONFLICT_TYPES.INVALID_SUPPLY]: '物资不存在',
            [CONFLICT_TYPES.IMPORT_VALIDATION_ERROR]: '导入验证错误',
            [CONFLICT_TYPES.VERSION_CONFLICT]: '版本冲突',
            [CONFLICT_TYPES.PERMISSION_DENIED]: '权限不足'
        };
        return labels[type] || type || '未知错误';
    }

    exportBatchesToCSV(data) {
        const headers = [
            '批次ID', '文件名', '状态', '来源', '创建人', '创建时间',
            '总记录数', '成功数', '冲突数', '已撤销数', '文件哈希'
        ];

        const rows = data.map(d => [
            d.id,
            d.fileName,
            d.statusText,
            d.sourceText,
            d.createdBy || '',
            d.formattedDate,
            d.totalRecords || 0,
            d.successCount || 0,
            d.conflictCount || 0,
            d.revokedCount || 0,
            d.fileHash || ''
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const BOM = '\uFEFF';
        return BOM + csvContent;
    }

    exportBatchDetailToCSV(data, batch) {
        const headers = [
            '行号', '居民姓名', '身份证号', '物资名称', '领取数量',
            '领取时间', '状态', '处理结果', '数据来源',
            '错误类型', '错误信息', '批次号', '批次文件',
            '处理人', '处理时间', '同步时间'
        ];

        const rows = data.map(d => [
            d.rowIndex || d.importRow || '',
            d.residentName || '',
            maskIdCard(d.residentIdCard || ''),
            d.supplyName || '',
            d.quantity || '',
            d.formattedDate,
            d.statusText,
            d.processingResult || '',
            d.importSourceText || '',
            d.errorTypeLabel || d.errorType || '',
            (d.errorMessage || '').replace(/,/g, '，').replace(/\n/g, ' '),
            d.batchId || batch.id,
            d.batchFileName || batch.fileName,
            d.resolvedByName || '',
            d.resolvedAt || '',
            d.syncedDateText || ''
        ]);

        const batchHeader = [
            `批次号: ${batch.id}`,
            `文件名: ${batch.fileName}`,
            `状态: ${this.getBatchStatusText(batch.status)}`,
            `创建人: ${batch.createdBy || '未知'}`,
            `创建时间: ${formatDate(batch.timestamp)}`,
            `成功数: ${batch.successCount || 0}`,
            `冲突数: ${batch.conflictCount || 0}`,
            `失败数: ${(batch.failedRecords || []).length}`,
            `已撤销数: ${batch.revokedCount || 0}`,
            '', '', '', '', '', '', ''
        ];

        const csvContent = [
            batchHeader.join(','),
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const BOM = '\uFEFF';
        return BOM + csvContent;
    }

    async exportAndDownload(type = 'distributions', format = 'csv', startDate = null, endDate = null) {
        let content;
        let filename;
        let mimeType;

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

        if (type === 'distributions') {
            content = await this.exportDistributions(format, startDate, endDate);
            filename = `领取记录_${dateStr}.${format}`;
            await exportRecordEngine.recordExport('distributions', format, null, filename);
        } else if (type === 'audit') {
            await permissionGate.signOperation(PERMISSION_ACTIONS.EXPORT_AUDIT, null, { type, format });
            content = await this.exportAuditLogs(format, startDate, endDate);
            filename = `审计日志_${dateStr}.${format}`;
            await exportRecordEngine.recordExport('audit', format, null, filename);
        } else if (type === 'batches') {
            await permissionGate.signOperation(PERMISSION_ACTIONS.EXPORT_BATCHES, null, { type, format });
            content = await this.exportBatches(format, startDate, endDate);
            filename = `批次列表_${dateStr}.${format}`;
            await exportRecordEngine.recordExport('batches', format, null, filename);
        } else if (type === 'both') {
            await permissionGate.signOperation(PERMISSION_ACTIONS.EXPORT_AUDIT, null, { type, format });
            const distContent = await this.exportDistributions(format, startDate, endDate);
            const auditContent = await this.exportAuditLogs(format, startDate, endDate);
            
            const distFilename = `领取记录_${dateStr}.${format}`;
            this.downloadFile(distContent, distFilename, 
                format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
                'distributions', null);
            await exportRecordEngine.recordExport('distributions', format, null, distFilename);
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const auditFilename = `审计日志_${dateStr}.${format}`;
            this.downloadFile(auditContent, auditFilename,
                format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
                'audit', null);
            await exportRecordEngine.recordExport('audit', format, null, auditFilename);
            
            return `${distFilename}, ${auditFilename}`;
        }

        mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
        
        this.downloadFile(content, filename, mimeType, type, null);
        
        return filename;
    }

    async exportBatchAndDownload(batchId, format = 'csv') {
        await permissionGate.signOperation(PERMISSION_ACTIONS.BATCH_EXPORT, batchId, { format });
        const content = await this.exportBatchDetail(batchId, format);
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `批次详情_${batchId.slice(-8)}_${dateStr}.${format}`;
        const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
        
        this.downloadFile(content, filename, mimeType, 'batch_detail', batchId);
        await exportRecordEngine.recordExport('batch_detail', format, batchId, filename);
        
        return filename;
    }

    async exportBatchCSV(batchId) {
        return await this.exportBatchAndDownload(batchId, 'csv');
    }

    async exportBatchJSON(batchId) {
        return await this.exportBatchAndDownload(batchId, 'json');
    }
}

const dataExporter = new DataExporter();
