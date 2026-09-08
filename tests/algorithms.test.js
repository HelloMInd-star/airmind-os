/**
 * AirMind 核心算法单元测试
 * 运行： node --test tests/
 *
 * 原则：优先断言「数学性质」而非「当前输出值」。
 * 把今天的数字钉死成断言，会让明天的重构变成灾难。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/js/core/algorithms.js');

// ================================================================
// 0. 数值工具
// ================================================================
test('clamp / lerp 边界正确', () => {
    assert.equal(A.clamp(5, 0, 1), 1);
    assert.equal(A.clamp(-5, 0, 1), 0);
    assert.equal(A.clamp(0.5, 0, 1), 0.5);
    assert.equal(A.lerp(0, 10, 0.25), 2.5);
    assert.equal(A.lerp(10, 0, 0.5), 5);
});

test('quantile 线性插值正确', () => {
    const arr = [1, 2, 3, 4, 5];
    assert.equal(A.quantile(arr, 0), 1);
    assert.equal(A.quantile(arr, 1), 5);
    assert.equal(A.quantile(arr, 0.5), 3);
    assert.equal(A.quantile(arr, 0.25), 2);
    assert.equal(A.quantile(arr, 0.125), 1.5);
});

test('mulberry32 同种子可复现、不同种子有差异', () => {
    const a = A.mulberry32(42), b = A.mulberry32(42), c = A.mulberry32(43);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    const seqC = Array.from({ length: 50 }, () => c());
    assert.deepEqual(seqA, seqB, '同种子必须完全一致');
    assert.notDeepEqual(seqA, seqC, '不同种子应当不同');
    seqA.forEach(v => assert.ok(v >= 0 && v < 1, '随机数应落在 [0,1)'));
});

// ================================================================
// 1. 凯利公式
// ================================================================
test('kellyFraction 解析解正确', () => {
    assert.equal(A.kellyFraction(1, 0.5), 0, '公平赌局不应下注');
    assert.ok(Math.abs(A.kellyFraction(2, 0.6) - 0.4) < 1e-12);
    // (1.3*0.4 - 0.6)/1.3
    assert.ok(Math.abs(A.kellyFraction(1.3, 0.4) - (-0.08 / 1.3)) < 1e-12);
});

test('kellyFraction 退化输入不产生 NaN', () => {
    assert.equal(A.kellyFraction(0, 0.5), 0, '赔率为 0');
    assert.equal(A.kellyFraction(-1, 0.5), 0, '负赔率');
    assert.equal(A.kellyFraction(2, 0), -1, '必输 → 满仓反向');
    assert.equal(A.kellyFraction(2, 1), 1, '必赢 → 满仓');
});

test('★ 核心性质：f* 确实是增长率曲线的峰值', () => {
    // 这是凯利准则的定义性性质，若此项失败说明实现有根本错误
    const cases = [{ b: 2, p: 0.6 }, { b: 1.3, p: 0.4 }, { b: 3, p: 0.5 }, { b: 1.6, p: 0.62 }];
    for (const { b, p } of cases) {
        const fStar = A.kellyFraction(b, p);
        const from = Math.min(-0.2, fStar - 0.5), to = Math.max(1.2, fStar + 0.5);
        const curve = A.kellyCurve(b, p, { from, to, steps: 2001 });
        let best = curve[0];
        for (const pt of curve) if (pt.g > best.g) best = pt;
        assert.ok(
            Math.abs(best.f - fStar) < 0.02,
            `b=${b} p=${p}: 数值峰值 ${best.f.toFixed(3)} 应逼近解析解 ${fStar.toFixed(3)}`
        );
    }
});

test('★ 过度下注会毁掉长期增长（凯利的实践意义）', () => {
    const b = 2, p = 0.6;
    const fStar = A.kellyFraction(b, p);          // 0.4
    assert.ok(A.kellyGrowthRate(b, p, fStar) > 0, '凯利仓位应正增长');
    // 两倍凯利仍可能正增长，但应低于最优
    assert.ok(A.kellyGrowthRate(b, p, fStar * 2) < A.kellyGrowthRate(b, p, fStar));
    // 全押必归零
    assert.equal(A.kellyGrowthRate(b, p, 1), -Infinity);
    assert.equal(A.kellyGrowthRate(b, p, 1.5), -Infinity);
});

test('蒙特卡洛：不下注则资金恒定、零破产', () => {
    const r = A.kellyMonteCarlo({ b: 2, p: 0.6, f: 0, periods: 100, trials: 200, seed: 7 });
    assert.equal(r.ruinProb, 0);
    assert.ok(Math.abs(r.p50 - 1) < 1e-12, '不下注终值应为 1');
    assert.ok(Math.abs(r.geoGrowth) < 1e-12, '增长率应为 0');
    assert.ok(Math.abs(r.p10 - r.p90) < 1e-12, '无波动');
});

test('蒙特卡洛：全押几乎必然破产', () => {
    const r = A.kellyMonteCarlo({ b: 2, p: 0.6, f: 1, periods: 100, trials: 300, seed: 7 });
    assert.ok(r.ruinProb > 0.99, `全押破产率应接近 100%，实际 ${r.ruinProb}`);
});

test('蒙特卡洛：凯利仓位的长期增长优于过度下注', () => {
    const b = 2, p = 0.6, fStar = A.kellyFraction(b, p);
    const atKelly = A.kellyMonteCarlo({ b, p, f: fStar, periods: 150, trials: 400, seed: 11 });
    const overBet = A.kellyMonteCarlo({ b, p, f: fStar * 2.5, periods: 150, trials: 400, seed: 11 });
    assert.ok(atKelly.geoGrowth > overBet.geoGrowth,
        `凯利 ${atKelly.geoGrowth.toFixed(4)} 应优于过度下注 ${overBet.geoGrowth.toFixed(4)}`);
    assert.ok(atKelly.ruinProb < overBet.ruinProb, '凯利仓位破产率应更低');
});

test('蒙特卡洛：同种子完全可复现', () => {
    const o = { b: 2, p: 0.6, f: 0.4, periods: 80, trials: 150, seed: 2024 };
    const r1 = A.kellyMonteCarlo(o), r2 = A.kellyMonteCarlo(o);
    assert.equal(r1.p50, r2.p50);
    assert.equal(r1.ruinProb, r2.ruinProb);
    assert.equal(r1.geoGrowth, r2.geoGrowth);
});

test('蒙特卡洛：分位数带结构完整且单调', () => {
    const r = A.kellyMonteCarlo({ b: 2, p: 0.6, f: 0.4, periods: 30, trials: 200, seed: 3 });
    assert.equal(r.band.length, 31, 'band 应含 0..periods 共 periods+1 个点');
    assert.equal(r.band[0].p50, 1, '起点应为初始资金');
    r.band.forEach(pt => {
        assert.ok(pt.p10 <= pt.p50 + 1e-9 && pt.p50 <= pt.p90 + 1e-9, '分位数必须有序');
    });
});

// ================================================================
// 2. 定价
// ================================================================
test('分层费率按距离正确切换', () => {
    assert.equal(A.tierRate(5), 1.38);
    assert.equal(A.tierRate(15), 1.38, '边界应归入低空');
    assert.equal(A.tierRate(15.1), 3.22);
    assert.equal(A.tierRate(60), 3.22);
    assert.equal(A.tierRate(60.1), 6.32);
});

test('★ 报价对气象溢价与综合系数单调', () => {
    const order = { weight: 8, distance: 30 };
    const ac = { baseCost: 1.0 };
    const base = A.quoteCost(order, ac, { weatherMult: 1, composite: 0 });
    const storm = A.quoteCost(order, ac, { weatherMult: 1.34, composite: 0 });
    const busy = A.quoteCost(order, ac, { weatherMult: 1, composite: 0.4 });
    assert.ok(storm > base, '雷暴溢价应推高报价');
    assert.ok(busy > base, '综合系数上升应推高报价');
    assert.ok(Math.abs(storm / base - 1.34) < 1e-9, '气象倍数应为线性');
});

// ================================================================
// 3. 运力打分
// ================================================================
const AC_OK = { id: 'T1', payload: 10, range: 100, speed: 60, soh: 90, windMax: 12, baseCost: 1.0 };
const ctxCalm = { windBase: 2, weatherMult: 1, composite: 0 };

test('硬门槛：五类不可行情形都能被识别', () => {
    const cases = [
        [{ weight: 20, distance: 10, deadline: 120 }, AC_OK, '载重不足'],
        [{ weight: 5, distance: 300, deadline: 600 }, AC_OK, '航程不足'],
        [{ weight: 5, distance: 10, deadline: 120 }, { ...AC_OK, soh: 55 }, '低于'],
        [{ weight: 5, distance: 10, deadline: 5 }, AC_OK, '时限'],
        [{ weight: 5, distance: 10, deadline: 120 }, AC_OK, '抗风'],   // 配合高风速 ctx
    ];
    cases.forEach(([order, ac, keyword]) => {
        // 前四项用平静气象，最后一项用超上限风速
        const ctx = keyword === '抗风' ? { windBase: 20, weatherMult: 1, composite: 0 } : ctxCalm;
        const r = A.scoreAircraft(order, ac, ctx);
        assert.equal(r.feasible, false, `应判不可行：${keyword}`);
        assert.ok(r.reasons.join('').includes(keyword), `原因应包含「${keyword}」，实际：${r.reasons}`);
        assert.equal(r.score, 0);
    });
});

test('★ SOH 会吃掉可用航程', () => {
    const fresh = A.scoreAircraft({ weight: 5, distance: 80, deadline: 200 }, AC_OK, ctxCalm);
    const worn = A.scoreAircraft({ weight: 5, distance: 80, deadline: 200 }, { ...AC_OK, soh: 60 }, ctxCalm);
    assert.ok(worn.effRange < fresh.effRange, '低 SOH 的有效航程必须更短');
    assert.ok(A.scoreAircraft({ weight: 5, distance: 90, deadline: 200 }, { ...AC_OK, soh: 60 }, ctxCalm).feasible === false,
        '原本够飞的 90km 在电池衰减后应变为不可行');
});

test('可行解的分数落在 0-100 且明细齐备', () => {
    const r = A.scoreAircraft({ weight: 7, distance: 40, deadline: 90 }, AC_OK, ctxCalm);
    assert.equal(r.feasible, true);
    assert.ok(r.score > 0 && r.score <= 100, `分数应在 (0,100]，实际 ${r.score}`);
    ['载重', '航程', '电池', '时效', '成本', '抗风'].forEach(k => {
        assert.ok(typeof r.detail[k] === 'number' && !isNaN(r.detail[k]), `明细应包含 ${k}`);
    });
});

test('rankFleet 按分数降序', () => {
    const fleet = [
        { id: 'a', payload: 20, range: 200, speed: 100, soh: 95, windMax: 20, baseCost: 3 },
        { id: 'b', payload: 5, range: 30, speed: 40, soh: 70, windMax: 8, baseCost: 1 },
        { id: 'c', payload: 8, range: 60, speed: 70, soh: 88, windMax: 14, baseCost: 1.2 },
    ];
    const ranked = A.rankFleet({ weight: 6, distance: 25, deadline: 60 }, fleet, ctxCalm);
    for (let i = 1; i < ranked.length; i++) {
        assert.ok(ranked[i - 1].score >= ranked[i].score, '必须降序');
    }
});

// ================================================================
// 4. 匈牙利算法 / 全局指派
// ================================================================
test('匈牙利：已知 3x3 最小成本匹配', () => {
    // 最优：r0→c1(1), r1→c0(2), r2→c2(2) = 5
    const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
    const r = A.hungarianMin(cost);
    assert.equal(r.total, 5);
    assert.equal(new Set(r.rowToCol).size, 3, '三行必须匹配到三个不同列');
});

test('匈牙利：支持行数 < 列数', () => {
    const cost = [[5, 2, 9], [3, 4, 1]];
    const r = A.hungarianMin(cost);
    // 最优 r0→c1(2), r1→c2(1) = 3
    assert.equal(r.total, 3);
    assert.equal(new Set(r.rowToCol).size, 2);
});

test('匈牙利：行数大于列数应明确报错', () => {
    assert.throws(() => A.hungarianMin([[1, 2], [3, 4], [5, 6]]), /行数/);
});

test('maxAssignment：禁止项被规避', () => {
    // c0 对所有行都禁止 → 无人应被分到 c0
    const score = [[null, 50], [null, 60]];
    const r = A.maxAssignment(score, { minScore: 0 });
    r.rowToCol.forEach(c => assert.notEqual(c, 0, '禁止列不应被选中'));
});

test('★ 核心性质：全局最优指派不劣于贪心', () => {
    // 经典陷阱：两个工单都偏好 s0，但让步之后总收益更高
    //   贪心：o0 抢走 s0(100)，o1 只剩 s1(1) 且低于阈值 → 放弃，总计 100
    //   全局：o0→s1(90)、o1→s0(95)，总计 185
    const score = [[100, 90], [95, 1]];
    const orders = [{ id: 1, weight: 1, distance: 1, deadline: 999 }, { id: 2, weight: 1, distance: 1, deadline: 999 }];
    const slots = [
        { id: 's0', payload: 99, range: 999, speed: 99, soh: 99, windMax: 99, baseCost: 1 },
        { id: 's1', payload: 99, range: 999, speed: 99, soh: 99, windMax: 99, baseCost: 1 }
    ];
    const opt = A.maxAssignment(score, { minScore: 35 });
    const greedy = A.greedyAssign(orders, slots, ctxCalm, { minScore: 35, scoreMatrix: score });

    assert.equal(opt.total, 185, '全局应放弃 100 分换取 90+95');
    assert.equal(greedy.total, 100, '贪心只拿到 100 并放弃第二个工单');
    assert.ok(opt.total > greedy.total, '全局最优必须严格优于贪心');
});

test('★ 随机化：任意规模下全局解都不劣于贪心，且不产生非法指派', () => {
    const rnd = A.mulberry32(20260908);
    for (let iter = 0; iter < 60; iter++) {
        const nO = 1 + Math.floor(rnd() * 8);
        const nS = 1 + Math.floor(rnd() * 8);
        // 随机分数矩阵，约三成槽位不可行
        const score = Array.from({ length: nO }, () =>
            Array.from({ length: nS }, () => (rnd() < 0.3 ? null : Math.round(rnd() * 1000) / 10))
        );
        const opt = A.maxAssignment(score, { minScore: 35 });

        // 1) 不重复占用
        const used = opt.rowToCol.filter(c => c >= 0);
        assert.equal(new Set(used).size, used.length, `第 ${iter} 轮：同一槽位被重复占用`);

        // 2) 每一对已完成的指派都必须合法：非禁止槽位，且不低于阈值
        //    （注意：不能断言"未分配的行其候选都很差"——让位给更需要的工单
        //     恰恰是全局最优优于贪心的地方）
        opt.rowToCol.forEach((c, r) => {
            if (c >= 0) {
                assert.notEqual(score[r][c], null, `第 ${iter} 轮：行 ${r} 被分到禁止槽位 ${c}`);
                assert.ok(score[r][c] >= 35, `第 ${iter} 轮：行 ${r} 的指派 ${score[r][c]} 分低于阈值`);
            }
        });

        // 3) 同矩阵下不劣于贪心
        const slots = Array.from({ length: nS }, (_, i) => ({ id: 's' + i }));
        const orders = Array.from({ length: nO }, (_, i) => ({ id: i }));
        const greedy = A.greedyAssign(orders, slots, ctxCalm, { minScore: 35, scoreMatrix: score });
        assert.ok(opt.total >= greedy.total - 1e-9,
            `第 ${iter} 轮：全局 ${opt.total} 不应劣于贪心 ${greedy.total}`);
    }
});

test('★ 暴力对拍：小规模下全局解必须等于穷举最优', () => {
    // 这是最有说服力的正确性保证——用 O(穷举) 的暴力解交叉验证 O(n³) 的匈牙利解
    const rnd = A.mulberry32(777);
    for (let iter = 0; iter < 40; iter++) {
        const nO = 1 + Math.floor(rnd() * 4);      // 保持小规模以便穷举
        const nS = 1 + Math.floor(rnd() * 5);
        const score = Array.from({ length: nO }, () =>
            Array.from({ length: nS }, () => (rnd() < 0.3 ? null : Math.round(rnd() * 1000) / 10))
        );
        const opt = A.maxAssignment(score, { minScore: 35 });
        const bf = bruteForce(score, 35);
        assert.ok(
            Math.abs(opt.total - bf.total) < 1e-9,
            `第 ${iter} 轮：匈牙利给出 ${opt.total}，穷举最优 ${bf.total}\n矩阵 ${JSON.stringify(score)}`
        );
    }
});

/** 穷举所有可行指派（仅用于测试对拍，规模必须很小） */
function bruteForce(mat, minScore) {
    const n = mat.length, m = mat[0].length;
    let best = { total: -1 };
    const used = new Array(m).fill(false);
    (function dfs(i, sum) {
        if (i === n) { if (sum > best.total) best.total = sum; return; }
        for (let j = 0; j < m; j++) {
            if (used[j]) continue;
            const s = mat[i][j];
            if (s === null || s < minScore) continue;
            used[j] = true;
            dfs(i + 1, sum + s);
            used[j] = false;
        }
        dfs(i + 1, sum);          // 选择不派
    })(0, 0);
    return best;
}

