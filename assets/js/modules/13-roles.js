/*!
 * AirMind V2.3 — 多角色视角
 *
 * 低空经济是多方博弈：空管管安全、运营商管效率、厂商管资产、监管管合规。
 * 他们看同一批数据，但关心的指标几乎不重叠。
 *
 * 这里刻意不做成 RBAC 权限系统（那是后端工程，对 PM 岗零加分），
 * 而是做"视角切换"——展示"同一数据对不同角色意味着什么"。
 * 所有指标由 algorithms.js 真实计算，没有写死的数字。
 */
'use strict';

var currentRole = 'atc';

/**
 * 汇总当前全局状态，喂给算法层计算角色指标
 * 各模块的数据通过全局作用域读取（本项目刻意不用 ES Module）
 */
function collectRoleContext() {
    var aircraft = [], zones = [], fleet = [], assign = {}, trace = [];

    // 在空态势与禁飞区（地图模块）
    try {
        if (window.AirMindAirspace) {
            aircraft = window.AirMindAirspace.getAircraft() || [];
            zones = window.AirMindAirspace.getZones() || [];
        }
    } catch (e) { }

    // 机型台账
    try { if (typeof FLEET !== 'undefined') fleet = FLEET; } catch (e) { }

    // 指派结果：Tab3 每次求解后写入 window.__lastAssign。
    // autoAssign 返回的是 {optimal:{...}, greedy:{...}, slotCount, improvement}，
    // 这里展平成算法层期望的扁平结构。
    try {
        var raw = window.__lastAssign;
        if (raw && raw.optimal) {
            assign = {
                pairs: raw.optimal.pairs || [],
                assignedCount: raw.optimal.assignedCount || 0,
                unassignedCount: raw.optimal.unassignedCount || 0,
                total: raw.optimal.total || 0,
                greedyTotal: raw.greedy ? raw.greedy.total : 0,
                improvement: raw.improvement || 0,
                slotCount: raw.slotCount || 0
            };
        }
    } catch (e) { }

    // 决策轨迹（风控审计留痕）
    try { if (typeof getTrace === 'function') trace = getTrace() || []; } catch (e) { }

    return { aircraft: aircraft, zones: zones, fleet: fleet, assign: assign, trace: trace };
}

/** 渲染角色切换按钮 */
function renderRoleBar() {
    var host = document.getElementById('roleBar');
    if (!host) return;
    host.innerHTML = AirMind.ROLES.map(function(r) {
        var on = r.id === currentRole;
        return '<button class="btn btn-sm" data-role="' + r.id + '" aria-pressed="' + on + '"' +
            ' style="' + (on ? 'border-color:var(--ym-purple);background:rgba(167,139,250,.15);' : 'opacity:.72;') + '">' +
            r.icon + ' ' + r.name + '</button>';
    }).join('');

    Array.prototype.forEach.call(host.querySelectorAll('[data-role]'), function(btn) {
        btn.addEventListener('click', function() {
            currentRole = btn.getAttribute('data-role');
            renderRoleBar();
            renderRoleView();
        });
    });
}

/** 渲染当前角色的 KPI 与洞察 */
function renderRoleView() {
    var ctx = collectRoleContext();
    var m = AirMind.computeRoleMetrics(currentRole, ctx);

    var q = document.getElementById('roleQuestion');
    if (q) q.innerHTML = '<strong style="color:var(--ym-text-primary);">' + m.role.icon + ' ' +
        esc(m.role.name) + '</strong> 关心的是：' + esc(m.role.question);

    var kHost = document.getElementById('roleKpis');
    if (kHost) {
        kHost.innerHTML = m.kpis.map(function(k) {
            return '<div class="ym-kpi">' +
                '<div class="value ' + (k.tone || '') + '" style="font-size:17px;">' +
                esc(String(k.value)) + '<span style="font-size:11px;color:var(--ym-text-muted);margin-left:2px;">' +
                esc(k.unit) + '</span></div>' +
                '<div class="label">' + esc(k.label) + '</div></div>';
        }).join('');
    }

    var iHost = document.getElementById('roleInsight');
    if (iHost) iHost.textContent = m.insight;

    // 联动地图高亮：不同角色看地图的侧重点不同
    if (window.AirMindAirspace && window.AirMindAirspace.setEmphasis) {
        window.AirMindAirspace.setEmphasis(m.emphasis);
    }
}

/** 供其他模块在数据变化时调用（如指派完成后刷新运营商视角） */
function refreshRoleView() {
    if (currentRole === 'operator' || currentRole === 'regulator') renderRoleView();
}

function initRoles() {
    renderRoleBar();
    renderRoleView();
}
