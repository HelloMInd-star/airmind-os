/*!
 * AirMind V2.2 — 03-emergency
 * 应急调度：策略库 / 存储 / 渲染 / 图表 / 导出
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 2. 应急调度 - 策略库
            // ============================================================
            var STRATEGIES = AirMind.DEFAULT_STRATEGIES;

            // ============================================================
            // 3. 应急调度 - 数据存储 (localStorage)
            // ============================================================
            var EMERGENCY_STORAGE_KEY = 'ym_emergency_records';   // v2 遗留 key，仅用于迁移
            var EKEY = 'emergency_records';                        // v3 统一命名空间

            function getEmergencyRecords() {
                // v2 → v3 一次性迁移：老用户的历史记录不会丢
                if (!safeStore.get('__mig_emg', false)) {
                    try {
                        var raw = localStorage.getItem(EMERGENCY_STORAGE_KEY);
                        if (raw) {
                            var legacy = JSON.parse(raw);
                            if (Array.isArray(legacy) && legacy.length) {
                                safeStore.set(EKEY, legacy);
                                safeStore.remove(EKEY);
                                console.log('[AirMind] 已迁移 ' + legacy.length + ' 条历史应急记录');
                            }
                        }
                    } catch (e) {}
                    safeStore.set('__mig_emg', true);
                }
                var rs = safeStore.get(EKEY, []);
                return Array.isArray(rs) ? rs : [];
            }

            function saveEmergencyRecords(records) {
                if (!safeStore.set(EKEY, records)) {
                    toast('⚠️ 存储写入失败（可能已满），请导出 JSON 备份后清理。', 'danger');
                }
            }

            // ============================================================
            // 4. 应急调度 - 表单数据读取
            // ============================================================
            function getEmergencyFormData() {
                var v = function(id, def) {
                    var el = document.getElementById(id);
                    if (!el) return def;
                    var val = parseInt(el.value);
                    return isNaN(val) ? def : val;
                };
                return {
                    height: v('height', 100),
                    speed: v('speed', 8),
                    battery: v('battery', 85),
                    wind: v('wind', 2),
                    obstacle: v('obstacle', 300),
                    disasterType: document.getElementById('disasterType') ? document.getElementById('disasterType').value : 'fire',
                    fireLevel: v('fireLevel', 0),
                    trapped: v('trapped', 0),
                    supplyGap: v('supplyGap', 0),
                    commStatus: document.getElementById('commStatus') ? document.getElementById('commStatus').value : 'normal',
                    evacuees: v('evacuees', 0),
                };
            }

            // ============================================================
            // 5. 应急调度 - 策略匹配
            // ============================================================
            function matchStrategy(data) {
                var top = AirMind.matchStrategy(data, STRATEGIES);
                var full = STRATEGIES.filter(function(s) { return s.id === top.id; })[0] || STRATEGIES[STRATEGIES.length - 1];
                return { id: top.id, name: top.name, desc: top.desc, icon: top.icon, conf: top.conf, matched: top.matched, weight: full.weight };
            }

            // ============================================================
            // 6. 应急调度 - 渲染策略卡片
            // ============================================================
            function renderStrategies() {
                var data = getEmergencyFormData();
                var matched = matchStrategy(data);
                var container = document.getElementById('strategyContainer');
                if (!container) return;

                container.innerHTML = STRATEGIES.map(function(s) {
                    var active = s.id === matched.id ? 'active' : '';
                    return '<div class="strategy-card ' + active + '">' +
                        '<span class="icon">' + s.icon + '</span>' +
                        '<div class="name">' + s.name + '</div>' +
                        '<div class="desc">' + s.desc + '</div>' +
                        '</div>';
                }).join('');

                document.getElementById('matchedStrategyName').textContent = matched.icon + ' ' + matched.name;
                document.getElementById('matchedStrategyDesc').textContent = matched.desc;
                document.getElementById('matchedStrategyConf').textContent = '置信度 ' + matched.conf + '/12';
                document.getElementById('strategyCount').textContent = STRATEGIES.length + ' 种';
            }

            // ============================================================
            // 7. 应急调度 - 渲染历史表格
            // ============================================================
            function renderEmergencyHistory() {
                var records = getEmergencyRecords();
                var tbody = document.getElementById('historyBody');
                if (!tbody) return;

                if (records.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" class="empty">暂无记录</td></tr>';
                    document.getElementById('historyCount').textContent = '0';
                    return;
                }

                var sorted = records.slice().sort(function(a, b) { return b.id - a.id; });
                var disasterMap = { fire: '🔥 火灾', flood: '🌊 洪水', earthquake: '🌍 地震', other: '⚠️ 其他' };

                tbody.innerHTML = sorted.map(function(r) {
                    return '<tr>' +
                        '<td>' + r.timestamp + '</td>' +
                        '<td>' + (disasterMap[r.disasterType] || r.disasterType) + '</td>' +
                        '<td>' + r.trapped + '</td>' +
                        '<td><span class="strategy-tag">' + (r.matchedStrategyName || '—') + '</span></td>' +
                        '<td style="text-align:right;"><button class="btn btn-danger btn-sm" data-del="' + r.id + '">删除</button></td>' +
                        '</tr>';
                }).join('');

                document.getElementById('historyCount').textContent = records.length;

                tbody.querySelectorAll('[data-del]').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var id = Number(this.dataset.del);
                        if (confirm('确定删除此记录吗？')) {
                            var rs = getEmergencyRecords().filter(function(r) { return r.id !== id; });
                            saveEmergencyRecords(rs);
                            renderEmergencyHistory();
                            updateEmergencyChart();
                        }
                    });
                });
            }

            // ============================================================
            // 8. 应急调度 - ECharts 图表
            // ============================================================
            var emergencyChartInstance = null;

            function initEmergencyChart() {
                var dom = document.getElementById('emergencyChart');
                if (!dom) return;
                if (emergencyChartInstance) emergencyChartInstance.dispose();
                if (typeof echarts === 'undefined') {
                    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ym-text-muted);font-size:13px;">📊 ECharts 加载中...</div>';
                    return;
                }
                emergencyChartInstance = echarts.init(dom, currentChartTheme());
                updateEmergencyChart();
                window.addEventListener('resize', function() {
                    if (emergencyChartInstance) emergencyChartInstance.resize();
                });
            }

            function updateEmergencyChart() {
                var records = getEmergencyRecords();
                var count = records.length;
                document.getElementById('recordCount').textContent = count;
                document.getElementById('recordCountBadge').textContent = count + ' 条';

                if (!emergencyChartInstance) return;

                if (count === 0) {
                    document.getElementById('latestTime').textContent = '—';
                    emergencyChartInstance.setOption({
                        title: { text: '暂无数据', left: 'center', top: 'center',
                            textStyle: { color: '#4A4540', fontSize: 13 } },
                        xAxis: { show: false },
                        yAxis: { show: false },
                        series: []
                    });
                    return;
                }

                var latest = records[records.length - 1];
                document.getElementById('latestTime').textContent = latest.timestamp;

                var sorted = records.slice().sort(function(a, b) { return a.id - b.id; });
                var times = sorted.map(function(r) { return (r.timestamp || '').slice(5, 16); });
                var trappedData = sorted.map(function(r) { return r.trapped || 0; });
                var supplyData = sorted.map(function(r) { return r.supplyGap || 0; });

                var option = {
                    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                    legend: {
                        data: ['被困人员', '物资缺口'],
                        textStyle: { color: chartBase().text, fontSize: 11 },
                        top: 0,
                        right: 0
                    },
                    grid: { left: 40, right: 16, top: 32, bottom: 12 },
                    xAxis: {
                        type: 'category',
                        data: times,
                        axisLabel: { color: '#6B7A8F', fontSize: 10, rotate: times.length > 6 ? 20 : 0 },
                        axisLine: { lineStyle: { color: '#2A3A5A' } }
                    },
                    yAxis: [{
                        type: 'value',
                        name: '人数',
                        nameTextStyle: { color: '#6B7A8F', fontSize: 10 },
                        axisLabel: { color: '#6B7A8F', fontSize: 10 },
                        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } }
                    }, {
                        type: 'value',
                        name: '物资',
                        nameTextStyle: { color: '#6B7A8F', fontSize: 10 },
                        axisLabel: { color: '#6B7A8F', fontSize: 10 },
                        splitLine: { show: false }
                    }],
                    series: [{
                        name: '被困人员',
                        type: 'bar',
                        data: trappedData,
                        color: '#D4A040',
                        barWidth: '32%',
                        yAxisIndex: 0,
                        itemStyle: { borderRadius: [3, 3, 0, 0] }
                    }, {
                        name: '物资缺口',
                        type: 'line',
                        data: supplyData,
                        color: '#4DD0E1',
                        smooth: true,
                        symbol: 'circle',
                        symbolSize: 5,
                        yAxisIndex: 1,
                        lineStyle: { width: 2 }
                    }]
                };
                emergencyChartInstance.setOption(option, true);
                emergencyChartInstance.resize();
            }

            // ============================================================
            // 9. 应急调度 - 保存/清空
            // ============================================================
            function handleSaveEmergency() {
                var data = getEmergencyFormData();
                var matched = matchStrategy(data);
                var record = {
                    id: Date.now(),
                    timestamp: new Date().toLocaleString('zh-CN', { hour12: false }),
                    ...data,
                    matchedStrategy: matched.id,
                    matchedStrategyName: matched.name,
                    matchedConfidence: matched.conf,
                };
                var records = getEmergencyRecords();
                records.push(record);
                saveEmergencyRecords(records);

                document.getElementById('inputStatus').textContent = '✅ 已保存';
                document.getElementById('inputStatus').style.color = '#4DD0E1';

                renderEmergencyHistory();
                updateEmergencyChart();

                setTimeout(function() {
                    document.getElementById('inputStatus').textContent = '就绪';
                    document.getElementById('inputStatus').style.color = '';
                }, 2000);
            }

            function handleClearEmergency() {
                var records = getEmergencyRecords();
                if (records.length === 0) { alert('暂无记录可清空'); return; }
                if (confirm('⚠️ 确定清空所有历史记录吗？此操作不可撤销！')) {
                    safeStore.remove(EKEY);
                    document.getElementById('inputStatus').textContent = '🗑️ 已清空';
                    document.getElementById('inputStatus').style.color = '#EF5350';
                    renderEmergencyHistory();
                    updateEmergencyChart();
                    setTimeout(function() {
                        document.getElementById('inputStatus').textContent = '就绪';
                        document.getElementById('inputStatus').style.color = '';
                    }, 2000);
                }
            }

            // ============================================================
            // 10. 应急调度 - 导出功能
            // ============================================================
            function exportEmergencyPDF() {
                var btn = document.getElementById('exportPdfBtn');
                var orig = btn.textContent;
                btn.textContent = '⏳ 生成中...';
                btn.disabled = true;

                try {
                    var element = document.getElementById('app');
                    html2canvas(element, {
                        scale: 2,
                        backgroundColor: '#0A0E17',
                        useCORS: true,
                        logging: false,
                        windowHeight: element.scrollHeight,
                    }).then(function(canvas) {
                        var imgData = canvas.toDataURL('image/png');
                        var pdf = new jspdf.jsPDF('p', 'mm', 'a4');
                        // 长页面按 A4 可印区域切片，避免被压缩成一坨看不清
                        var margin = 8, pageW = 210, pageH = 297;
                        var imgW = pageW - margin * 2;
                        var imgH = (canvas.height * imgW) / canvas.width;
                        var usable = pageH - margin * 2;
                        var left = imgH, pos = margin;
                        pdf.addImage(imgData, 'PNG', margin, pos, imgW, imgH);
                        left -= usable;
                        while (left > 0) {
                            pos -= usable;
                            pdf.addPage();
                            pdf.addImage(imgData, 'PNG', margin, pos, imgW, imgH);
                            left -= usable;
                        }
                        var total = pdf.internal.getNumberOfPages();
                        for (var p = 1; p <= total; p++) {
                            pdf.setPage(p);
                            pdf.setFontSize(8);
                            pdf.setTextColor(140);
                            pdf.text('Y.Mine AirMind V2.1 · 应急调度报告 · ' + new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 第 ' + p + '/' + total + ' 页', margin, 4);
                        }
                        pdf.save('应急调度报告_' + new Date().toISOString().slice(0, 10) + '.pdf');
                    }).catch(function(err) {
                        alert('导出 PDF 失败，请检查控制台错误。');
                        console.error(err);
                    }).finally(function() {
                        btn.textContent = orig;
                        btn.disabled = false;
                    });
                } catch (e) {
                    alert('导出失败，请检查 CDN 是否加载完整。');
                    btn.textContent = orig;
                    btn.disabled = false;
                }
            }

            function exportEmergencyJSON() {
                var records = getEmergencyRecords();
                if (records.length === 0) { alert('暂无数据可导出'); return; }
                var blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = '应急调度记录_' + new Date().toISOString().slice(0, 10) + '.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            function printEmergencyPage() {
                window.print();
            }