test('maxAssignment：低于 minScore 时宁可不派', () => {
    const score = [[20]];
    const r = A.maxAssignment(score, { minScore: 35 });
    assert.equal(r.rowToCol[0], -1, '20 分低于阈值，应放弃派遣');
    assert.equal(r.unassigned[0], 0);
    const r2 = A.maxAssignment(score, { minScore: 10 });
    assert.equal(r2.rowToCol[0], 0, '阈值降低后应派');
});

test('expandSlots 按库存数量展开且编号唯一', () => {
    const slots = A.expandSlots([
        { id: 'FG-07', unit: 3, name: '固定翼', payload: 10, range: 100, speed: 90, soh: 92, windMax: 12, baseCost: 1 },
        { id: 'MX-03', unit: 2, name: '多旋翼', payload: 5, range: 25, speed: 45, soh: 65, windMax: 10, baseCost: 0.7 },
    ]);
    assert.equal(slots.length, 5);
    assert.equal(new Set(slots.map(s => s.slotId)).size, 5, '槽位编号必须唯一');
    assert.equal(slots[0].slotId, 'FG-07#01');
    assert.equal(slots[4].slotId, 'MX-03#02');
    assert.equal(slots[4].fleetId, 'MX-03');
});

test('★ assignFleet：全局解优于贪心，且统计口径正确', () => {
    const fleet = [
        { id: 'A', unit: 1, name: 'A', payload: 12, range: 150, speed: 80, soh: 92, windMax: 13, baseCost: 1.0 },
        { id: 'B', unit: 1, name: 'B', payload: 8, range: 90, speed: 60, soh: 85, windMax: 11, baseCost: 1.1 },
    ];
    const orders = [
        { id: 1, weight: 11, distance: 100, deadline: 200 },  // 只有 A 扛得动
        { id: 2, weight: 6, distance: 40, deadline: 120 },     // A/B 皆可
    ];
    const r = A.assignFleet(orders, fleet, ctxCalm, { minScore: 0 });
    assert.ok(r.optimal.total >= r.greedy.total, '全局总分不得低于贪心');
    assert.equal(r.slotCount, 2);
    assert.equal(r.usableSlots, 2);
    assert.equal(r.optimal.assignedCount + r.optimal.unassignedCount, orders.length);
});

