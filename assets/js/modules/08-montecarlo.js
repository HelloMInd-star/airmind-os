/*!
 * AirMind V2.2 — 08-montecarlo
 * Tab2 多期蒙特卡洛风险推演
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // Tab2 蒙特卡洛：多期风险推演
            // ============================================================
            function initMcChart() {
                var dom = document.getElementById('mcChart');
                if (!dom) return;
                if (window.mcChartInstance) window.mcChartInstance.dispose();
                if (typeof echarts === 'undefined') {
                    dom.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ym-text-muted);font-size:13px;">📉 ECharts 不可用，指标仍可计算</div>';
                    window.mcChartInstance = null;
                    return;
                }
                window.mcChartInstance = echarts.init(dom, currentChartTheme());
                window.addEventListener('resize', function() {
                    if (window.mcChartInstance) window.mcChartInstance.resize();
                });
            }

            function renderMonteCarlo() {
                var fEl = document.getElementById('mcF');
                var pEl = document.getElementById('mcPeriods');
                var bEl = document.getElementById('bSlider');
                var pSld = document.getElementById('pSlider');
                if (!fEl || !bEl || !pSld) return;

                var b = parseFloat(bEl.value);
                var p = parseFloat(pSld.value);
                var f = parseFloat(fEl.value);
                var periods = parseInt(pEl.value, 10) || 200;

                var r = AirMind.kellyMonteCarlo({ b: b, p: p, f: f, periods: periods, trials: 400, seed: 20240918 });
                var fStar = AirMind.kellyFraction(b, p);

                document.getElementById('mcFV').textContent = f.toFixed(2);
                var hint = document.getElementById('mcFStarHint');
                if (hint) hint.textContent = '凯利建议 ' + fStar.toFixed(2);

                var fmt = function(x) {
                    if (x < 0.01) return '<0.01';
                    if (x >= 1e6) return x.toExponential(2);   // 复利 200 期后是天文数字
                    return x.toFixed(2);
                };

                var ruinEl = document.getElementById('mcRuin');
                ruinEl.textContent = (r.ruinProb * 100).toFixed(1) + '%';
                ruinEl.className = 'value ' + (r.ruinProb > 0.30 ? 'danger' : (r.ruinProb > 0.05 ? 'gold' : 'success'));

                document.getElementById('mcP50').textContent = fmt(r.p50);
                document.getElementById('mcP50').className = 'value ' + (r.p50 >= 1 ? 'success' : 'danger');
                document.getElementById('mcBand').textContent = fmt(r.p10) + ' ~ ' + fmt(r.p90);
                var geoEl = document.getElementById('mcGeo');
                geoEl.textContent = (r.geoGrowth * 100).toFixed(2) + '%';
                geoEl.className = 'value ' + (r.geoGrowth > 0 ? 'success' : 'danger');

                var v = document.getElementById('mcVerdict');
                if (v) {
                    var msg, color;
                    if (fStar <= 0) {
                        msg = '🚫 当前赔率结构下凯利建议值为 ' + fStar.toFixed(2) + '（≤0）——此情景不值得投入，最佳动作是空仓观望，而非硬找仓位。';
                        color = 'var(--ym-danger)';
                    } else if (f > 1) {
                        msg = '⚠️ 仓位 >1 意味着加杠杆，已超出本模型适用范围（假设亏损不超过本金）。实际杠杆会放大尾部风险，此处仅供参考。';
                        color = 'var(--ym-danger)';
                    } else if (f > fStar * 1.8) {
                        msg = '⚠️ 当前仓位是凯利建议值的 ' + (f / Math.max(fStar, 0.01)).toFixed(1) + ' 倍——过度下注不会提高长期收益，只会把破产概率推到 ' + (r.ruinProb * 100).toFixed(0) + '%。';
                        color = 'var(--ym-danger)';
                    } else if (r.ruinProb > 0.30) {
                        msg = '🔴 破产概率偏高，建议下调仓位至 ' + (fStar > 0 ? fStar.toFixed(2) : '0') + ' 附近。';
                        color = 'var(--ym-danger)';
                    } else if (r.geoGrowth <= 0) {
                        msg = '📉 长期期望为负增长，此仓位不可持续。';
                        color = 'var(--ym-gold)';
                    } else {
                        msg = '✅ 仓位处于合理区间：每期几何增长 ' + (r.geoGrowth * 100).toFixed(2) + '%，破产概率 ' + (r.ruinProb * 100).toFixed(1) + '%。';
                        color = 'var(--ym-success)';
                    }
                    v.textContent = msg;
                    v.style.borderLeftColor = color;
                }

                if (!window.mcChartInstance) return;
                var C = chartBase();
                var xs = r.band.map(function(pt) { return pt.t; });
                // 取对数资金：复利下终值跨十几个数量级，线性轴会把早期特征压成一条线
                var LG = function(x) { return +Math.log(Math.max(x, 1e-6)).toFixed(3); };
                var lo = r.band.map(function(pt) { return LG(pt.p10); });
                var span = r.band.map(function(pt) { return +(LG(pt.p90) - LG(pt.p10)).toFixed(3); });
                var mid = r.band.map(function(pt) { return LG(pt.p50); });

                window.mcChartInstance.setOption({
                    tooltip: {
                        trigger: 'axis',
                        formatter: function(ps) {
                            var i = ps[0].dataIndex;
                            var f2 = function(x) { return x < 0.01 ? '<0.01' : (x >= 1e6 ? x.toExponential(2) : x.toFixed(2)); };
                            return '第 ' + xs[i] + ' 期<br/>P90 ' + f2(r.band[i].p90) +
                                '<br/>中位 ' + f2(r.band[i].p50) + '<br/>P10 ' + f2(r.band[i].p10);
                        }
                    },
                    legend: { data: ['P10–P90 区间', '中位轨迹'], textStyle: { color: C.text, fontSize: 11 },
                        top: 4, left: 'center', itemGap: 18 },
                    grid: { left: 58, right: 20, top: 36, bottom: 30, containLabel: true },
                    xAxis: { type: 'category', data: xs, name: '期', nameTextStyle: { color: C.text, fontSize: 10 },
                        axisLabel: { color: C.text, fontSize: 10 }, axisLine: { lineStyle: { color: C.line } } },
                    yAxis: { type: 'value', name: 'ln(资金)', nameTextStyle: { color: C.text, fontSize: 10 },
                        axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.split } } },
                    series: [
                        { name: 'P10–P90 区间', type: 'line', stack: 'band', data: lo, showSymbol: false,
                            lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true },
                        { name: 'P10–P90 区间', type: 'line', stack: 'band', data: span, showSymbol: false,
                            lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(59,130,246,0.18)' }, silent: true },
                        { name: '中位轨迹', type: 'line', data: mid, showSymbol: false, smooth: true,
                            lineStyle: { width: 2, color: '#D4A040' } }
                    ]
                }, true);
            }

            function applyGlobalAssign() {
                // 改走编排器：必须过风控与 Guardrail 才允许落地
                orchestrate();
            }

            function clearAssignments() {
                assignments = {};
                persistOrders(); renderOrders(); renderMatches(); renderGlobalAssign();
                toast('↺ 已清空所有指派', 'info');
            }
