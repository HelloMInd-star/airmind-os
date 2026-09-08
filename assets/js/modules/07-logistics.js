/*!
 * AirMind V2.2 — 07-logistics
 * Tab3 渲染 + 风控 Agent + Guardrail + 编排层
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 16.5 Tab3 渲染：工单池 + 实算匹配 + 机队状态
            // ============================================================
            function esc(str) {
                return String(str).replace(/[&<>"']/g, function(c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
                });
            }

            var PRIO_COLOR = { '紧急': 'var(--ym-danger)', '高优先级': 'var(--ym-gold)', '标准': 'var(--ym-blue)', '普通': 'var(--ym-cyan)' };
            var selectedOrderId = null;

            function renderOrders() {
                var host = document.getElementById('orderList');
                if (!host) return;
                if (orders.length === 0) {
                    host.innerHTML = '<div style="text-align:center;padding:20px;color:var(--ym-text-dim);font-size:12px;">工单池为空，请在下方新增</div>';
                } else {
                    host.innerHTML = orders.map(function(o) {
                        var done = assignments[o.id];
                        var sel = o.id === selectedOrderId;
                        var assigned = done ? FLEET.filter(function(f) { return f.id === done; })[0] : null;
                        return '<div class="order-row' + (sel ? ' sel' : '') + '" data-order="' + o.id + '" role="button" tabindex="0" ' +
                            'aria-label="工单 ' + o.id + ' ' + esc(o.name) + '">' +
                            '<div style="flex:1;min-width:0;">' +
                            '<div style="display:flex;align-items:center;gap:6px;">' +
                            '<strong style="color:var(--ym-text-primary);">#' + o.id + '</strong>' +
                            '<span style="color:var(--ym-text-secondary);">' + esc(o.name) + '</span>' +
                            '<span style="margin-left:auto;font-size:11px;color:' + (PRIO_COLOR[o.priority] || 'var(--ym-text-muted)') + ';">' + esc(o.priority) + '</span>' +
                            '</div>' +
                            '<div style="font-size:11px;color:var(--ym-text-muted);margin-top:2px;">' +
                            o.weight + 'kg · ' + o.distance + 'km · ' + o.deadline + 'min' +
                            (assigned ? ' · <span style="color:var(--ym-success);">已派 ' + esc(assigned.name) + '</span>' : '') +
                            '</div></div>' +
                            '<button class="btn btn-sm btn-danger" data-ordel="' + o.id + '" aria-label="删除工单 ' + o.id + '">✕</button>' +
                            '</div>';
                    }).join('');
                }
                var pending = orders.filter(function(o) { return !assignments[o.id]; }).length;
                var badge = document.getElementById('orderCountBadge');
                if (badge) badge.textContent = '待分配 ' + pending;
                var sum = document.getElementById('orderSummary');
                if (sum) {
                    var risky = orders.filter(function(o) { return matchFleet(o).every(function(m) { return !m.feasible; }); }).length;
                    sum.textContent = '📊 共 ' + orders.length + ' 单 · 待分配 ' + pending + ' 单' +
                        (risky > 0 ? ' · ⚠️ 无可用运力 ' + risky + ' 单' : '') +
                        ' · 情景：' + SCENARIOS[store.scenario.key].label.replace(/\s|🟢|🌧️|🔥|🚫/g, '');
                }

                host.querySelectorAll('[data-order]').forEach(function(row) {
                    var pick = function() {
                        selectedOrderId = Number(row.dataset.order);
                        renderOrders(); renderMatches();
                    };
                    row.addEventListener('click', pick);
                    row.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
                });
                host.querySelectorAll('[data-ordel]').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var id = Number(this.dataset.ordel);
                        orders = orders.filter(function(o) { return o.id !== id; });
                        delete assignments[id];
                        if (selectedOrderId === id) selectedOrderId = orders.length ? orders[0].id : null;
                        persistOrders(); recalcLogistics();
                    });
                });
            }

            function renderMatches() {
                var host = document.getElementById('matchList');
                var empty = document.getElementById('matchEmpty');
                if (!host) return;
                var order = orders.filter(function(o) { return o.id === selectedOrderId; })[0];
                if (!order) {
                    host.innerHTML = '';
                    if (empty) empty.style.display = 'block';
                    return;
                }
                if (empty) empty.style.display = 'none';
                var ranked = matchFleet(order);
                var basis = document.getElementById('matchBasis');
                if (basis) basis.textContent = '#' + order.id + ' · 侧风 ' + store.scenario.windBase + 'm/s';

                host.innerHTML = ranked.slice(0, 3).map(function(m, idx) {
                    var isTop = idx === 0 && m.feasible;
                    var border = m.feasible ? (isTop ? '1px solid var(--ym-gold)' : '1px solid var(--ym-border)') : '1px dashed var(--ym-text-dim)';
                    var detail = Object.keys(m.detail).map(function(k) {
                        return '<span style="font-size:10px;color:var(--ym-text-dim);">' + k + ' ' + m.detail[k] + '</span>';
                    }).join(' · ');
                    return '<div style="background:var(--ym-bg-elevated);border-radius:6px;padding:10px 14px;border:' + border + ';' + (m.feasible ? '' : 'opacity:.62;') + '">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                        '<span><strong style="color:var(--ym-text-primary);">' + esc(m.ac.name) + '</strong>' +
                        (assignments[order.id] === m.ac.id ? ' <span class="badge badge-blue">已派</span>' : '') + '</span>' +
                        '<span style="font-weight:600;color:' + (m.feasible ? (isTop ? 'var(--ym-gold-light)' : 'var(--ym-text-muted)') : 'var(--ym-danger)') + ';">' +
                        (m.feasible ? '匹配度 ' + m.score + '%' : '不可行') + '</span></div>' +
                        '<div style="font-size:12px;color:var(--ym-text-muted);margin-top:2px;">' +
                        (m.feasible
                            ? '载重余量 ' + m.margin + 'kg · ETA ' + m.eta.toFixed(0) + 'min · 报价 ¥' + m.cost.toFixed(0) + ' · SOH ' + m.ac.soh + '% 🟢'
                            : '⛔ ' + esc(m.reasons[0] || '不满足约束')) +
                        '</div>' +
                        (m.feasible ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">' + detail + '</div>' : '') +
                        (m.feasible ? '<div style="margin-top:6px;"><button class="btn btn-sm" data-assign="' + m.ac.id + '">指派此机型</button></div>' : '') +
                        '</div>';
                }).join('');

                host.querySelectorAll('[data-assign]').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        assignments[order.id] = this.dataset.assign;
                        persistOrders(); renderOrders(); renderMatches();
                        var ac = FLEET.filter(function(f) { return f.id === this.dataset.assign; }.bind(this))[0];
                        toast('✅ #' + order.id + ' 已指派 ' + (ac ? ac.name : ''), 'success');
                    });
                });
            }

            function renderFleetStatus() {
                var host = document.getElementById('fleetStatus');
                if (!host) return;
                var sc = store.scenario;
                host.innerHTML = FLEET.map(function(ac) {
                    var ok = ac.soh >= 60 && sc.windBase <= ac.windMax;
                    var dot = ok ? '🟢' : (ac.soh >= 60 ? '🟡' : '🔴');
                    var why = [];
                    if (ac.soh < 60) why.push('SOH 低');
                    if (sc.windBase > ac.windMax) why.push('抗风不足');
                    return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 8px;background:var(--ym-bg-inset);border-radius:4px;">' +
                        '<span style="color:var(--ym-text-secondary);">' + dot + ' ' + esc(ac.name) + '</span>' +
                        '<span style="color:var(--ym-text-muted);">×' + ac.unit + ' · ' + ac.payload + 'kg/' + ac.range + 'km · SOH ' + ac.soh + '%' +
                        (why.length ? ' · ' + why.join('/') : '') + '</span></div>';
                }).join('');
            }

            function recalcLogistics() {
                if (selectedOrderId === null && orders.length) selectedOrderId = orders[0].id;
                renderOrders(); renderMatches(); renderFleetStatus(); renderGlobalAssign();
            }

            // 全局最优指派渲染（与贪心同屏对比）
            function renderGlobalAssign() {
                var host = document.getElementById('gaList');
                if (!host) return;
                var r = globalAssign();
                window.__gaResult = r;

                document.getElementById('gaOpt').textContent = r.optimal.total.toFixed(1);
                document.getElementById('gaGreedy').textContent = r.greedy.total.toFixed(1);
                var gainEl = document.getElementById('gaGain');
                gainEl.textContent = (r.improvement > 0 ? '+' : '') + r.improvement + '%';
                gainEl.className = 'value ' + (r.improvement > 0 ? 'success' : '');
                document.getElementById('gaSlots').textContent = r.usableSlots + ' / ' + r.slotCount;

                var note = document.getElementById('gaNote');
                if (r.improvement > 0) {
                    note.textContent = '⚠️ 贪心方案正在损失 ' + r.improvement + '% 的总匹配收益';
                    note.style.color = 'var(--ym-gold-light)';
                } else {
                    note.textContent = '✅ 当前工单无冲突，贪心已是最优解 · 新增高价值工单可制造运力竞争';
                    note.style.color = 'var(--ym-text-muted)';
                }

                if (!orders.length) {
                    host.innerHTML = '<div style="text-align:center;padding:16px;color:var(--ym-text-dim);font-size:12px;">工单池为空</div>';
                    return;
                }

                host.innerHTML = r.optimal.pairs.map(function(p) {
                    var o = p.order;
                    if (!p.slot) {
                        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--ym-bg-inset);border-radius:4px;border-left:3px solid var(--ym-text-dim);font-size:12px;">' +
                            '<span style="color:var(--ym-text-secondary);">#' + o.id + ' ' + esc(o.name) + '</span>' +
                            '<span style="color:var(--ym-danger);">⛔ 无可用运力（低于 35 分阈值或受情景限制）</span></div>';
                    }
                    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--ym-bg-elevated);border-radius:4px;border-left:3px solid var(--ym-gold);font-size:12px;">' +
                        '<span style="color:var(--ym-text-secondary);">#' + o.id + ' ' + esc(o.name) +
                        ' <span style="color:var(--ym-text-dim);">· ' + o.weight + 'kg / ' + o.distance + 'km</span></span>' +
                        '<span><strong style="color:var(--ym-text-primary);">' + esc(p.slot.name) + '</strong>' +
                        ' <span style="color:var(--ym-text-dim);">' + p.slot.slotId + '</span>' +
                        ' <span style="color:var(--ym-gold-light);font-weight:600;">' + p.score + '</span></span></div>';
                }).join('');
            }

            // ============================================================
            // 编排层：指派 → 风控 Agent → Guardrail → 落地
            //
            // 这是"Agent 说的不算"的关键实现：
            //   Agent(evaluateRisk) 给出判断，Guardrail 独立复算物理约束，
            //   最终落地的永远是 Guardrail 净化后的 safePlan。
            // ============================================================

            function buildRiskContext(planResult) {
                var s = store.scenario;
                var fEl = document.getElementById('mcF');
                var bEl = document.getElementById('bSlider');
                var pEl = document.getElementById('pSlider');
                var f = fEl ? parseFloat(fEl.value) : 0;
                var b = bEl ? parseFloat(bEl.value) : 1;
                var p = pEl ? parseFloat(pEl.value) : 0.5;
                var perEl = document.getElementById('mcPeriods');
                var periods = perEl ? (parseInt(perEl.value, 10) || 120) : 120;
                var mc = AirMind.kellyMonteCarlo({ b: b, p: p, f: f, periods: periods, trials: 200, seed: 20240918 });

                return {
                    scenario: s,
                    kelly: { f: f, fStar: AirMind.kellyFraction(b, p), ruinProb: mc.ruinProb, geoGrowth: mc.geoGrowth, periods: periods },
                    plan: planResult ? planResult.optimal : { pairs: [], assignedCount: 0, unassignedCount: 0 }
                };
            }

            /** 渲染风控结论 */
            function renderRisk(ctx) {
                var a = AirMind.evaluateRisk(ctx);
                window.__lastAssessment = a;

                var badge = document.getElementById('riskBadge');
                if (badge) {
                    badge.textContent = a.level === 'BLOCK' ? '🚫 已阻断' : (a.level === 'WARN' ? '⚠️ 有警告' : '✅ 通过');
                    badge.className = 'badge ' + (a.level === 'BLOCK' ? 'badge-danger' : (a.level === 'WARN' ? 'badge-gold' : 'badge-blue'));
                }

                var v = document.getElementById('riskVerdict');
                if (v) {
                    v.textContent = AirMind.explainRisk(a);
                    v.style.borderLeftColor = a.level === 'BLOCK' ? 'var(--ym-danger)' :
                        (a.level === 'WARN' ? 'var(--ym-gold)' : 'var(--ym-success)');
                }

                var bHost = document.getElementById('riskBlocks');
                if (bHost) {
                    bHost.innerHTML = a.blocks.length
                        ? a.blocks.map(function(b) {
                            return '<div style="padding:8px 10px;background:rgba(239,83,80,.08);border-left:3px solid var(--ym-danger);border-radius:4px;">' +
                                '<div style="font-size:12px;color:var(--ym-text-primary);font-weight:600;">🚫 ' + esc(b.name) + '</div>' +
                                '<div style="font-size:11px;color:var(--ym-text-muted);margin-top:2px;">' + esc(b.why) + '</div>' +
                                '<div style="font-size:11px;color:var(--ym-danger);margin-top:3px;">' + esc((b.detail || []).join('；')) + '</div>' +
                                '<div style="font-size:11px;color:var(--ym-cyan);margin-top:3px;">→ ' + esc(b.fix) + '</div></div>';
                        }).join('')
                        : '<div style="font-size:12px;color:var(--ym-text-dim);padding:8px;">无阻断项</div>';
                }

                var wHost = document.getElementById('riskWarns');
                if (wHost) {
                    wHost.innerHTML = a.warns.length
                        ? a.warns.map(function(w) {
                            return '<div style="padding:8px 10px;background:rgba(212,160,64,.07);border-left:3px solid var(--ym-gold);border-radius:4px;">' +
                                '<div style="font-size:12px;color:var(--ym-text-primary);font-weight:600;">⚠️ ' + esc(w.name) + '</div>' +
                                '<div style="font-size:11px;color:var(--ym-text-muted);margin-top:2px;">' + esc((w.detail || []).join('；')) + '</div>' +
                                '<div style="font-size:11px;color:var(--ym-cyan);margin-top:3px;">→ ' + esc(w.fix) + '</div></div>';
                        }).join('')
                        : '<div style="font-size:12px;color:var(--ym-text-dim);padding:8px;">无警告项</div>';
                }
                return a;
            }

            /** 渲染 Guardrail 结果 */
            function renderGuard(planResult, ctx) {
                var g = AirMind.guardrail(planResult ? planResult.optimal : { pairs: [] }, ctx);
                window.__lastGuard = g;
                var host = document.getElementById('guardResult');
                if (!host) return g;
                if (g.passed) {
                    host.innerHTML = '<span style="color:var(--ym-success);">✅ 全部指派通过物理约束复算，未触发强制剔除。</span>';
                } else {
                    host.innerHTML = '<div style="color:var(--ym-danger);margin-bottom:4px;">🚫 强制剔除 ' +
                        g.violations.length + ' 项违规指派：</div>' +
                        g.violations.map(function(v) {
                            return '<div style="padding:4px 8px;background:var(--ym-bg-inset);border-radius:3px;margin-top:3px;font-size:11px;">' +
                                '工单 #' + v.orderId + ' ← ' + esc(v.slotId) + ' ：' + esc(v.reasons.join('，')) + '</div>';
                        }).join('') +
                        '<div style="margin-top:6px;color:var(--ym-cyan);">→ 落地方案已自动降级为安全版本（' +
                        g.safePlan.assignedCount + ' 单可执行）</div>';
                }
                return g;
            }

            /** 决策轨迹：持久化，支撑回放与追责 */
            var TRACE_KEY = 'decision_trace';
            var TRACE_MAX = 50;

            function getTrace() {
                var t = safeStore.get(TRACE_KEY, []);
                return Array.isArray(t) ? t : [];
            }
            function pushTrace(entry) {
                var t = getTrace();
                t.unshift(entry);
                if (t.length > TRACE_MAX) t = t.slice(0, TRACE_MAX);
                safeStore.set(TRACE_KEY, t);
                renderTrace();
            }
            function renderTrace() {
                var t = getTrace();
                var host = document.getElementById('traceList');
                var cnt = document.getElementById('traceCount');
                if (cnt) cnt.textContent = t.length + ' 条';
                if (!host) return;
                if (!t.length) {
                    host.innerHTML = '<div style="text-align:center;padding:16px;color:var(--ym-text-dim);font-size:12px;">暂无决策记录，点击上方「编排执行」开始</div>';
                    return;
                }
                host.innerHTML = t.map(function(e) {
                    var color = e.final === 'BLOCKED' ? 'var(--ym-danger)' : (e.final === 'WARNED' ? 'var(--ym-gold)' : 'var(--ym-success)');
                    return '<div style="padding:8px 10px;background:var(--ym-bg-elevated);border-radius:4px;border-left:3px solid ' + color + ';">' +
                        '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ym-text-dim);">' +
                        '<span>' + esc(e.time) + '</span><span>' + esc(e.scenarioLabel) + '</span></div>' +
                        '<div style="font-size:12px;color:var(--ym-text-secondary);margin-top:3px;">' + esc(e.summary) + '</div>' +
                        '<div style="font-size:11px;color:var(--ym-text-muted);margin-top:2px;">' +
                        '指派 ' + e.assigned + ' 单' +
                        (e.guardBlocked ? ' · <span style="color:var(--ym-danger);">Guardrail 剔除 ' + e.guardBlocked + ' 项</span>' : '') +
                        ' · 风控 ' + e.riskLevel + '</div></div>';
                }).join('');
            }

            /**
             * 编排执行：这是唯一允许"落地"的入口
             */
            function orchestrate(opts) {
                opts = opts || {};
                var planResult = globalAssign();
                var ctx = buildRiskContext(planResult);
                var a = renderRisk(ctx);
                var g = renderGuard(planResult, ctx);

                var summaryEl = document.getElementById('riskSummary');
                var finalState, msg;

                if (!a.passed) {
                    finalState = 'BLOCKED';
                    msg = '🚫 风控阻断：' + a.blocks.map(function(b) { return b.name; }).join('、') + '——方案未落地';
                    if (summaryEl) { summaryEl.textContent = msg; summaryEl.style.color = 'var(--ym-danger)'; }
                    pushTrace({
                        time: new Date().toLocaleString('zh-CN', { hour12: false }),
                        scenarioLabel: SCENARIOS[store.scenario.key].label,
                        summary: msg, assigned: 0, riskLevel: a.level,
                        guardBlocked: g.violations.length, final: finalState
                    });
                    toast('🚫 风控阻断，方案未落地：' + a.blocks[0].name, 'danger');
                    return { ok: false, assessment: a, guard: g };
                }

                // 风控通过 → 落地 Guardrail 净化后的安全方案
                var n = 0;
                g.safePlan.pairs.forEach(function(p) {
                    if (p.slot) { assignments[p.order.id] = p.slot.fleetId; n++; }
                    else delete assignments[p.order.id];
                });
                persistOrders(); renderOrders(); renderMatches(); renderGlobalAssign();

                finalState = g.violations.length ? 'WARNED' : 'OK';
                msg = (g.violations.length
                    ? '⚠️ Guardrail 剔除 ' + g.violations.length + ' 项后落地 ' + n + ' 单'
                    : '✅ 已落地 ' + n + ' 单');
                if (a.warns.length) msg += '（另有 ' + a.warns.length + ' 项警告）';
                if (summaryEl) {
                    summaryEl.textContent = msg;
                    summaryEl.style.color = g.violations.length ? 'var(--ym-gold)' : 'var(--ym-success)';
                }
                pushTrace({
                    time: new Date().toLocaleString('zh-CN', { hour12: false }),
                    scenarioLabel: SCENARIOS[store.scenario.key].label,
                    summary: msg, assigned: n, riskLevel: a.level,
                    guardBlocked: g.violations.length, final: finalState
                });
                toast(msg, g.violations.length ? 'warn' : 'success');
                return { ok: true, assessment: a, guard: g };
            }

            /** 仅审查不落地 */
            function reviewOnly() {
                var planResult = globalAssign();
                var ctx = buildRiskContext(planResult);
                var a = renderRisk(ctx);
                var g = renderGuard(planResult, ctx);
                var summaryEl = document.getElementById('riskSummary');
                if (summaryEl) {
                    summaryEl.textContent = a.passed ? '✅ 审查通过，可执行' : '🚫 存在阻断项，不可执行';
                    summaryEl.style.color = a.passed ? 'var(--ym-success)' : 'var(--ym-danger)';
                }
                toast(a.passed ? '✅ 风控审查通过' : '🚫 风控审查发现 ' + a.blocks.length + ' 项阻断', a.passed ? 'success' : 'danger');
            }

            function clearTrace() {
                if (!getTrace().length) { toast('暂无决策记录', 'info'); return; }
                if (confirm('确定清空全部决策轨迹吗？')) {
                    safeStore.remove(TRACE_KEY);
                    renderTrace();
                    toast('🗑️ 决策轨迹已清空', 'info');
                }
            }

            function exportTrace() {
                var t = getTrace();
                if (!t.length) { toast('暂无决策记录可导出', 'warn'); return; }
                var blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'airmind_decision_trace_' + new Date().toISOString().slice(0, 10) + '.json';
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast('📤 已导出 ' + t.length + ' 条决策记录', 'success');
            }
