/**
 * 多角色视角 单元测试
 * 运行： node --test tests/
 *
 * 核心验证点：指标必须真实计算，随输入变化——不允许写死常量。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/js/core/algorithms.js');

const zones = [
    { id: 'Z1', name: '进近管制区', type: 'circle', center: { lng: 103.90, lat: 30.64 }, radiusKm: 5.2, ceilingM: 900, level: 'block' },
    { id: 'Z2', name: '政务管制区', type: 'poly', ceilingM: 600, level: 'block', points: [{ lng: 104.02, lat: 30.63 }, { lng: 104.10, lat: 30.635 }, { lng: 104.11, lat: 30.59 }, { lng: 104.03, lat: 30.582 }] },
    { id: 'Z3', name: '军事限高区', type: 'circle', center: { lng: 103.87, lat: 30.70 }, radiusKm: 6.0, ceilingM: 300, level: 'warn' }
];

const baseAircraft = [
    { id: 'a1', lng: 104.0665, lat: 30.5723, alt: 200 },
    { id: 'a2', lng: 103.90, lat: 30.64, alt: 200 },      // 闯入 Z1
    { id: 'a3', lng: 104.065, lat: 30.61, alt: 300 },     // 闯入 Z2
    { id: 'a4', lng: 104.30, lat: 30.90, alt: 200 }
];

// ================================================================
// 1. 角色定义
// ================================================================
test('ROLES：四个角色，字段完整且 id 唯一', () => {
    assert.equal(A.ROLES.length, 4);
    const ids = A.ROLES.map(r => r.id);
    assert.deepEqual(ids.sort(), ['atc', 'operator', 'regulator', 'vendor']);
    A.ROLES.forEach(r => {
        assert.ok(r.id && r.icon && r.name && r.headline && r.question, `角色 ${r.id} 字段缺失`);
    });
});

test('未知角色 id 回退到默认角色，不抛异常', () => {
    const m = A.computeRoleMetrics('nobody', {});
    assert.ok(m.role, '应回退到默认角色');
    assert.ok(Array.isArray(m.kpis));
});

test('完全空的 ctx 不崩溃', () => {
    ['atc', 'operator', 'vendor', 'regulator'].forEach(id => {
        assert.doesNotThrow(() => A.computeRoleMetrics(id, {}));
        assert.doesNotThrow(() => A.computeRoleMetrics(id, undefined));
        const m = A.computeRoleMetrics(id, {});
        m.kpis.forEach(k => {
            assert.ok(typeof k.value === 'number' && isFinite(k.value), `${id} 的 ${k.label} 不是有限数: ${k.value}`);
        });
    });
});

// ================================================================
// 2. 空管视角
// ================================================================
test('空管：违规计数与热点识别正确', () => {
    const m = A.computeRoleMetrics('atc', { aircraft: baseAircraft, zones: zones });
    const byLabel = {};
    m.kpis.forEach(k => byLabel[k.label] = k.value);

    assert.equal(byLabel['在空航空器'], 4);
    assert.equal(byLabel['空域违规'], 2, 'a2、a3 应判违规');
    assert.ok(Math.abs(byLabel['违规率'] - 50) < 0.1, `违规率应 50%，实际 ${byLabel['违规率']}`);
    assert.equal(byLabel['管制空域'], 3);
    assert.ok(m.insight.includes('政务管制区') || m.insight.includes('进近管制区'), '洞察应指出冲突热点');
    assert.equal(m.emphasis, 'zones');
});

test('空管：零违规时给出"运行正常"的正向洞察', () => {
    const m = A.computeRoleMetrics('atc', {
        aircraft: [{ id: 'x', lng: 104.30, lat: 30.90, alt: 200 }],
        zones: zones
    });
    assert.equal(m.kpis.find(k => k.label === '空域违规').value, 0);
    assert.ok(m.insight.includes('无空域入侵'), '应明确说无入侵');
});

test('★ 空管：违规指标随输入变化（不是写死的）', () => {
    const one = A.computeRoleMetrics('atc', { aircraft: baseAircraft.slice(0, 2), zones: zones });
    const two = A.computeRoleMetrics('atc', { aircraft: baseAircraft, zones: zones });
    assert.notEqual(
        one.kpis.find(k => k.label === '空域违规').value,
        two.kpis.find(k => k.label === '空域违规').value,
        '不同输入应产生不同违规数'
    );
});

// ================================================================
// 3. 运营商视角
// ================================================================
function mkAssign(assigned, slotCount, improvement, loadW, capW) {
    const pairs = [];
    for (let i = 0; i < assigned; i++) {
        pairs.push({
            order: { id: i, weight: loadW / assigned },
            slot: { payload: capW / assigned }
        });
    }
    return {
        pairs, assignedCount: assigned, unassignedCount: 0,
        improvement, slotCount
    };
}

test('运营商：利用率 / 增益 / 载荷率 计算正确', () => {
    const m = A.computeRoleMetrics('operator', {
        assign: mkAssign(50, 100, 12.8, 300, 500)
    });
    const by = {};
    m.kpis.forEach(k => by[k.label] = k.value);

    assert.equal(by['运力利用率'], 50);
    assert.equal(by['调度增益'], 12.8);
    assert.equal(by['平均载荷率'], 60);
    assert.equal(m.emphasis, 'routes');
});

test('★ 运营商：增益大时洞察强调调度价值，增益为 0 时建议扩单', () => {
    const tight = A.computeRoleMetrics('operator', { assign: mkAssign(50, 100, 16.4, 300, 500) });
    assert.ok(tight.insight.includes('16.4'), '应引用具体增益数字');
    assert.ok(tight.insight.includes('调度'), '高增益应强调调度价值');

    const loose = A.computeRoleMetrics('operator', { assign: mkAssign(50, 100, 0, 300, 500) });
    assert.ok(loose.insight.includes('宽松'), '零增益应指出运力宽松');
    assert.ok(loose.insight.includes('扩单'), '应给出"优先扩单"的建议');
});

test('运营商：槽位为 0 时不产生除零错误', () => {
    const m = A.computeRoleMetrics('operator', { assign: { pairs: [], assignedCount: 0, slotCount: 0 } });
    m.kpis.forEach(k => assert.ok(isFinite(k.value), `${k.label} 出现非有限值`));
});

// ================================================================
// 4. 厂商视角
// ================================================================
test('厂商：健康度统计与维护建议正确', () => {
    const m = A.computeRoleMetrics('vendor', {
        fleet: [
            { id: 'F1', soh: 92, unit: 4 },
            { id: 'F2', soh: 65, unit: 12 },
            { id: 'F3', soh: 58, unit: 3 }
        ]
    });
    const by = {};
    m.kpis.forEach(k => by[k.label] = k.value);

    assert.equal(by['机队规模'], 19);
    assert.equal(by['需维护机型'], 2, 'SOH<70 的有 F2、F3');
    assert.equal(by['最弱机型'], 58);
    assert.ok(m.insight.includes('F3'), '应点名最弱机型');
    assert.ok(m.insight.includes('60%'), '应提示 SOH 60% 禁飞线');
    assert.equal(m.emphasis, 'fleet');
});

test('厂商：全健康机队给出正向洞察', () => {
    const m = A.computeRoleMetrics('vendor', {
        fleet: [{ id: 'F1', soh: 90, unit: 4 }, { id: 'F2', soh: 85, unit: 6 }]
    });
    assert.equal(m.kpis.find(k => k.label === '需维护机型').value, 0);
    assert.ok(m.insight.includes('良好'), '应给出正向反馈');
});

// ================================================================
// 5. 监管视角
// ================================================================
test('监管：审计指标从决策轨迹真实统计', () => {
    const m = A.computeRoleMetrics('regulator', {
        trace: [
            { final: 'OK', guardBlocked: 0 },
            { final: 'BLOCKED', guardBlocked: 3 },
            { final: 'WARNED', guardBlocked: 1 },
            { final: 'OK', guardBlocked: 0 }
        ]
    });
    const by = {};
    m.kpis.forEach(k => by[k.label] = k.value);

    assert.equal(by['决策留痕'], 4);
    assert.equal(by['风控阻断'], 1);
    assert.equal(by['Guardrail 剔除'], 4, '3 + 1 = 4');
    assert.equal(by['一次通过率'], 75);
    assert.ok(m.insight.includes('4'), '洞察应引用轨迹总数');
});

test('监管：无轨迹时给出引导而非空白', () => {
    const m = A.computeRoleMetrics('regulator', { trace: [] });
    assert.equal(m.kpis.find(k => k.label === '决策留痕').value, 0);
    assert.ok(m.insight.includes('暂无'), '应说明暂无记录');
    assert.ok(m.insight.includes('编排执行'), '应引导用户去产生记录');
    assert.equal(m.emphasis, 'none');
});

// ================================================================
// 6. 跨角色一致性
// ================================================================
test('★ 四个角色看同一批数据，结论各不相同', () => {
    const ctx = {
        aircraft: baseAircraft, zones: zones,
        fleet: [{ id: 'F1', soh: 65, unit: 4 }, { id: 'F2', soh: 92, unit: 6 }],
        assign: mkAssign(50, 100, 12.8, 300, 500),
        trace: [{ final: 'BLOCKED', guardBlocked: 2 }]
    };
    const insights = ['atc', 'operator', 'vendor', 'regulator'].map(id =>
        A.computeRoleMetrics(id, ctx).insight
    );
    assert.equal(new Set(insights).size, 4, '四个角色的洞察必须各不相同');
    insights.forEach(s => assert.ok(s.length > 10, '洞察不应过短'));
});

test('每个角色都返回 4 个 KPI 且 tone 合法', () => {
    const ctx = {
        aircraft: baseAircraft, zones: zones,
        fleet: [{ id: 'F1', soh: 65, unit: 4 }],
        assign: mkAssign(50, 100, 5, 300, 500),
        trace: [{ final: 'OK', guardBlocked: 0 }]
    };
    ['atc', 'operator', 'vendor', 'regulator'].forEach(id => {
        const m = A.computeRoleMetrics(id, ctx);
        assert.equal(m.kpis.length, 4, `${id} 应有 4 个 KPI`);
        m.kpis.forEach(k => {
            assert.ok(k.label && k.unit !== undefined, `${id}/${k.label} 缺少字段`);
            assert.ok(['blue', 'success', 'danger', 'gold', 'cyan'].includes(k.tone),
                `${id}/${k.label} tone 非法: ${k.tone}`);
        });
    });
});

test('随机化：任意组合下都不产生 NaN', () => {
    const rnd = A.mulberry32(2024);
    for (let i = 0; i < 60; i++) {
        const ctx = {
            aircraft: Array.from({ length: Math.floor(rnd() * 10) }, (_, k) => ({
                id: 'a' + k, lng: 103.7 + rnd() * 0.8, lat: 30.2 + rnd() * 0.8, alt: rnd() * 1500
            })),
            zones: zones,
            fleet: Array.from({ length: 3 }, (_, k) => ({ id: 'F' + k, soh: rnd() * 100, unit: Math.floor(rnd() * 10) })),
            assign: {
                pairs: [], assignedCount: Math.floor(rnd() * 50),
                unassignedCount: Math.floor(rnd() * 20),
                slotCount: Math.floor(rnd() * 100), improvement: rnd() * 30
            },
            trace: Array.from({ length: Math.floor(rnd() * 5) }, () => ({
                final: ['OK', 'BLOCKED', 'WARNED'][Math.floor(rnd() * 3)],
                guardBlocked: Math.floor(rnd() * 4)
            }))
        };
        ['atc', 'operator', 'vendor', 'regulator'].forEach(id => {
            const m = A.computeRoleMetrics(id, ctx);
            m.kpis.forEach(k => {
                assert.ok(isFinite(k.value), `${id}/${k.label} = ${k.value}（NaN/Infinity）`);
            });
        });
    }
});
