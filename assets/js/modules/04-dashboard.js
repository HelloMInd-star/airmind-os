/*!
 * AirMind V2.2 — 04-dashboard
 * 总控仪表盘：数据引擎 / 渲染 / 雷达图
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 11. 总控仪表盘 - 模拟数据引擎
            // ============================================================
            function simulateDashboardData() {
                var s = store.scenario;
                // 所有指标向「情景目标值」收敛 + 小幅噪声，取代原来的无意义随机游走
                var targetEq   = targetEquilibrium();
                var targetTask = 1284 * s.demand;
                var targetLat  = 3.2 * (1 + (s.demand - 1) * 0.40);
                var targetNode = clamp(700 + s.demand * 180, 680, 985);
                var targetAvail = 99.9 - (s.congestion - 0.45) * 0.60 - (s.demand > 1.5 ? 0.30 : 0);
                var targetAsset = 12.4 * (1 + (s.demand - 1) * 0.35);

                store.equilibrium += (targetEq - store.equilibrium) * 0.12 + (Math.random() - 0.5) * 0.006;
                store.equilibrium = clamp(store.equilibrium, 0.28, 0.92);
                store.tasks = Math.floor(lerp(store.tasks, targetTask, 0.15) + (Math.random() - 0.5) * 8);
                store.latency = clamp(lerp(store.latency, targetLat, 0.15) + (Math.random() - 0.5) * 0.08, 1.6, 9.0);
                store.nodes = Math.floor(clamp(lerp(store.nodes, targetNode, 0.12) + (Math.random() - 0.5) * 3, 650, 1000));
                store.availability = clamp(lerp(store.availability, targetAvail, 0.12) + (Math.random() - 0.5) * 0.05, 96.0, 99.99);
                store.assets = clamp(lerp(store.assets, targetAsset, 0.12) + (Math.random() - 0.5) * 0.06, 6.0, 20.0);

                // 雷达五维同样由情景驱动
                store.radarRisk       = clamp(0.30 + s.congestion * 0.38 + (1 - s.fStar) * 0.10 + (Math.random() - 0.5) * 0.02, 0.20, 0.95);
                store.radarCredit     = clamp(0.30 + s.fStar * 0.30 + (Math.random() - 0.5) * 0.02, 0.15, 0.80);
                store.radarYield      = clamp(0.14 + s.fStar * 0.40 + (s.demand - 1) * 0.10 + (Math.random() - 0.5) * 0.02, 0.05, 0.75);
                store.radarLiquidity  = clamp(0.55 - s.congestion * 0.30 + (Math.random() - 0.5) * 0.02, 0.12, 0.70);
                store.radarCompliance = clamp(0.62 - (s.weatherIdx * 0.04) + (Math.random() - 0.5) * 0.02, 0.25, 0.80);

                store.cpu = clamp(store.cpu + (Math.random() - 0.5) * 4, 45, 92);
                store.mem = clamp(store.mem + (Math.random() - 0.5) * 3, 40, 85);
                store.net = clamp(store.net + (Math.random() - 0.5) * 4, 60, 95);
                store.ingest = clamp(store.ingest + (Math.random() - 0.5) * 0.1, 1.2, 3.5);
                store.decision = clamp(store.decision + (Math.random() - 0.5) * 2, 85, 100);
            }

            // ============================================================
            // 12. 总控仪表盘 - 渲染
            // ============================================================
            function renderDashboard() {
                document.getElementById('kpiAvailability').textContent = store.availability.toFixed(1) + '%';
                document.getElementById('kpiTasks').textContent = store.tasks.toLocaleString();
                document.getElementById('kpiLatency').textContent = store.latency.toFixed(1) + 'ms';
                document.getElementById('kpiNodes').textContent = store.nodes + '/' + store.nodesTotal;
                document.getElementById('kpiAssets').textContent = 'B' + store.assets.toFixed(1) + 'M';
                document.getElementById('kpiEquilibrium').textContent = store.equilibrium.toFixed(2);

                var eq = store.equilibrium;
                var zoneEl = document.getElementById('equilibriumZone');
                if (eq < 0.60) zoneEl.textContent = '🟢 安全区';
                else if (eq < 0.80) zoneEl.textContent = '🟡 预警区';
                else zoneEl.textContent = '🔴 熔断区';

                document.getElementById('steadyValue').textContent = eq.toFixed(2);
                document.getElementById('steadyDisplay').textContent = eq.toFixed(2);
                var pct = ((eq - 0.40) / 0.40) * 100;
                document.getElementById('steadyMarker').style.left = Math.min(Math.max(pct, 5), 95) + '%';

                var tag = document.getElementById('statusTag');
                var label = document.getElementById('statusLabel');
                if (eq < 0.60) { tag.className = 'status-tag';
                    label.textContent = 'SYSTEM STABLE'; } else if (eq < 0.80) { tag.className = 'status-tag warning';
                    label.textContent = '⚠️ 预警中'; } else { tag.className = 'status-tag danger';
                    label.textContent = '🔴 高风险'; }

                document.getElementById('loadCpu').textContent = Math.round(store.cpu) + '%';
                document.getElementById('loadCpuBar').style.width = Math.round(store.cpu) + '%';
                document.getElementById('loadMem').textContent = Math.round(store.mem) + '%';
                document.getElementById('loadMemBar').style.width = Math.round(store.mem) + '%';
                document.getElementById('loadNet').textContent = Math.round(store.net) + '%';
                document.getElementById('loadNetBar').style.width = Math.round(store.net) + '%';

                document.getElementById('flowIngest').textContent = store.ingest.toFixed(1) + 'GB/s';
                document.getElementById('flowDecision').textContent = store.decision > 95 ? 'Active' : 'Pending';
                document.getElementById('flowExec').textContent = Math.round(store.decision) + '%';

                document.getElementById('radarSubtitle').textContent =
                    '风险 ' + store.radarRisk.toFixed(2) + ' · 管控 ' + store.radarCompliance.toFixed(2) + ' · 收益 ' +
                    store.radarYield.toFixed(2);

                if (window.radarChartInstance && typeof window.radarChartInstance.getOption === 'function') {
                    var opt = window.radarChartInstance.getOption();
                    if (opt && opt.series && opt.series[0]) {
                        opt.series[0].data[0].value = [
                            parseFloat(store.radarRisk.toFixed(2)),
                            parseFloat(store.radarCredit.toFixed(2)),
                            parseFloat(store.radarYield.toFixed(2)),
                            parseFloat(store.radarLiquidity.toFixed(2)),
                            parseFloat(store.radarCompliance.toFixed(2))
                        ];
                        window.radarChartInstance.setOption(opt);
                    }
                }
            }

            // ============================================================
            // 13. 总控 - ECharts 雷达图
            // ============================================================
            function initRadarChart() {
                var dom = document.getElementById('radarChart');
                if (!dom) return;
                if (window.radarChartInstance) window.radarChartInstance.dispose();
                if (typeof echarts === 'undefined') {
                    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ym-text-muted);font-size:13px;">📡 ECharts 加载中...</div>';
                    return;
                }
                var chart = echarts.init(dom, currentChartTheme());
                window.radarChartInstance = chart;

                var option = {
                    tooltip: {
                        trigger: 'item',
                        backgroundColor: 'rgba(10,14,23,0.85)',
                        borderColor: 'rgba(255,255,255,0.06)',
                        textStyle: { color: '#EDEAE3' },
                        formatter: function(params) {
                            var res = '<strong>' + params.name + '</strong><br/>';
                            params.value.forEach(function(v, i) {
                                res += params.radar.indicator[i].name + '：' + v + '<br/>';
                            });
                            return res;
                        }
                    },
                    radar: {
                        indicator: [
                            { name: '市场风险', max: 1 },
                            { name: '信用风险', max: 1 },
                            { name: '收益率', max: 1 },
                            { name: '流动性', max: 1 },
                            { name: '合规管控', max: 1 },
                        ],
                        shape: 'circle',
                        splitNumber: 4,
                        axisName: { color: '#B8BFC9', fontSize: 11, fontWeight: 500 },
                        splitArea: { areaStyle: { color: ['rgba(59,130,246,0.02)', 'rgba(59,130,246,0.04)'] } },
                        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
                        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
                        center: ['50%', '50%'],
                        radius: '70%',
                    },
                    series: [{
                        type: 'radar',
                        data: [{
                            value: [
                                store.radarRisk,
                                store.radarCredit,
                                store.radarYield,
                                store.radarLiquidity,
                                store.radarCompliance
                            ],
                            name: '三维评估',
                            areaStyle: { color: 'rgba(59,130,246,0.25)' },
                            lineStyle: { color: '#3B82F6', width: 2 },
                            itemStyle: { color: '#3B82F6' }
                        }],
                        symbol: 'circle',
                        symbolSize: 6,
                        animationDuration: 800,
                    }]
                };
                chart.setOption(option);

                window.addEventListener('resize', function() {
                    if (window.radarChartInstance) window.radarChartInstance.resize();
                });
            }
