/*!
 * AirMind V2.2 — 10-init
 * 子Tab切换 / 紧急停机 / 应用初始化
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 17. 子Tab切换 (物流)
            // ============================================================
            var subBtns = document.querySelectorAll('[data-subtab]');
            subBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var targetId = this.dataset.subtab;
                    document.querySelectorAll('.ym-sub-content').forEach(function(c) { c.style.display = 'none'; });
                    var target = document.getElementById(targetId);
                    if (target) target.style.display = 'block';
                    subBtns.forEach(function(b) {
                        b.style.background = 'var(--ym-bg-elevated)';
                        b.style.color = 'var(--ym-text-muted)';
                        b.style.border = '1px solid var(--ym-border)';
                    });
                    this.style.background = 'var(--ym-blue)';
                    this.style.color = '#fff';
                    this.style.border = 'none';
                });
            });
            var defaultSub = document.querySelector('[data-subtab="logistics-sub1"]');
            if (defaultSub) defaultSub.click();

            // ============================================================
            // 18. 紧急停机
            // ============================================================
            document.getElementById('emergencyBtn').addEventListener('click', function() {
                if (confirm('⚠️ 确认执行紧急停机？所有在途飞行将立即中止！')) {
                    var tag = document.getElementById('statusTag');
                    tag.className = 'status-tag danger';
                    document.getElementById('statusLabel').textContent = 'EMERGENCY STOP';
                    this.textContent = '⏳ 执行中...';
                    this.disabled = true;
                    setTimeout(function() {
                        alert('✅ 紧急停机已执行，所有无人机已进入安全悬停状态。');
                        tag.className = 'status-tag';
                        document.getElementById('statusLabel').textContent = 'SYSTEM STABLE';
                        document.getElementById('emergencyBtn').textContent = '🛑 紧急停机';
                        document.getElementById('emergencyBtn').disabled = false;
                    }, 2000);
                }
            });

            // ============================================================
            // 19. 初始化
            // ============================================================
            function init() {
                // 主题
                applyTheme(getPreferredTheme());
                document.getElementById('themeToggle').addEventListener('click', toggleTheme);
                document.getElementById('themeToggleSettings').addEventListener('click', toggleTheme);

                // Tab 切换
                tabBtns.forEach(function(btn) {
                    btn.addEventListener('click', function() { switchTab(this.dataset.tab); });
                });

                // 配置中心手风琴
                document.querySelectorAll('[data-cfg]').forEach(function(el) {
                    el.addEventListener('click', function() {
                        var d = document.getElementById(el.getAttribute('data-cfg'));
                        if (!d) return;
                        var open = d.style.display !== 'none';
                        d.style.display = open ? 'none' : 'block';
                        var arrow = el.querySelector('.cfg-arrow');
                        if (arrow) arrow.textContent = open ? '▾' : '▴';
                    });
                });

                // --- 应急调度 ---
                document.querySelectorAll('#tab5 input, #tab5 select').forEach(function(el) {
                    el.addEventListener('input', renderStrategies);
                    el.addEventListener('change', renderStrategies);
                });
                document.getElementById('saveBtn').addEventListener('click', handleSaveEmergency);
                document.getElementById('clearBtn').addEventListener('click', handleClearEmergency);
                document.getElementById('exportPdfBtn').addEventListener('click', exportEmergencyPDF);
                document.getElementById('exportJsonBtn').addEventListener('click', exportEmergencyJSON);
                document.getElementById('printBtn').addEventListener('click', printEmergencyPage);

                // --- Tab 2 凯利交互 ---
                // 首屏套用默认情景的赔率/胜率：HTML 里的滑条值只是占位，
                // 否则 f* 会停在 0，一进来就显示"不值得投入"，与产品定位矛盾
                var initSc = SCENARIOS[store.scenario.key] || SCENARIOS.normal;
                document.getElementById('bSlider').value = initSc.b;
                document.getElementById('pSlider').value = initSc.p;

                document.getElementById('bSlider').addEventListener('input', function() { updateKelly(); recalcLogistics(); renderMonteCarlo(); });
                document.getElementById('pSlider').addEventListener('input', function() { updateKelly(); recalcLogistics(); renderMonteCarlo(); });

                // 初始化凯利计算（会回写全局情景）
                updateKelly();

                // --- Tab 1 情景注入 ---
                var bar = document.getElementById('scenarioBar');
                if (bar) {
                    bar.querySelectorAll('[data-scenario]').forEach(function(btn) {
                        btn.addEventListener('click', function() { setScenario(this.dataset.scenario); });
                    });
                }
                renderScenarioBar();

                // --- Tab 3 工单 ---
                recalcLogistics();
                // --- Tab 2 蒙特卡洛 ---
                // 不在此处 init：Tab2 此时是隐藏的，ECharts 会拿到 0 宽度容器，
                // 导致图表一直缩在角落。改为首次切到 Tab2 时再 init（见 06-shell）。
                var mcInitF = clamp(AirMind.kellyFraction(initSc.b, initSc.p), 0, 1.5);
                document.getElementById('mcF').value = mcInitF;
                var mcF = document.getElementById('mcF');
                if (mcF) mcF.addEventListener('input', renderMonteCarlo);
                var mcP = document.getElementById('mcPeriods');
                if (mcP) mcP.addEventListener('change', renderMonteCarlo);
                var mcAlign = document.getElementById('mcAlign');
                if (mcAlign) mcAlign.addEventListener('click', function() {
                    var b = parseFloat(document.getElementById('bSlider').value);
                    var p = parseFloat(document.getElementById('pSlider').value);
                    var fs = AirMind.kellyFraction(b, p);
                    document.getElementById('mcF').value = Math.max(0, Math.min(1.5, fs));
                    renderMonteCarlo();
                    toast('🎯 仓位已对齐凯利建议值 f* = ' + fs.toFixed(3), 'success');
                });
                renderMonteCarlo();

                // --- 压力测试 ---
                var stRun = document.getElementById('stressRun');
                if (stRun) stRun.addEventListener('click', runStress);
                var stReset = document.getElementById('stressReset');
                if (stReset) stReset.addEventListener('click', resetStress);

                // --- 风控 / 编排 ---
                var riskRun = document.getElementById('riskRun');
                if (riskRun) riskRun.addEventListener('click', reviewOnly);
                var riskDispatch = document.getElementById('riskDispatch');
                if (riskDispatch) riskDispatch.addEventListener('click', function() { orchestrate(); });
                var traceClear = document.getElementById('traceClear');
                if (traceClear) traceClear.addEventListener('click', clearTrace);
                var traceExport = document.getElementById('traceExport');
                if (traceExport) traceExport.addEventListener('click', exportTrace);
                renderTrace();

                var gaApply = document.getElementById('gaApply');
                if (gaApply) gaApply.addEventListener('click', applyGlobalAssign);
                var gaClear = document.getElementById('gaClear');
                if (gaClear) gaClear.addEventListener('click', clearAssignments);

                var addBtn = document.getElementById('addOrderBtn');
                if (addBtn) {
                    addBtn.addEventListener('click', function() {
                        var name = (document.getElementById('ordName').value || '').trim() || '未命名工单';
                        var w = parseFloat(document.getElementById('ordWeight').value) || 1;
                        var d = parseFloat(document.getElementById('ordDist').value) || 1;
                        var t = parseFloat(document.getElementById('ordTime').value) || 30;
                        var pr = document.getElementById('ordPrio').value;
                        if (w > 40 || d > 300) { toast('⚠️ 超出机队能力范围（≤40kg / ≤300km）', 'warn'); return; }
                        var nid = orders.reduce(function(m, o) { return Math.max(m, o.id); }, 1000) + 1;
                        orders.push({ id: nid, name: name, weight: w, distance: d, deadline: t, priority: pr });
                        if (selectedOrderId === null) selectedOrderId = nid;
                        persistOrders(); recalcLogistics();
                        toast('➕ 工单 #' + nid + ' 已加入，匹配结果已重算', 'success');
                    });
                }

                // --- Tab 4 PID 仿真 ---
                initPidChart();
                ['pidCraft', 'pidKp', 'pidKi', 'pidKd', 'pidWind'].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.addEventListener('input', runPidSim);
                });
                var pReset = document.getElementById('pidReset');
                if (pReset) pReset.addEventListener('click', function() {
                    document.getElementById('pidCraft').value = '多点锁平开窗';
                    document.getElementById('pidKp').value = 0.120;
                    document.getElementById('pidKi').value = 0.080;
                    document.getElementById('pidKd').value = 0.050;
                    runPidSim();
                    toast('↺ 已恢复推荐参数（P=0.120 I=0.080 D=0.050）', 'info');
                });
                var pStorm = document.getElementById('pidStorm');
                if (pStorm) pStorm.addEventListener('click', function() {
                    var w = store.scenario.windBase;
                    document.getElementById('pidWind').value = Math.min(25, w);
                    document.getElementById('pidCraft').value = SCENARIOS[store.scenario.key].weatherIdx >= 2 ? '多点锁平开窗' : document.getElementById('pidCraft').value;
                    runPidSim();
                    toast('🌧️ 已拉取当前情景风速 ' + w + ' m/s 进行抗扰验证', 'warn');
                });
                runPidSim();

                // --- Tab 1 快捷入口：情景变化时同步刷新运力 ---
                bus.on('scenario:change', function() { recalcLogistics(); });

                // --- 深链恢复 ---
                restoreTabFromHash();
                window.addEventListener('hashchange', restoreTabFromHash);

                // --- CDN 兜底提示 ---
                window.addEventListener('load', function() {
                    if (window.__ymCdnFailed || typeof echarts === 'undefined') {
                        toast('⚠️ CDN 资源加载失败，已进入离线降级模式：图表停用，计算与导出 JSON 仍可用。', 'danger');
                    }
                });

                // --- 图表 ---
                initRadarChart();
                initEmergencyChart();

                // --- 首次渲染 ---
                renderStrategies();
                renderEmergencyHistory();
                updateEmergencyChart();
                renderDashboard();

                // 总控数据定时更新
                setInterval(function() {
                    simulateDashboardData();
                    renderDashboard();
                }, 3000);

                console.log('🛩️ Y.Mine · AirMind V2.1 已启动 · 单文件 SPA · 纯本地运行');
                console.log('📦 纯本地处理 · 数据仅存浏览器');
                console.log('📧 hellomind-y@outlook.com');
                console.log('⚖️ 凯利公式交互引擎已启用 · 情景已注入: ' + SCENARIOS[store.scenario.key].label);
                console.log('📋 应急记录数:', getEmergencyRecords().length);
                window.__ymReady = true;
            }

            if (document.readyState === 'complete') {
                init();
            } else {
                document.addEventListener('DOMContentLoaded', init);
            }
