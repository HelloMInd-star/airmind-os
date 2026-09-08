/*!
 * AirMind V2.2 — 05-kelly
 * Tab2 凯利引擎：赔率胜率 → f* → 气象溢价
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 14. Tab 2 凯利公式交互引擎 (⭐ 新增)
            // ============================================================
            function updateKelly() {
                var b = parseFloat(document.getElementById('bSlider').value);
                var p = parseFloat(document.getElementById('pSlider').value);
                var q = 1 - p;

                // 计算 f*
                var bp = b * p;
                var fStar = (bp - q) / b;
                fStar = Math.max(-1, Math.min(1, fStar)); // 限定范围 -1 ~ 1

                // 更新显示
                document.getElementById('bDisplay').textContent = b.toFixed(2);
                document.getElementById('pDisplay').textContent = p.toFixed(2);
                document.getElementById('qDisplay').textContent = q.toFixed(2);

                document.getElementById('fB').textContent = b.toFixed(2);
                document.getElementById('fP').textContent = p.toFixed(2);
                document.getElementById('fQ').textContent = q.toFixed(2);
                document.getElementById('fBDiv').textContent = b.toFixed(2);
                document.getElementById('fResult').textContent = fStar.toFixed(3);

                document.getElementById('kpiFStar').textContent = fStar.toFixed(3);

                // 人机配比映射: f* 越高，人工占比越低（自动化程度越高）
                // 映射: f* = -1 ~ 1 → 人工占比 60% ~ 10%
                var humanRatio = 35 - fStar * 25;
                humanRatio = Math.max(10, Math.min(60, humanRatio));
                var humanRatioDisplay = Math.round(humanRatio);
                document.getElementById('kpiHumanRatio').textContent = humanRatioDisplay + '%';
                document.getElementById('humanRatioBar').style.width = humanRatioDisplay + '%';
                document.getElementById('humanRatioLabel').textContent = humanRatioDisplay + '%';

                // 三方协调度: 与 f* 正相关 (0.2 ~ 0.8)
                var coordination = 0.40 + fStar * 0.40;
                coordination = Math.max(0.15, Math.min(0.85, coordination));
                document.getElementById('kpiCoordination').textContent = coordination.toFixed(2);

                // 供需均衡点: 与 f* 正相关 (0.2 ~ 0.7)
                var supplyDemand = 0.35 + fStar * 0.35;
                supplyDemand = Math.max(0.15, Math.min(0.75, supplyDemand));
                document.getElementById('kpiSupplyDemand').textContent = supplyDemand.toFixed(2);

                // 凯利结论
                var conclusion = document.getElementById('kellyConclusion');
                if (fStar > 0.15) {
                    conclusion.textContent = '💡 当前配置有利可图，建议投入 ' + (fStar * 100).toFixed(1) + '% 仓位，长期增长率最优。';
                    conclusion.style.borderLeftColor = 'var(--ym-cyan)';
                } else if (fStar > -0.05) {
                    conclusion.textContent = '💡 当前配置处于临界状态，建议观望或微调胜率/赔率参数。';
                    conclusion.style.borderLeftColor = 'var(--ym-gold)';
                } else {
                    conclusion.textContent = '💡 当前配置预期亏损，建议降低风险敞口或重新评估策略。';
                    conclusion.style.borderLeftColor = 'var(--ym-danger)';
                }

                // ★ 气象溢价：以「当前情景气象」为主，f* 作为风险偏好微调
                var wm = WEATHER_META[store.scenario.weatherIdx] || WEATHER_META[0];
                var weatherPremium = (wm.mult - 1) * 100 + (1 - fStar) * 4;
                weatherPremium = clamp(weatherPremium, 0, 45);
                document.getElementById('weatherPremium').textContent = '+' + Math.round(weatherPremium) + '%';
                document.getElementById('weatherMultiplier').textContent = (1 + weatherPremium / 100).toFixed(2) + 'x';
                document.getElementById('weatherSlot').textContent = wm.name;

                // ★ 时段：由情景需求倍率决定，不再由 f* 反推（避免"胜率高=高峰"的逻辑倒置）
                var demand = store.scenario.demand;
                var slot = demand > 1.40 ? '高峰' : (demand < 0.80 ? '低谷' : '平峰');
                document.getElementById('timeSlot').textContent = slot;

                // ★ 综合定价系数：f* 与拥堵度共同决定
                var composite = clamp(0.30 + fStar * 0.20 + (store.scenario.congestion - 0.45) * 0.35, 0.15, 0.95);
                document.getElementById('compositePrice').textContent = composite.toFixed(2);

                // ============ 回写全局情景 → 广播给 Tab1 / Tab3 / Tab6 ============
                var s = store.scenario;
                s.fStar = fStar;
                s.humanRatio = humanRatioDisplay;
                s.weatherMult = 1 + weatherPremium / 100;
                s.slot = slot;
                s.composite = composite;
                bus.emit('scenario:update', s);
            }
