/*!
 * AirMind V2.2 — 06-shell
 * 主题切换 + Tab 切换（含图表 resize 调度）
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 15. 主题切换
            // ============================================================
            var THEME_KEY = 'ym-theme';

            function getPreferredTheme() {
                var stored = localStorage.getItem(THEME_KEY);
                if (stored) return stored;
                var hour = new Date().getHours();
                return (hour < 6 || hour >= 20) ? 'night' : 'day';
            }

            function applyTheme(theme) {
                document.documentElement.setAttribute('data-theme', theme);
                localStorage.setItem(THEME_KEY, theme);
                var btn = document.getElementById('themeToggle');
                var settingsBtn = document.getElementById('themeToggleSettings');
                var icon = theme === 'night' ? '☀️' : '🌙';
                if (btn) btn.textContent = icon;
                if (settingsBtn) settingsBtn.textContent = theme === 'night' ? '☀️ 切换日间模式' : '🌙 切换夜间模式';
                var meta = document.querySelector('meta[name="theme-color"]');
                if (meta) meta.setAttribute('content', theme === 'night' ? '#14100C' : '#0A0E17');
                // 图表跟着主题走（ECharts 的 dark 主题在暖色系下会打架）
                if (window.__ymReady) {
                    clearTimeout(window.__ymThemeTimer);
                    window.__ymThemeTimer = setTimeout(rebuildCharts, 60);
                }
            }

            function toggleTheme() {
                var current = document.documentElement.getAttribute('data-theme') || 'day';
                applyTheme(current === 'night' ? 'day' : 'night');
            }

            // ============================================================
            // 16. Tab 切换
            // ============================================================
            var tabBtns = document.querySelectorAll('.ym-nav .tab-btn');
            var tabContents = document.querySelectorAll('.ym-tab-content');

            function switchTab(tabId, skipHash) {
                tabContents.forEach(function(c) { c.classList.remove('active'); });
                var target = document.getElementById(tabId);
                if (target) target.classList.add('active');
                tabBtns.forEach(function(b) {
                    b.classList.remove('active');
                    var on = b.dataset.tab === tabId;
                    if (on) b.classList.add('active');
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                if (!skipHash && history.replaceState) {
                    history.replaceState(null, '', '#' + tabId);
                }
                setTimeout(function() {
                    if (tabId === 'tab1' && window.radarChartInstance) window.radarChartInstance.resize();
                    if (tabId === 'tab5' && emergencyChartInstance) emergencyChartInstance.resize();
                    // Tab2：ECharts 在隐藏容器上 init 会拿到 0 宽度，
                    // 必须切过来时 resize 并重新渲染，否则图表会一直缩在角落
                    if (tabId === 'tab2') {
                        if (!window.mcChartInstance) initMcChart();
                        else window.mcChartInstance.resize();
                        renderMonteCarlo();
                    }
                    if (tabId === 'tab4') {
                        if (!window.pidChartInstance) initPidChart();
                        else window.pidChartInstance.resize();
                        runPidSim();
                    }
                    if (tabId === 'tab3') recalcLogistics();
                }, 150);
            }

            // 从 URL hash 恢复所在面板（支持 #tab2 这类深链分享）
            function restoreTabFromHash() {
                var h = (location.hash || '').replace('#', '');
                if (/^tab[1-6]$/.test(h)) switchTab(h, true);
            }
