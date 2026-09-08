/*!
 * AirMind V2.2 — 01-core
 * 基础设施：安全存储 / 事件总线 / 情景库 / Toast / 图表主题
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // ============================================================
            // 0. 基础设施：安全存储 / 事件总线 / 全局状态
            // ============================================================
            var SCHEMA_VERSION = 3;
            var NS = 'ym_v3_';

            // localStorage 安全封装：配额保护 + 损坏自愈 + 版本迁移
            var safeStore = {
                get: function(key, fallback) {
                    try {
                        var raw = localStorage.getItem(NS + key);
                        if (raw === null) return fallback;
                        var parsed = JSON.parse(raw);
                        if (parsed && typeof parsed === 'object' && '__v' in parsed) {
                            if (parsed.__v !== SCHEMA_VERSION) {
                                // 版本不一致：隔离旧数据而不是丢弃，便于人工恢复
                                localStorage.setItem(NS + key + '_bak_v' + parsed.__v, raw);
                                return fallback;
                            }
                            return parsed.data;
                        }
                        return parsed;
                    } catch (e) {
                        console.warn('[AirMind] 数据损坏已重置:', key, e);
                        try { localStorage.removeItem(NS + key); } catch (e2) {}
                        return fallback;
                    }
                },
                set: function(key, value) {
                    try {
                        localStorage.setItem(NS + key, JSON.stringify({ __v: SCHEMA_VERSION, data: value }));
                        return true;
                    } catch (e) {
                        var quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
                        console.warn('[AirMind] 写入失败:', key, e);
                        if (quota && window.__ymToast) {
                            window.__ymToast('⚠️ 浏览器存储已满，本次改动未能持久化，请导出备份后清理。', 'danger');
                        }
                        return false;
                    }
                },
                remove: function(key) {
                    try { localStorage.removeItem(NS + key); } catch (e) {}
                }
            };

            // 极简事件总线（发布订阅）：让 6 个 Tab 从"各自硬编码"变成"共享一条数据链"
            var bus = (function() {
                var map = {};
                return {
                    on: function(evt, fn) {
                        (map[evt] = map[evt] || []).push(fn);
                        return function() { bus.off(evt, fn); };
                    },
                    off: function(evt, fn) {
                        if (!map[evt]) return;
                        map[evt] = map[evt].filter(function(f) { return f !== fn; });
                    },
                    emit: function(evt, payload) {
                        (map[evt] || []).forEach(function(fn) {
                            try { fn(payload); } catch (e) { console.error('[AirMind] 监听器异常:', evt, e); }
                        });
                    }
                };
            })();

            // 情景库：README 里那场"暴雨调度"现在是可复现的按钮
            var SCENARIOS = {
                normal:   { label: '🟢 常态巡航', weather: 'clear',  weatherIdx: 0, demand: 1.00, congestion: 0.45, windBase: 2,  p: 0.62, b: 1.60, note: '空域通畅，运力与需求基本平衡。' },
                storm:    { label: '🌧️ 暴雨突至', weather: 'storm',  weatherIdx: 3, demand: 1.55, congestion: 0.85, windBase: 15, p: 0.40, b: 1.30, note: '30 架次延误，起降点拥堵 85%，气象溢价拉满。' },
                peak:     { label: '🔥 大促高峰', weather: 'cloudy', weatherIdx: 1, demand: 1.90, congestion: 0.72, windBase: 5,  p: 0.58, b: 2.10, note: '订单量激增 90%，高频短途占比上升，注意避免亏本接单。' },
                lockdown: { label: '🚫 空域管制', weather: 'rain',   weatherIdx: 2, demand: 0.55, congestion: 0.25, windBase: 8,  p: 0.30, b: 1.05, note: '大面积禁飞，可用运力骤降，凯利公式建议收缩敞口。' }
            };
            var WEATHER_META = [
                { key: 'clear',  name: '晴',   mult: 1.00 },
                { key: 'cloudy', name: '多云', mult: 1.06 },
                { key: 'rain',   name: '小雨', mult: 1.15 },
                { key: 'storm',  name: '雷暴', mult: 1.30 }
            ];

            const store = {
                availability: 99.7,
                tasks: 1284,
                latency: 3.2,
                nodes: 847,
                nodesTotal: 1000,
                assets: 12.4,
                equilibrium: 0.48,
                radarRisk: 0.58,
                radarCredit: 0.42,
                radarYield: 0.30,
                radarLiquidity: 0.45,
                radarCompliance: 0.52,
                cpu: 72,
                mem: 58,
                net: 89,
                ingest: 2.4,
                decision: 98,
                // ↓↓↓ 新增：全局共享情景（Tab2 / Tab1 / Tab3 / Tab6 共同读写）
                scenario: {
                    key: 'normal',
                    weatherIdx: 0,
                    demand: 1.00,
                    congestion: 0.45,
                    windBase: 2,
                    fStar: 0.24,
                    humanRatio: 29,
                    weatherMult: 1.00,
                    slot: '平峰',
                    composite: 0.30
                }
            };

            // 情景写入 → 广播，所有订阅面板同步刷新
            function targetEquilibrium() {
                var s = store.scenario;
                return clamp(0.28 + s.congestion * 0.30 + (s.demand - 1) * 0.18, 0.30, 0.90);
            }

            function setScenario(key, opts) {
                var sc = SCENARIOS[key];
                if (!sc) return;
                opts = opts || {};
                var s = store.scenario;
                s.key = key;
                s.weatherIdx = sc.weatherIdx;
                s.demand = sc.demand;
                s.congestion = sc.congestion;
                s.windBase = sc.windBase;
                if (!opts.keepSliders) {
                    var pb = document.getElementById('bSlider');
                    var pp = document.getElementById('pSlider');
                    if (pb) pb.value = sc.b;
                    if (pp) pp.value = sc.p;
                }
                bus.emit('scenario:change', s);
                updateKelly();          // 用新 b/p 重算凯利，再由它回写溢价
                renderScenarioBar();
                recalcLogistics();
                renderMonteCarlo();
                store.equilibrium = lerp(store.equilibrium, targetEquilibrium(), 0.9);  // 立即响应，再交给定时器收敛
                for (var n = 0; n < 12; n++) simulateDashboardData();   // 快进收敛，让 KPI 当帧就反映新情景
                renderDashboard();
                if (window.__ymToast) window.__ymToast(sc.label + ' 已注入 · ' + sc.note, key === 'normal' ? 'success' : (key === 'lockdown' ? 'danger' : 'warn'));
            }

            // 情景条渲染（Tab1 顶部的注入按钮）
            function renderScenarioBar() {
                var bar = document.getElementById('scenarioBar');
                if (!bar) return;
                bar.querySelectorAll('[data-scenario]').forEach(function(btn) {
                    var on = btn.dataset.scenario === store.scenario.key;
                    btn.style.background = on ? 'var(--ym-blue)' : 'var(--ym-bg-elevated)';
                    btn.style.color = on ? '#fff' : 'var(--ym-text-muted)';
                    btn.style.border = on ? 'none' : '1px solid var(--ym-border)';
                    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                var desc = document.getElementById('scenarioDesc');
                if (desc) desc.textContent = SCENARIOS[store.scenario.key].note;
            }


            // ============================================================
            // 1.5 通用工具：Toast / 图表主题 / 数值辅助
            // ============================================================
            function toast(msg, type) {
                var box = document.getElementById('toastHost');
                if (!box) { console.log('[AirMind]', msg); return; }
                var el = document.createElement('div');
                el.className = 'ym-toast ' + (type || 'info');
                el.setAttribute('role', 'status');
                el.textContent = msg;
                box.appendChild(el);
                setTimeout(function() {
                    el.classList.add('out');
                    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
                }, 4200);
            }
            window.__ymToast = toast;

            var clamp = AirMind.clamp;
            var lerp = AirMind.lerp;

            // 图表跟随昼夜主题：不再硬编码 'dark'
            function currentChartTheme() {
                return (document.documentElement.getAttribute('data-theme') === 'day') ? 'dark' : 'ym-warm';
            }
            function chartBase() {
                var day = document.documentElement.getAttribute('data-theme') !== 'night';
                return { text: day ? '#B8BFC9' : '#9A8B7A', line: day ? '#2A3A5A' : '#4A3F33', split: day ? 'rgba(255,255,255,0.04)' : 'rgba(255,248,240,0.05)', ink: day ? '#EDEAE3' : '#F0EAE0' };
            }
            function rebuildCharts() {
                initRadarChart();
                initEmergencyChart();
                initMcChart(); renderMonteCarlo();
                if (window.pidChartInstance) { initPidChart(); runPidSim(); }
            }