test('assignFleet：高侧风下可用槽位减少', () => {
    const fleet = [
        { id: 'A', unit: 2, name: 'A', payload: 12, range: 150, speed: 80, soh: 92, windMax: 8, baseCost: 1 },
        { id: 'B', unit: 2, name: 'B', payload: 8, range: 90, speed: 60, soh: 85, windMax: 18, baseCost: 1 },
    ];
    const orders = [{ id: 1, weight: 5, distance: 20, deadline: 120 }];
    const calm = A.assignFleet(orders, fleet, { windBase: 3, weatherMult: 1, composite: 0 });
    const storm = A.assignFleet(orders, fleet, { windBase: 15, weatherMult: 1.3, composite: 0.4 });
    assert.equal(calm.usableSlots, 4);
    assert.equal(storm.usableSlots, 2, '抗风 8m/s 的机型应全部退出');
});

test('性能：20 工单 × 28 槽位全局指派应在 200ms 内完成', () => {
    const fleet = Array.from({ length: 6 }, (_, i) => ({
        id: 'F' + i, unit: 4 + i, name: 'F' + i,
        payload: 5 + i * 4, range: 30 + i * 30, speed: 40 + i * 20,
        soh: 60 + i * 5, windMax: 8 + i * 2, baseCost: 0.6 + i * 0.4
    }));
    const orders = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1, weight: 2 + (i % 12), distance: 5 + (i % 90), deadline: 30 + (i % 150)
    }));
    const t0 = Date.now();
    const r = A.assignFleet(orders, fleet, ctxCalm);
    const ms = Date.now() - t0;
    assert.ok(ms < 200, `全局指派耗时 ${ms}ms，应 < 200ms`);
    assert.equal(r.optimal.pairs.length, 20);
});

