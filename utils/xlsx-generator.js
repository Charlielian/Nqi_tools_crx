/**
 * Excel 生成工具模块
 * 使用 SheetJS 库生成 Excel 文件
 */

(function(global) {
    'use strict';

    const ExcelGenerator = {
        defaultStyles: {
            header: {
                font: { bold: true, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: '4472C4' } },
                alignment: { horizontal: 'center', vertical: 'center' },
                border: {
                    top: { style: 'thin', color: { rgb: '000000' } },
                    bottom: { style: 'thin', color: { rgb: '000000' } },
                    left: { style: 'thin', color: { rgb: '000000' } },
                    right: { style: 'thin', color: { rgb: '000000' } }
                }
            },
            cell: {
                alignment: { vertical: 'center' },
                border: {
                    top: { style: 'thin', color: { rgb: 'CCCCCC' } },
                    bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
                    left: { style: 'thin', color: { rgb: 'CCCCCC' } },
                    right: { style: 'thin', color: { rgb: 'CCCCCC' } }
                }
            }
        },

        async generate(data, options = {}) {
            if (typeof XLSX === 'undefined') {
                await this.loadLibrary();
            }

            const config = {
                sheetName: options.sheetName || '数据',
                headers: options.headers || null,
                title: options.title || null,
                author: options.author || '大数据平台导出工具',
                ...options
            };

            return this.createWorkbook(data, config);
        },

        async loadLibrary() {
            if (document.querySelector('script[src*="sheetjs"]')) {
                return new Promise(resolve => {
                    const check = setInterval(() => {
                        if (typeof XLSX !== 'undefined') {
                            clearInterval(check);
                            resolve();
                        }
                    }, 100);
                });
            }

            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
                script.onload = () => {
                    console.log('[ExcelGenerator] SheetJS loaded');
                    resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        },

        createWorkbook(data, config) {
            const wb = XLSX.utils.book_new();

            let ws;
            if (config.headers && config.headers.length > 0) {
                const dataWithHeaders = [config.headers, ...data.map(row => this.rowToArray(row, config.headers))];
                ws = XLSX.utils.aoa_to_sheet(dataWithHeaders);
            } else if (data.length > 0) {
                ws = XLSX.utils.json_to_sheet(data);
            } else {
                ws = XLSX.utils.aoa_to_sheet([['无数据']]);
            }

            this.applyColumnWidths(ws, data, config);
            this.applyStyles(ws, config);

            if (config.title) {
                this.addTitleRow(ws, config.title);
            }

            XLSX.utils.book_append_sheet(wb, ws, config.sheetName.substring(0, 31));

            this.addMetadata(wb, config);

            return wb;
        },

        rowToArray(row, headers) {
            if (Array.isArray(row)) return row;

            if (typeof row === 'object' && row !== null) {
                return headers.map(h => {
                    const key = this.findKeyByValue(row, h) || h;
                    const value = row[key];
                    return this.formatValue(value);
                });
            }

            return [row];
        },

        findKeyByValue(obj, targetValue) {
            for (const [key, value] of Object.entries(obj)) {
                if (String(value) === String(targetValue) ||
                    this.normalizeText(String(value)) === this.normalizeText(String(targetValue))) {
                    return key;
                }
            }
            return null;
        },

        normalizeText(text) {
            return text.replace(/\s+/g, '').toLowerCase();
        },

        formatValue(value) {
            if (value === null || value === undefined) return '';
            if (typeof value === 'number') return value;
            if (typeof value === 'boolean') return value ? '是' : '否';
            if (value instanceof Date) return value;
            return String(value);
        },

        applyColumnWidths(ws, data, config) {
            const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
            const cols = [];

            for (let i = range.s.c; i <= range.e.c; i++) {
                let maxWidth = 10;

                const headerValue = config.headers ? config.headers[i] : this.getColumnLetter(i);
                if (headerValue) {
                    maxWidth = Math.max(maxWidth, this.strlen(headerValue));
                }

                for (let j = range.s.r + 1; j <= range.e.r; j++) {
                    const cell = ws[XLSX.utils.encode_cell({ r: j, c: i })];
                    if (cell && cell.v) {
                        const cellLength = this.strlen(String(cell.v));
                        maxWidth = Math.max(maxWidth, Math.min(cellLength, 50));
                    }
                }

                cols.push({ wch: Math.min(maxWidth + 2, 100) });
            }

            ws['!cols'] = cols;
        },

        strlen(str) {
            const len = str.replace(/[^\x00-\xff]/g, 'xx').length;
            return Math.max(len, 10);
        },

        getColumnLetter(col) {
            let letter = '';
            while (col >= 0) {
                letter = String.fromCharCode((col % 26) + 65) + letter;
                col = Math.floor(col / 26) - 1;
            }
            return letter;
        },

        applyStyles(ws, config) {
            const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

            for (let i = range.s.c; i <= range.e.c; i++) {
                const headerCell = XLSX.utils.encode_cell({ r: 0, c: i });
                if (!ws[headerCell]) continue;

                ws[headerCell].s = this.defaultStyles.header;
            }
        },

        addTitleRow(ws, title) {
            const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
            const titleCell = XLSX.utils.encode_cell({ r: 0, c: 0 });

            ws[titleCell].v = title;
            ws[titleCell].s = {
                font: { bold: true, size: 14 },
                alignment: { horizontal: 'center' },
                fill: { fgColor: { rgb: 'E7E6E6' } }
            };

            range.e.r = range.e.r + 1;
            ws['!ref'] = XLSX.utils.encode_range(range.s, range.e);
        },

        addMetadata(wb, config) {
            wb.Props = {
                Title: config.title || '大数据平台导出数据',
                Author: config.author,
                Subject: '数据导出',
                CreatedDate: new Date()
            };
        },

        download(wb, filename) {
            if (typeof XLSX === 'undefined') {
                throw new Error('XLSX library not loaded');
            }

            const defaultName = `${filename || 'export'}_${this.formatDate(new Date())}.xlsx`;
            XLSX.writeFile(wb, defaultName);
        },

        formatDate(date) {
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            const HH = String(date.getHours()).padStart(2, '0');
            const MM = String(date.getMinutes()).padStart(2, '0');
            return `${yyyy}${mm}${dd}_${HH}${MM}`;
        }
    };

    global.ExcelGenerator = ExcelGenerator;

})(typeof window !== 'undefined' ? window : this);
