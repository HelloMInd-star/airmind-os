/**
 * 风控 Agent 与 Guardrail 单元测试
 * 运行： node --test tests/
 *
 * 这里最关键的不是"规则能触发"，而是：
 *   Guardrail 必须能在 Agent 失效或漏判时独立拦住问题。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/js/core/algorithms.js');

const slot = (over) => Object.assign({
    fleetId: 'F1', slotId: 'F1#01', name: '测试机',
    payload: 10, range: 100, speed: 60, soh: 90, windMax: 12, baseCost: 1
}, over || {});
const order = (over) => Object.assign({ id: 1, name: '货', weight: 5, distance: 20, deadline: 120 }, over || {});
const pair = (o, s, score) => ({ order: o, slot: s, score: score === undefined ? 80 : score });

const calm = { windBase: 2, congestion: 0.45, demand: 1, equilibrium: 0.45 };
const plan = (pairs, unassigned) => ({
    pairs: pairs || [],
    assignedCount: (pairs || []).filter(p => p.slot).length,
    unassignedCount: unassigned === undefined ? (pairs || []).filter(p => !p.slot).length : unassigned
});

// ================================================================
// 1. 正常路径
// ================================================================
test('健康方案：全部规则通过', () => {
    const r = A.evaluateRisk({
        scenario: calm,
        kelly: { f: 0.38, fStar: 0.38, ruinProb: 0.04, geoGrowth: 0.11 },
        plan: plan([pair(order(), slot())])
    });
    assert.equal(r.level, 'PASS');
    assert.equal(r.blocks.length, 0);
    assert.equal(r.passed, true);
});

test('空方案不崩溃', () => {
    const r = A.evaluateRisk({ scenario: calm, kelly: null, plan: plan([]) });
    assert.equal(r.level, 'PASS');
    const g = A.guardrail(plan([]), { scenario: calm });
    assert.equal(g.passed, true);
    assert.equal(g.safePlan.assignedCount, 0);
});

test('完全缺 ctx 也不抛异常', () => {
    assert.doesNotThrow(() => A.evaluateRisk());
    assert.doesNotThrow(() => A.evaluateRisk({}));
    assert.doesNotThrow(() => A.guardrail(null, null));
    assert.doesNotThrow(() => A.guardrail({ pairs: [] }, {}));
});

// ================================================================
// 2. BLOCK 规则逐条验证
// ================================================================
test('SOH 低于 60% → BLOCK', () => {
    const r = A.evaluateRisk({
        scenario: calm, kelly: null,
        plan: plan([pair(order(), slot({ soh: 55 }))])
    });
    assert.equal(r.level, 'BLOCK');
    assert.ok(r.blocks.some(b => b.id === 'SOH_FLOOR'));
    assert.ok(r.blocks[0].detail.join('').includes('55'));
});

test('侧风超抗风上限 → BLOCK', () => {
    const r = A.evaluateRisk({
        scenario: { ...calm, windBase: 15 }, kelly: null,
        plan: plan([pair(order(), slot({ windMax: 12 }))])
    });
    assert.ok(r.blocks.some(b => b.id === 'WIND_LIMIT'));
});

test('超载 → BLOCK', () => {
    const r = A.evaluateRisk({
        scenario: calm, kelly: null,
        plan: plan([pair(order({ weight: 20 }), slot({ payload: 10 }))])
    });
    assert.ok(r.blocks.some(b => b.id === 'PAYLOAD_LIMIT'));
});

test('ETA 超时限 → BLOCK', () => {
    const r = A.evaluateRisk({
        scenario: calm, kelly: null,
        plan: plan([pair(order({ distance: 100, deadline: 30 }), slot({ speed: 60 }))])
    });
    assert.ok(r.blocks.some(b => b.id === 'ETA_DEADLINE'));
});

test('★ 负期望重仓 → BLOCK（凯利 f*≤0 却仍持仓）', () => {
    const r = A.evaluateRisk({
        scenario: calm,
        kelly: { f: 0.38, fStar: -0.06, ruinProb: 1.0, geoGrowth: -0.02 },
        plan: plan([pair(order(), slot())])
    });
    assert.ok(r.blocks.some(b => b.id === 'NEGATIVE_EDGE'));
    // 空仓则不应触发
    const r2 = A.evaluateRisk({
        scenario: calm,
        kelly: { f: 0, fStar: -0.06, ruinProb: 0, geoGrowth: 0 },
        plan: plan([pair(order(), slot())])
    });
    assert.ok(!r2.blocks.some(b => b.id === 'NEGATIVE_EDGE'), '空仓不应触发负期望规则');
});

test('破产概率 >30% → BLOCK', () => {
    const r = A.evaluateRisk({
        scenario: calm,
        kelly: { f: 0.8, fStar: 0.38, ruinProb: 0.97, geoGrowth: -0.01 },
        plan: plan([pair(order(), slot())])
    });
    assert.ok(r.blocks.some(b => b.id === 'RUIN_RISK'));
});

test('均衡度 ≥0.80 → 熔断 BLOCK', () => {
    const r = A.evaluateRisk({
        scenario: { ...calm, equilibrium: 0.85 }, kelly: null,
        plan: plan([pair(order(), slot())])
    });
    assert.ok(r.blocks.some(b => b.id === 'CIRCUIT_BREAKER'));
    // 0.79 不应触发
    const r2 = A.evaluateRisk({
        scenario: { ...calm, equilibrium: 0.79 }, kelly: null,
        plan: plan([pair(order(), slot())])
    });
    assert.ok(!r2.blocks.some(b => b.id === 'CIRCUIT_BREAKER'));
});

// ================================================================
// 3. WARN 规则（不阻断）
// ================================================================
test('破产概率 5%~30% → WARN 而非 BLOCK', () => {
    const r = A.evaluateRisk({
        scenario: calm,
        kelly: { f: 0.38, fStar: 0.38, ruinProb: 0.15, geoGrowth: 0.05 },
        plan: plan([pair(order(), slot())])
    });
    assert.ok(r.warns.some(w => w.id === 'RUIN_WATCH'));
    assert.ok(!r.blocks.some(b => b.id === 'RUIN_RISK'));
    assert.equal(r.passed, true, 'WARN 不应阻断执行');
});

test('低分派遣 → WARN', () => {
    const r = A.evaluateRisk({
        scenario: calm, kelly: null,
        plan: plan([pair(order(), slot(), 40)])
    });
    assert.ok(r.warns.some(w => w.id === 'MARGIN_DISPATCH'));
    assert.equal(r.passed, true);
});

test('机型集中度过高 → WARN', () => {
    const pairs = [1, 2, 3].map(i =>
        pair(order({ id: i }), slot({ slotId: 'F1#0' + i }))
    );
    const r = A.evaluateRisk({ scenario: calm, kelly: null, plan: plan(pairs) });
    assert.ok(r.warns.some(w => w.id === 'CONCENTRATION'), '3 单全压同一机型应告警');
});

test('机型分散则不告警', () => {
    const pairs = [
        pair(order({ id: 1 }), slot({ fleetId: 'F1', slotId: 'F1#01' })),
        pair(order({ id: 2 }), slot({ fleetId: 'F2', slotId: 'F2#01' })),
        pair(order({ id: 3 }), slot({ fleetId: 'F3', slotId: 'F3#01' }))
    ];
    const r = A.evaluateRisk({ scenario: calm, kelly: null, plan: plan(pairs) });
    assert.ok(!r.warns.some(w => w.id === 'CONCENTRATION'));
});

test('运力缺口 → WARN', () => {
    const r = A.evaluateRisk({
        scenario: calm, kelly: null,
        plan: plan([pair(order(), null, 0)], 2)
    });
    assert.ok(r.warns.some(w => w.id === 'CAPACITY_SHORT'));
});

// ================================================================
// 4. ★ Guardrail 的独立性（本文件的核心）
// ================================================================
test('★ 核心：Agent 漏判时 Guardrail 仍能拦下', () => {
    // 构造一个"Agent 全绿"的场景：把规则库临时清空，模拟 Agent 失效
    const fakeScenario = { windBase: 20, equilibrium: 0.45 };
    const badPlan = plan([pair(order(), slot({ windMax: 12, soh: 90 }))]);

    // Guardrail 完全不依赖 RISK_RULES，即使规则库被破坏也应拦截
    const saved = A.RISK_RULES.slice();
    A.RISK_RULES.length = 0;
    let agentResult, guardResult;
    try {
        agentResult = A.evaluateRisk({ scenario: fakeScenario, kelly: null, plan: badPlan });
        guardResult = A.guardrail(badPlan, { scenario: fakeScenario });
    } finally {
        A.RISK_RULES.push(...saved);   // 必须还原，否则污染后续测试
    }

    assert.equal(agentResult.passed, true, 'Agent 规则被清空后应"放行"');
    assert.equal(guardResult.passed, false, 'Guardrail 必须独立拦下');
    assert.equal(guardResult.violations.length, 1);
    assert.ok(guardResult.violations[0].reasons.join('').includes('侧风'));
});

test('★ Guardrail 强制剔除违规指派并生成安全方案', () => {
    const badSlot = slot({ slotId: 'BAD#01', soh: 40 });      // SOH 违规
    const goodSlot = slot({ slotId: 'OK#01', soh: 92 });
    const p = plan([
        pair(order({ id: 1 }), badSlot, 90),
        pair(order({ id: 2 }), goodSlot, 85)
    ]);
    const g = A.guardrail(p, { scenario: calm });

    assert.equal(g.passed, false);
    assert.equal(g.forcedActions.length, 1);
    assert.equal(g.forcedActions[0].orderId, 1);
    assert.equal(g.safePlan.assignedCount, 1, '安全方案只保留合规指派');
    assert.equal(g.safePlan.pairs[0].slot, null, '违规项被降级为不派');
    assert.equal(g.safePlan.pairs[0].blockedBy, 'guardrail');
    assert.equal(g.safePlan.pairs[1].slot.slotId, 'OK#01', '合规项原样保留');
    assert.equal(g.safePlan.total, 85, '总分应扣除被剔除项');
});

test('★ Guardrail 复算全部四类物理约束', () => {
    // 每个 case 单独定制 order，确保只有目标约束被违反
    const cases = [
        [{ soh: 40 }, calm, order(), 'SOH'],
        [{ windMax: 5 }, { windBase: 15 }, order(), '侧风'],
        [{ payload: 3 }, calm, order({ weight: 8 }), '载重'],
        // speed=20km/h 飞 20km 需 68min，远超 30min 时限
        [{ speed: 20 }, calm, order({ distance: 20, deadline: 30 }), 'ETA']
    ];
    cases.forEach(([over, sc, o, keyword]) => {
        const g = A.guardrail(plan([pair(o, slot(over))]), { scenario: sc });
        assert.equal(g.passed, false, `${keyword} 违规应被拦下`);
        assert.ok(g.violations[0].reasons.join('').includes(keyword),
            `${keyword} 的淘汰原因应被记录，实际：${g.violations[0].reasons}`);
    });
});

test('Guardrail 不修改传入的 plan', () => {
    const p = plan([pair(order(), slot({ soh: 40 }))]);
    const snapshot = JSON.stringify(p);
    A.guardrail(p, { scenario: calm });
    assert.equal(JSON.stringify(p), snapshot, 'Guardrail 必须是无副作用的');
});

test('Guardrail 结果自洽：安全方案确实全部合规', () => {
    const rnd = A.mulberry32(99);
    for (let i = 0; i < 50; i++) {
        const pairs = [];
        for (let k = 0; k < 4; k++) {
            pairs.push(pair(
                order({ id: k, weight: 1 + Math.floor(rnd() * 12), distance: 5 + Math.floor(rnd() * 90), deadline: 20 + Math.floor(rnd() * 150) }),
                slot({ slotId: 'S' + k, fleetId: 'F' + k, soh: 40 + Math.floor(rnd() * 60), windMax: 6 + Math.floor(rnd() * 14), payload: 4 + Math.floor(rnd() * 16), speed: 30 + Math.floor(rnd() * 80) }),
                Math.round(rnd() * 100)
            ));
        }
        const wind = Math.floor(rnd() * 22);
        const g = A.guardrail(plan(pairs), { scenario: { windBase: wind } });
        // 对安全方案再跑一次 Guardrail，必须全绿（幂等/收敛）
        const again = A.guardrail(g.safePlan, { scenario: { windBase: wind } });
        assert.equal(again.passed, true, `第 ${i} 轮：安全方案二次校验仍未通过`);
        assert.equal(again.violations.length, 0);
    }
});

test('Guardrail 幂等：对已净化方案再调用不产生新动作', () => {
    const p = plan([pair(order(), slot({ soh: 40 }))]);
    const g1 = A.guardrail(p, { scenario: calm });
    const g2 = A.guardrail(g1.safePlan, { scenario: calm });
    assert.equal(g2.passed, true);
    assert.equal(g2.forcedActions.length, 0);
});

// ================================================================
// 5. 异常输入韧性
// ================================================================
test('规则内部异常被升级为 BLOCK，而非静默放行', () => {
    const boomRule = {
        id: 'BOOM', name: '必炸规则', severity: 'BLOCK', why: 'test',
        check: function() { throw new Error('模拟规则崩溃'); }
    };
    A.RISK_RULES.push(boomRule);
    try {
        const r = A.evaluateRisk({ scenario: calm, kelly: null, plan: plan([pair(order(), slot())]) });
        assert.equal(r.passed, false, '规则崩溃必须阻断，绝不能静默放行');
        const b = r.blocks.find(x => x.id === 'BOOM');
        assert.ok(b, '应产生 BOOM 阻断项');
        assert.ok(b.detail.join('').includes('模拟规则崩溃'));
    } finally {
        A.RISK_RULES.pop();
    }
    assert.equal(A.RISK_RULES.filter(r => r.id === 'BOOM').length, 0, '需清理干净');
});

test('explainRisk 输出可读且随级别变化', () => {
    const pass = A.explainRisk({ level: 'PASS', blocks: [], warns: [] });
    assert.ok(pass.includes('通过'));
    const block = A.explainRisk({
        level: 'BLOCK',
        blocks: [{ name: '抗风上限' }, { name: '电池健康下限' }],
        warns: [{ name: '低分派遣' }]
    });
    assert.ok(block.includes('2 项阻断'));
    assert.ok(block.includes('抗风上限'));
    assert.ok(block.includes('1 项警告'));
    assert.equal(A.explainRisk(null), '未执行风控');
});

test('规则库规模与结构完整性', () => {
    assert.ok(A.RISK_RULES.length >= 10, '规则数应 ≥10');
    A.RISK_RULES.forEach(r => {
        assert.ok(r.id && r.name && r.why, `规则 ${r.id} 缺少必要字段`);
        assert.ok(['BLOCK', 'WARN'].includes(r.severity), `规则 ${r.id} 级别非法`);
        assert.equal(typeof r.check, 'function');
    });
    const ids = A.RISK_RULES.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length, '规则 id 必须唯一');
});