// ================================================================
// 5. 串级 PID 仿真
// ================================================================
const pidCfg = { craft: '多点锁平开窗', kp: 0.12, ki: 0.08, kd: 0.05, wind: 15 };

test('无侧风时航迹偏差应趋近于零', () => {
    const r = A.simulateCascade({ ...pidCfg, wind: 0 });
    assert.ok(r.peak < 1e-6, `无风不应产生偏移，实际 ${r.peak}`);
    assert.ok(r.steady < 1e-6);
});

test('★ 阻尼比越高，抗扰能力越强（仿生映射的物理含义）', () => {
    const casement = A.simulateCascade({ ...pidCfg, craft: '多点锁平开窗' });
    const sliding = A.simulateCascade({ ...pidCfg, craft: '推拉活动窗' });
    const floor = A.simulateCascade({ ...pidCfg, craft: '无锁落地窗' });
    assert.ok(casement.peak < sliding.peak, '平开窗峰值应小于推拉窗');
    assert.ok(sliding.peak < floor.peak, '推拉窗峰值应小于落地窗');
    assert.ok(casement.steady < floor.steady, '平开窗稳态误差应小于落地窗');
});

test('★ 侧风越大，稳态误差单调上升', () => {
    const errs = [0, 5, 10, 15, 20, 25].map(w => A.simulateCascade({ ...pidCfg, wind: w }).steady);
    for (let i = 1; i < errs.length; i++) {
        assert.ok(errs[i] > errs[i - 1], `风速递增时稳态误差应单调上升：${errs}`);
    }
});

