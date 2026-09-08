/*!
 * AirMind V2.2 — 09-pid
 * Tab4 串级 PID 仿真
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 16.6 Tab4 串级 PID 仿真：图表 + 指标
            // ============================================================
            function initPidChart() {
                var dom = document.getElementById('pidChart');
                if (!dom) return;
                if (window.pidChartInstance) window.pidChartInstance.dispose();
                if (typeof echarts === 'undefined') {
                    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ym-text-muted);font-size:13px;">📉 ECharts 不可用，已降级为数值模式（指标仍可计算）</div>';
                    window.pidChartInstance = null;
                    return;
                }
                window.pidChartInstance = echarts.init(dom, currentChartTheme());
                window.addEventListener('resize', function() {
                    if (window.pidChartInstance) window.pidChartInstance.resize();
                });
            }

            function runPidSim() {
                var craft = (document.getElementById('pidCraft') || {}).value || '多点锁平开窗';
                var cfg = {
                    craft: craft,
                    kp: parseFloat((document.getElementById('pidKp') || {}).value || 0.120),
                    ki: parseFloat((document.getElementById('pidKi') || {}).value || 0.080),
                    kd: parseFloat((document.getElementById('pidKd') || {}).value || 0.050),
                    wind: parseFloat((document.getElementById('pidWind') || {}).value || 15)
                };
                var r = simulateCascade(cfg);
                var C = chartBase();

                document.getElementById('pidKpV').textContent = cfg.kp.toFixed(3);
                document.getElementById('pidKiV').textContent = cfg.ki.toFixed(3);
                document.getElementById('pidKdV').textContent = cfg.kd.toFixed(3);
                document.getElementById('pidWindV').textContent = cfg.wind + ' m/s';
                document.getElementById('pidPeak').textContent = r.peak.toFixed(3) + ' m';
                document.getElementById('pidSettle').textContent = (r.settle > 0 ? r.settle.toFixed(2) + ' s' : '< 0.01 s');
                document.getElementById('pidSteady').textContent = r.steady.toFixed(3) + ' m';
                document.getElementById('pidHuman').textContent = Math.round(r.humanW * 100) + '%';

                var desc = document.getElementById('pidCraftDesc');
                if (desc) desc.innerHTML = '🧬 <strong>' + craft + '</strong> · ζ=' + r.zeta + ' ωn=' + r.wn + ' · ' + r.tag +
                    '<br/><span style="color:var(--ym-text-dim);">阻尼比越低越"飘"，需要更高人工接管权重兜底。</span>';

                var v = document.getElementById('pidVerdict');
                if (v) {
                    var grade, color;
                    if (r.steady < 0.02 && r.settle < 3.2) { grade = 'A · 稳态几乎无偏，扰动 3s 内收敛，可放心投入商业飞行。'; color = 'var(--ym-success)'; }
                    else if (r.steady < 0.08 && r.settle < 5.0) { grade = 'B · 可接受，乘客能感知轻微偏移，建议增大 I 消除稳态差。'; color = 'var(--ym-gold)'; }
                    else if (r.steady < 0.30) { grade = 'C · 偏差偏大，建议提高 P 或切换至多点锁平开窗机型。'; color = 'var(--ym-danger)'; }
                    else { grade = 'D · 已失控，积分饱和或增益过低，请立即复位参数。'; color = 'var(--ym-danger)'; }
                    v.style.borderLeftColor = color;
                    v.textContent = '📋 评估：' + grade;
                }

                if (!window.pidChartInstance) return;
                window.pidChartInstance.setOption({
                    tooltip: { trigger: 'axis' },
                    legend: { data: ['航迹偏差', '侧风'], textStyle: { color: C.text, fontSize: 11 }, top: 0, right: 0 },
                    grid: { left: 48, right: 46, top: 30, bottom: 26 },
                    xAxis: { type: 'value', name: 's', nameTextStyle: { color: C.text, fontSize: 10 }, min: 0, max: 8,
                        axisLabel: { color: C.text, fontSize: 10 }, axisLine: { lineStyle: { color: C.line } },
                        splitLine: { lineStyle: { color: C.split } } },
                    yAxis: [{ type: 'value', name: '偏差 m', nameTextStyle: { color: C.text, fontSize: 10 },
                        axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.split } } },
                        { type: 'value', name: 'm/s', nameTextStyle: { color: C.text, fontSize: 10 },
                        axisLabel: { color: C.text, fontSize: 10 }, splitLine: { show: false } }],
                    series: [
                        { name: '航迹偏差', type: 'line', showSymbol: false, smooth: true, data: r.series,
                            lineStyle: { width: 2, color: r.color }, areaStyle: { color: r.color, opacity: 0.10 },
                            markLine: { silent: true, symbol: 'none', data: [{ xAxis: 1.5, label: { formatter: '侧风注入', color: C.text, fontSize: 10 }, lineStyle: { color: '#EF5350', type: 'dashed' } }] } },
                        { name: '侧风', type: 'line', yAxisIndex: 1, showSymbol: false, step: 'end', data: r.windSeries,
                            lineStyle: { width: 1.4, color: '#8B5CF6', type: 'dotted' } }
                    ]
                }, true);
            }
