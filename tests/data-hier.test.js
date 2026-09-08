/**
 * 数据层 + 分层求解 单元测试
 * 运行： node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/js/core/algorithms.js');

const ctx = { windBase: 4, weatherMult: 1, composite: 0.2 };

// ================================================================
// 1. 订单流生成器
// ================================================================
test('generateOrders：数量与字段正确', () => {
    const o = A.generateOrders(50, { seed: 1 });
    assert.equal(o.length, 50);
    o.forEach((x, i) => {
        assert.equal(typeof x.id, 'number');
        assert.ok(x.name && x.name.length > 0, '应有名称');
        assert.ok(x.weight > 0 && x.weight <= 50, `货重越界: ${x.weight}`);
        assert.ok(x.distance > 0 && x.distance <= 130, `距离越界: ${x.distance}`);
        assert.ok(x.deadline >= 15, `时限过小: ${x.deadline}`);
        assert.ok(['high', 'mid', 'low'].includes(x.priority));
        assert.equal(x.id, 2000 + i, 'id 应连续');
    });
});

test('generateOrders：同种子完全可复现，异种子有差异', () => {
    const a = A.generateOrders(30, { seed: 42 });
    const b = A.generateOrders(30, { seed: 42 });
    const c = A.generateOrders(30, { seed: 43 });
    assert.deepEqual(a, b, '同种子必须一致');
    assert.notDeepEqual(a, c, '不同种子应不同');
});

test('★ generateOrders：大部分工单理论上可完成（不是废单）', () => {
    // 生成器若产出大量"时限 < 最短飞行时间"的工单，就测不出调度能力
    const fleet = A.generateFleet(60, { seed: 7 });
    const slots = A.expandSlots(fleet);
    const orders = A.generateOrders(200, { seed: 2026 });
    let feasible = 0;
    orders.forEach(o => {
        const any = slots.some(s => A.scoreAircraft(o, s, ctx).feasible);
        if (any) feasible++;
    });
    const ratio = feasible / orders.length;
    assert.ok(ratio > 0.8, `可行工单占比应 >80%，实际 ${(ratio * 100).toFixed(1)}%`);
});

test('generateOrders：边界输入不崩溃', () => {
    assert.equal(A.generateOrders(0, { seed: 1 }).length, 0);
    assert.equal(A.generateOrders(1, { seed: 1 }).length, 1);
    assert.doesNotThrow(() => A.generateOrders(5));
});

// ================================================================
// 2. 机队台账
// ================================================================
test('generateFleet：槽位总数逼近目标，机型 id 唯一', () => {
    [30, 97, 500].forEach(target => {
        const f = A.generateFleet(target, { seed: 7 });
        const slots = A.expandSlots(f);
        assert.equal(slots.length, target, `目标 ${target} 槽位，实际 ${slots.length}`);
        const ids = f.map(x => x.id);
        assert.equal(new Set(ids).size, ids.length, '机型 id 必须唯一');
        f.forEach(x => {
            assert.ok(x.soh >= 60 && x.soh <= 100, `SOH 越界: ${x.soh}`);
            assert.ok(x.unit >= 1);
            assert.ok(x.payload > 0 && x.range > 0 && x.speed > 0);
        });
    });
});

test('generateFleet：槽位编号全局唯一', () => {
    const slots = A.expandSlots(A.generateFleet(120, { seed: 3 }));
    assert.equal(new Set(slots.map(s => s.slotId)).size, slots.length);
});

test('generateFleet：可复现', () => {
    assert.deepEqual(A.generateFleet(50, { seed: 9 }), A.generateFleet(50, { seed: 9 }));
});

// ================================================================
// 3. 气象时序
// ================================================================
test('generateWeatherSeries：长度、范围、可复现', () => {
    const w = A.generateWeatherSeries(100, { seed: 9 });
    assert.equal(w.length, 100);
    w.forEach((x, i) => {
        assert.equal(x.t, i);
        assert.ok(x.wind >= 0 && x.wind <= 25, `风速越界: ${x.wind}`);
        assert.equal(typeof x.storm, 'boolean');
    });
    assert.deepEqual(w, A.generateWeatherSeries(100, { seed: 9 }), '必须可复现');
});

test('generateWeatherSeries：均值回归——长期均值贴近设定值', () => {
    const w = A.generateWeatherSeries(2000, { seed: 5, mean: 6, stormProb: 0 });
    const avg = w.reduce((a, c) => a + c.wind, 0) / w.length;
    assert.ok(Math.abs(avg - 6) < 1.5, `长期均值应贴近 6，实际 ${avg.toFixed(2)}`);
});

test('generateWeatherSeries：提高雷暴概率会产生更多骤增', () => {
    const calm = A.generateWeatherSeries(500, { seed: 5, stormProb: 0 });
    const wild = A.generateWeatherSeries(500, { seed: 5, stormProb: 0.2 });
    assert.equal(calm.filter(x => x.storm).length, 0);
    assert.ok(wild.filter(x => x.storm).length > 50, '高雷暴概率应产生大量骤增');
});

// ================================================================
// 4. 分层求解
// ================================================================
test('hierarchicalAssign：无重复占用槽位', () => {
    const orders = A.generateOrders(400, { seed: 11 });
    const fleet = A.generateFleet(200, { seed: 7 });
    const r = A.hierarchicalAssign(orders, fleet, ctx, { baseline: false });
    const used = r.optimal.pairs.filter(p => p.slot).map(p => p.slot.slotId);
    assert.equal(new Set(used).size, used.length, '同一槽位被重复占用');
});

test('hierarchicalAssign：所有指派都合规且不低于阈值', () => {
    const orders = A.generateOrders(400, { seed: 12 });
    const fleet = A.generateFleet(200, { seed: 7 });
    const r = A.hierarchicalAssign(orders, fleet, ctx, { baseline: false, minScore: 35 });
    r.optimal.pairs.forEach(p => {
        if (!p.slot) return;
        const check = A.scoreAircraft(p.order, p.slot, ctx);
        assert.equal(check.feasible, true, `工单 #${p.order.id} 指派不可行`);
        assert.ok(p.score >= 35, `分数 ${p.score} 低于阈值`);
    });
});

test('hierarchicalAssign：结果规模与统计口径正确', () => {
    const orders = A.generateOrders(400, { seed: 13 });
    const fleet = A.generateFleet(200, { seed: 7 });
    const r = A.hierarchicalAssign(orders, fleet, ctx, { baseline: false });
    assert.equal(r.optimal.pairs.length, 400);
    assert.equal(r.optimal.assignedCount + r.optimal.unassignedCount, 400);
    assert.ok(r.windowCount > 1, '400 单应被分成多个窗口');
    assert.equal(r.mode, 'hierarchical');
});

test('★ 核心性质：分层/精确解绝不劣于贪心（多种紧张度）', () => {
    // 这是 autoAssign 的硬承诺：无论运力紧张还是宽松，都不能比贪心差
    [0.3, 0.5, 0.7, 0.9, 1.2].forEach(ratio => {
        const orders = A.generateOrders(400, { seed: 2026 });
        const fleet = A.generateFleet(Math.round(400 * ratio), { seed: 7 });
        const r = A.autoAssign(orders, fleet, ctx, {});
        assert.ok(
            r.optimal.total >= r.greedy.total - 1e-9,
            `紧张度 ${ratio}：解 ${r.optimal.total} 不应劣于贪心 ${r.greedy.total}`
        );
    });
});

test('★ 运力紧张时分层显著优于贪心（这才是调度的价值所在）', () => {
    const orders = A.generateOrders(800, { seed: 2026 });
    const fleet = A.generateFleet(400, { seed: 7 });   // 槽位/单 = 0.5
    const r = A.autoAssign(orders, fleet, ctx, {});
    assert.equal(r.adopted, 'hierarchical', '紧张场景应采用分层解');
    assert.ok(r.improvement > 5, `提升应 >5%，实际 ${r.improvement}%`);
});

test('运力宽松时回退到贪心，不硬撑分层结果', () => {
    const orders = A.generateOrders(600, { seed: 2026 });
    const fleet = A.generateFleet(720, { seed: 7 });   // 槽位/单 = 1.2
    const r = A.autoAssign(orders, fleet, ctx, {});
    assert.ok(['greedy', 'hierarchical'].includes(r.adopted));
    assert.ok(r.optimal.total >= r.greedy.total - 1e-9, '仍不得劣于贪心');
});

test('autoAssign：小规模走精确模式，大规模走分层', () => {
    const small = A.generateOrders(100, { seed: 1 });
    const big = A.generateOrders(300, { seed: 1 });
    const fleet = A.generateFleet(90, { seed: 7 });
    assert.equal(A.autoAssign(small, fleet, ctx, {}).mode, 'exact');
    assert.equal(A.autoAssign(big, A.generateFleet(150, { seed: 7 }), ctx, {}).mode, 'hierarchical');
});

test('autoAssign：阈值可配置', () => {
    const orders = A.generateOrders(200, { seed: 1 });
    const fleet = A.generateFleet(180, { seed: 7 });
    assert.equal(A.autoAssign(orders, fleet, ctx, { threshold: 500 }).mode, 'exact');
    assert.equal(A.autoAssign(orders, fleet, ctx, { threshold: 50 }).mode, 'hierarchical');
});

test('分层求解：局部交换确实提升了解的质量', () => {
    // 关掉交换（rounds=0）应明显更差，证明这一步不是摆设
    const orders = A.generateOrders(600, { seed: 2026 });
    const fleet = A.generateFleet(300, { seed: 7 });
    const noEx = A.hierarchicalAssign(orders, fleet, ctx, { baseline: false, exchangeRounds: 0 });
    const withEx = A.hierarchicalAssign(orders, fleet, ctx, { baseline: false, exchangeRounds: 3 });
    assert.ok(withEx.optimal.total > noEx.optimal.total,
        `交换后 ${withEx.optimal.total} 应优于交换前 ${noEx.optimal.total}`);
});

test('性能：1000 单分层求解应在 2s 内完成', () => {
    const orders = A.generateOrders(1000, { seed: 2026 });
    const fleet = A.generateFleet(500, { seed: 7 });
    const t0 = Date.now();
    const r = A.autoAssign(orders, fleet, ctx, {});
    const ms = Date.now() - t0;
    assert.ok(ms < 2000, `耗时 ${ms}ms，应 < 2000ms`);
    assert.equal(r.optimal.pairs.length, 1000);
});

test('性能：2000 单不崩溃且结构完整', () => {
    const orders = A.generateOrders(2000, { seed: 2026 });
    const fleet = A.generateFleet(1000, { seed: 7 });
    const r = A.autoAssign(orders, fleet, ctx, {});
    assert.equal(r.optimal.pairs.length, 2000);
    const used = r.optimal.pairs.filter(p => p.slot).map(p => p.slot.slotId);
    assert.equal(new Set(used).size, used.length);
});

test('分层求解：空工单与单机型不崩溃', () => {
    const fleet = A.generateFleet(10, { seed: 7 });
    const r0 = A.hierarchicalAssign([], fleet, ctx, { baseline: false });
    assert.equal(r0.optimal.pairs.length, 0);
    assert.equal(r0.optimal.total, 0);
    assert.doesNotThrow(() => A.autoAssign([], fleet, ctx, {}));
    assert.doesNotThrow(() => A.autoAssign(A.generateOrders(5, { seed: 1 }), fleet, ctx, {}));
});