test('提高积分增益能消除稳态误差', () => {
    const lowI = A.simulateCascade({ ...pidCfg, ki: 0.001 });
    const highI = A.simulateCascade({ ...pidCfg, ki: 0.15 });
    assert.ok(highI.steady < lowI.steady, '积分作用应显著削减稳态误差');
});

test('仿真输出结构完整', () => {
    const r = A.simulateCascade(pidCfg);
    assert.ok(r.series.length > 100, '应输出足够密的采样点');
    assert.equal(r.series.length, r.windSeries.length, '风序列与航迹序列应等长');
    assert.equal(r.series[0][0], 0, '应从 t=0 开始');
    assert.ok(r.zeta > 0 && r.wn > 0 && r.humanW > 0);
    assert.ok(r.settle >= 0);
});

test('评级：无风为 A，极劣参数为 C 或 D', () => {
    const good = A.gradeCascade(A.simulateCascade({ ...pidCfg, wind: 0 }));
    assert.equal(good.grade, 'A');
    const bad = A.gradeCascade(A.simulateCascade({ ...pidCfg, craft: '无锁落地窗', kp: 0.001, ki: 0, kd: 0, wind: 25 }));
    assert.ok(['C', 'D'].includes(bad.grade), `劣化参数应评为 C/D，实际 ${bad.grade}`);
});

// ================================================================
// 6. 应急策略匹配
// ================================================================
test('策略匹配：默认兜底为监测评估型', () => {
    const r = A.matchStrategy({ fireLevel: 0, trapped: 0, supplyGap: 0, evacuees: 0, commStatus: 'normal', disasterType: 'other' });
    assert.equal(r.id, 'monitor');
});

test('策略匹配：优先级按权重与加成正确', () => {
    assert.equal(A.matchStrategy({ fireLevel: 9, trapped: 0, supplyGap: 0, evacuees: 0, commStatus: 'normal', disasterType: 'fire' }).id, 'evacuation');
    assert.equal(A.matchStrategy({ fireLevel: 0, trapped: 5, supplyGap: 0, evacuees: 0, commStatus: 'normal', disasterType: 'other' }).id, 'search');
    assert.equal(A.matchStrategy({ fireLevel: 0, trapped: 0, supplyGap: 0, evacuees: 0, commStatus: 'interrupted', disasterType: 'other' }).id, 'comm');
});

test('策略匹配：置信度封顶 12', () => {
    const r = A.matchStrategy({ fireLevel: 10, trapped: 999, supplyGap: 999, evacuees: 999, commStatus: 'interrupted', disasterType: 'flood' });
    assert.ok(r.conf <= 12, `置信度不得超过 12，实际 ${r.conf}`);
    assert.equal(r.id, 'evacuation', '同时触发时火势/洪水疏散优先级最高');
});

test('策略匹配：不修改传入的策略库', () => {
    const snapshot = JSON.stringify(A.DEFAULT_STRATEGIES.map(s => ({ id: s.id, weight: s.weight })));
    A.matchStrategy({ fireLevel: 9, trapped: 0, supplyGap: 0, evacuees: 0, commStatus: 'normal', disasterType: 'fire' });
    assert.equal(JSON.stringify(A.DEFAULT_STRATEGIES.map(s => ({ id: s.id, weight: s.weight }))), snapshot,
        '匹配过程必须是无副作用的');
});
