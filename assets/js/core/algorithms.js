/*!
 * Y.Mine · AirMind V2.1 — 核心算法层（纯函数，无 DOM 依赖）
 *
 * 设计约束：
 *   1. 纯函数，不读全局、不碰 DOM —— 因此可以在 Node 里直接单元测试
 *   2. UMD 包装 —— 浏览器挂 window.AirMind，Node 走 module.exports
 *   3. 不使用 ES Module 语法 —— 保证 file:// 双击 index.html 依然可运行
 *
 * 这是 Agent 编排层的地基：所有决策 Agent 最终都调用这里的函数，
 * 因此这里的正确性直接决定上层编排的可信度。
 */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AirMind = factory();
    }
})(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    // ================================================================
    // 0. 数值工具
    // ================================================================

    /** 区间裁剪 */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    /** 线性插值 */
    function lerp(a, b, t) { return a + (b - a) * t; }

    /**
     * 可复现伪随机数（mulberry32）
     * 蒙特卡洛必须可复现，否则测试无法断言、线上无法追责
     */
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function() {
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /** 分位数（线性插值，输入不必预先排序） */
    function quantile(sorted, q) {
        if (!sorted.length) return NaN;
        var pos = (sorted.length - 1) * clamp(q, 0, 1);
        var lo = Math.floor(pos), hi = Math.ceil(pos);
        if (lo === hi) return sorted[lo];
        return lerp(sorted[lo], sorted[hi], pos - lo);
    }

    // ================================================================
    // 1. 博弈决策：凯利公式
    // ================================================================

    /**
     * 凯利最优仓位 f* = (b·p − q) / b
     * @param {number} b 赔率（净收益/本金）
     * @param {number} p 胜率
     * @returns {number} 最优投入比例，负值表示应反向或回避
     */
    function kellyFraction(b, p) {
        if (!(b > 0)) return 0;              // 赔率非正，无下注价值
        if (!(p > 0)) return -1;             // 必输，满仓反向
        if (p >= 1) return 1;                // 必赢，满仓
        return (b * p - (1 - p)) / b;
    }

    /**
     * 期望对数增长率 g(f) = p·ln(1+f·b) + q·ln(1−f)
     * 凯利准则的本质：最大化长期几何增长，而非单期期望收益
     * @returns {number} 增长率；若 f 导致爆仓（f≥1）返回 -Infinity
     */
    function kellyGrowthRate(b, p, f) {
        if (f >= 1) return -Infinity;        // 全押且失败 → 归零
        if (f <= -1 / b) return -Infinity;   // 反向过度 → 归零
        var q = 1 - p;
        return p * Math.log(1 + f * b) + q * Math.log(1 - f);
    }

    /**
     * 扫描不同仓位下的增长率曲线
     * 用于验证"f* 确实是峰值"并可视化过度下注的代价
     */
    function kellyCurve(b, p, opts) {
        opts = opts || {};
        var lo = opts.from === undefined ? -0.5 : opts.from;
        var hi = opts.to === undefined ? 2.0 : opts.to;
        var steps = opts.steps || 251;
        var out = [];
        for (var i = 0; i < steps; i++) {
            var f = lerp(lo, hi, steps === 1 ? 0 : i / (steps - 1));
            out.push({ f: f, g: kellyGrowthRate(b, p, f) });
        }
        return out;
    }

    /**
     * 多期蒙特卡洛：模拟按固定比例 f 反复下注的资金轨迹
     *
     * 单期凯利只告诉你"最优比例"，但回答不了：
     *   - 运气差的时候会回撤多少？
     *   - 破产（本金亏到 5% 以下）的概率有多大？
     * 这两个才是调度指挥官真正关心的风险量。
     *
     * @param {object} o {b, p, f, periods, trials, start, ruinLevel, seed}
     */
    function kellyMonteCarlo(o) {
        var b = o.b, p = o.p, f = o.f;
        var periods = o.periods || 200;
        var trials = o.trials || 400;
        var start = o.start === undefined ? 1 : o.start;
        var ruinLevel = o.ruinLevel === undefined ? 0.05 : o.ruinLevel;
        var rnd = mulberry32(o.seed === undefined ? 20240918 : o.seed);

        var finals = [];
        var ruins = 0;
        // 保存每期的分位带，用于画"扇形图"
        var band = [];
        var snapshots = [];   // snapshots[t] = 该期所有 trial 的资本

        for (var t = 0; t <= periods; t++) snapshots.push([]);

        for (var k = 0; k < trials; k++) {
            var w = start;
            var ruined = false;
            snapshots[0].push(w);
            for (var t = 1; t <= periods; t++) {
                if (ruined) { snapshots[t].push(w); continue; }
                var win = rnd() < p;
                w *= win ? (1 + f * b) : (1 - f);
                if (w <= 0) { w = 0; ruined = true; }
                if (w < start * ruinLevel) ruined = true;
                snapshots[t].push(w);
            }
            finals.push(w);
            if (ruined) ruins++;
        }

        finals.sort(function(a, b2) { return a - b2; });
        for (var t2 = 0; t2 <= periods; t2++) {
            var arr = snapshots[t2].slice().sort(function(a, b3) { return a - b3; });
            band.push({
                t: t2,
                p10: quantile(arr, 0.10),
                p50: quantile(arr, 0.50),
                p90: quantile(arr, 0.90)
            });
        }

        // 几何增长率：终值的对数平均 / 期数
        var logSum = 0, valid = 0;
        for (var i = 0; i < finals.length; i++) {
            if (finals[i] > 0) { logSum += Math.log(finals[i] / start); valid++; }
        }

        return {
            ruinProb: ruins / trials,
            p10: quantile(finals, 0.10),
            p50: quantile(finals, 0.50),
            p90: quantile(finals, 0.90),
            mean: finals.reduce(function(a, c) { return a + c; }, 0) / trials,
            geoGrowth: valid ? Math.exp(logSum / valid / periods) - 1 : -1,
            band: band,
            periods: periods,
            trials: trials
        };
    }

    // ================================================================
    // 2. 空域定价
    // ================================================================

    var PRICE_TIERS = [
        { max: 15,  rate: 1.38, label: '低空 0-500m', desc: '城市末端配送' },
        { max: 60,  rate: 3.22, label: '中空 500-6000m', desc: '城际干线' },
        { max: Infinity, rate: 6.32, label: '高空 6000m+', desc: '跨城急件' }
    ];

    function tierRate(distance) {
        for (var i = 0; i < PRICE_TIERS.length; i++) {
            if (distance <= PRICE_TIERS[i].max) return PRICE_TIERS[i].rate;
        }
        return PRICE_TIERS[PRICE_TIERS.length - 1].rate;
    }

    /**
     * 单工单报价：分层费率 × 距离 × 载重系数 × 机型成本 × 气象溢价 × 综合系数
     * @param {object} ctx { weatherMult, composite }
     */
    function quoteCost(order, ac, ctx) {
        ctx = ctx || { weatherMult: 1, composite: 0 };
        var tier = tierRate(order.distance);
        var loadFactor = 1 + Math.max(0, order.weight - 5) * 0.04;
        return tier * order.distance * loadFactor * ac.baseCost *
            (ctx.weatherMult || 1) * (1 + (ctx.composite || 0));
    }

    // ================================================================
    // 3. 运力匹配：单工单打分
    // ================================================================

    var SO_MIN = 60;           // SOH 低于此值禁飞
    var SCORE_WEIGHTS = { payload: 0.25, time: 0.22, soh: 0.20, range: 0.18, cost: 0.10, wind: 0.05 };

    /**
     * 单工单 × 单机型 适配度打分
     * @param {object} order {id, weight, distance, deadline}
     * @param {object} ac    {payload, range, speed, soh, windMax, baseCost, ...}
     * @param {object} ctx   {windBase, weatherMult, composite}
     * @returns {object} {feasible, score, reasons, ...}
     */
    function scoreAircraft(order, ac, ctx) {
        ctx = ctx || {};
        var wind = ctx.windBase || 0;
        var effRange = ac.range * (0.55 + 0.45 * ac.soh / 100);  // SOH 直接吃掉可用航程
        var eta = (order.distance / ac.speed) * 60 + 8;          // 巡航 + 起降 8min
        var reasons = [];
        var feasible = true;

        if (order.weight > ac.payload) { feasible = false; reasons.push('载重不足（需 ' + order.weight + 'kg / 上限 ' + ac.payload + 'kg）'); }
        if (order.distance > effRange) { feasible = false; reasons.push('航程不足（有效 ' + effRange.toFixed(1) + 'km）'); }
        if (ac.soh < SO_MIN) { feasible = false; reasons.push('SOH ' + ac.soh + '% 低于 ' + SO_MIN + '%，仅限短途'); }
        if (wind > ac.windMax) { feasible = false; reasons.push('侧风 ' + wind + 'm/s 超抗风上限 ' + ac.windMax + 'm/s'); }
        if (eta > order.deadline) { feasible = false; reasons.push('预计 ' + eta.toFixed(0) + 'min > 时限 ' + order.deadline + 'min'); }

        var loadRate = ac.payload > 0 ? order.weight / ac.payload : Infinity;
        var sPayload = clamp(1 - Math.abs(loadRate - 0.7) / 0.7, 0, 1) * 100;
        var sRange = effRange > 0 ? clamp(1 - order.distance / effRange, 0, 1) * 100 : 0;
        var sSoh = clamp((ac.soh - 50) / 50, 0, 1) * 100;
        var sTime = eta > 0 ? clamp(order.deadline / eta, 0, 1.2) / 1.2 * 100 : 0;
        var cost = quoteCost(order, ac, ctx);
        var sCost = clamp(1 - cost / 900, 0, 1) * 100;
        var sWind = ac.windMax > 0 ? clamp(1 - wind / ac.windMax, 0, 1) * 100 : 0;

        var total = feasible
            ? sPayload * SCORE_WEIGHTS.payload +
              sTime * SCORE_WEIGHTS.time +
              sSoh * SCORE_WEIGHTS.soh +
              sRange * SCORE_WEIGHTS.range +
              sCost * SCORE_WEIGHTS.cost +
              sWind * SCORE_WEIGHTS.wind
            : 0;

        return {
            ac: ac,
            feasible: feasible,
            reasons: reasons,
            score: Math.round(total * 10) / 10,
            eta: eta,
            cost: cost,
            effRange: effRange,
            margin: ac.payload - order.weight,
            detail: {
                载重: Math.round(sPayload), 航程: Math.round(sRange),
                电池: Math.round(sSoh), 时效: Math.round(sTime),
                成本: Math.round(sCost), 抗风: Math.round(sWind)
            }
        };
    }

    /** 单工单候选排序（Top-N） */
    function rankFleet(order, fleet, ctx) {
        return fleet.map(function(ac) { return scoreAircraft(order, ac, ctx); })
            .sort(function(a, b) { return b.score - a.score; });
    }

    // ================================================================
    // 4. 全局最优指派：匈牙利算法（Kuhn–Munkres / Jonker-Volgenant）
    // ================================================================

    /**
     * 最小成本二分匹配，O(n²m)，要求 n ≤ m
     * @param {number[][]} cost n×m 矩阵
     * @returns {{rowToCol: number[], total: number}} rowToCol[i] = 分配给第 i 行的列号（-1 表示未分配）
     */
    function hungarianMin(cost) {
        var n = cost.length;
        if (n === 0) return { rowToCol: [], total: 0 };
        var m = cost[0].length;
        if (m === 0) return { rowToCol: new Array(n).fill(-1), total: 0 };
        if (n > m) throw new Error('hungarianMin 要求行数 ≤ 列数（当前 ' + n + ' > ' + m + '）');

        var INF = Infinity;
        var u = new Array(n + 1).fill(0);
        var v = new Array(m + 1).fill(0);
        var p = new Array(m + 1).fill(0);      // p[j] = 匹配到列 j 的行（1-based）
        var way = new Array(m + 1).fill(0);

        for (var i = 1; i <= n; i++) {
            p[0] = i;
            var j0 = 0;
            var minv = new Array(m + 1).fill(INF);
            var used = new Array(m + 1).fill(false);

            do {
                used[j0] = true;
                var i0 = p[j0];
                var delta = INF, j1 = 0;
                for (var j = 1; j <= m; j++) {
                    if (used[j]) continue;
                    var cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
                if (j1 === 0) break;           // 无可用列（理论上不会发生）
                for (var j2 = 0; j2 <= m; j2++) {
                    if (used[j2]) { u[p[j2]] += delta; v[j2] -= delta; }
                    else minv[j2] -= delta;
                }
                j0 = j1;
            } while (p[j0] !== 0);

            // 增广路回溯
            do {
                var jn = way[j0];
                p[j0] = p[jn];
                j0 = jn;
            } while (j0 !== 0);
        }

        var rowToCol = new Array(n).fill(-1);
        for (var jj = 1; jj <= m; jj++) if (p[jj] > 0) rowToCol[p[jj] - 1] = jj - 1;

        var total = 0;
        for (var r = 0; r < n; r++) if (rowToCol[r] >= 0) total += cost[r][rowToCol[r]];
        return { rowToCol: rowToCol, total: total };
    }

    /**
     * 最大权二分指派（支持"不分配"）
     *
     * 关键设计：始终额外补 n 个「虚拟列」代表"这个工单不派"。
     * 否则当槽位数 ≥ 工单数时，算法会被迫把工单塞给它并不想要的机型；
     * 有了虚拟列，"宁可不派"才有表达空间。
     *
     * @param {number[][]} score n×m 分数矩阵，越大越好；null/-Infinity 表示禁止
     * @param {object} opts { minScore } 低于 minScore 的分配不如不派
     * @returns {{rowToCol:number[], total:number, unassigned:number[]}}
     */
    function maxAssignment(score, opts) {
        opts = opts || {};
        var minScore = opts.minScore === undefined ? 35 : opts.minScore;
        var n = score.length;
        if (n === 0) return { rowToCol: [], total: 0, unassigned: [] };
        var m = score[0].length;

        // 以「最高分」为基准，把最大化转成最小化
        var maxV = -Infinity;
        for (var i = 0; i < n; i++) {
            for (var j = 0; j < m; j++) {
                var s = score[i][j];
                if (isFiniteScore(s) && s > maxV) maxV = s;
            }
        }
        if (maxV === -Infinity) {
            var all = [];
            for (var k = 0; k < n; k++) all.push(k);
            return { rowToCol: new Array(n).fill(-1), total: 0, unassigned: all };
        }

        // cost 设计要点：必须让「总 cost」与「总 score」严格线性对应，
        // 否则最小化 cost 并不等价于最大化 score。
        //   总cost = Σ(maxV − score) + Σ ZERO = n·maxV − Σscore
        // 因此「不分配」的代价必须等价于「0 分收益」(ZERO = maxV)，
        // 绝不能便宜它——否则算法会为了少派而少派。
        var FORBID = 1e9;   // 绝对禁止（null）
        var ZERO = maxV;    // 等价于 0 分：低于阈值的槽位、以及"不派"
        var totalCols = m + n;

        var cost = [];
        for (var i2 = 0; i2 < n; i2++) {
            var row = [];
            for (var j2 = 0; j2 < m; j2++) {
                var s2 = score[i2][j2];
                if (!isFiniteScore(s2)) row.push(FORBID);
                else if (s2 < minScore) row.push(ZERO);      // 不值得派，与不派等价
                else row.push(maxV - s2);
            }
            for (var v = 0; v < n; v++) row.push(ZERO);      // 虚拟列：不派
            cost.push(row);
        }

        var res = hungarianMin(cost);
        var rowToCol = new Array(n).fill(-1);
        var total = 0, unassigned = [];
        for (var r = 0; r < n; r++) {
            var c = res.rowToCol[r];
            var s3 = (c >= 0 && c < m) ? score[r][c] : null;
            if (isFiniteScore(s3) && s3 >= minScore) {
                rowToCol[r] = c;
                total += s3;
            } else {
                rowToCol[r] = -1;
                unassigned.push(r);
            }
        }
        return { rowToCol: rowToCol, total: total, unassigned: unassigned };
    }

    function isFiniteScore(s) {
        return s !== null && s !== undefined && typeof s === 'number' && isFinite(s);
    }

    /**
     * 把机型库存展开成可指派槽位
     * 例：固定翼 unit=4 → FG-07#01..#04
     */
    function expandSlots(fleet) {
        var slots = [];
        fleet.forEach(function(ac) {
            var n = Math.max(1, ac.unit || 1);
            for (var i = 1; i <= n; i++) {
                slots.push({
                    fleetId: ac.id,
                    slotNo: i,
                    slotId: ac.id + '#' + String(i).padStart(2, '0'),
                    name: ac.name,
                    payload: ac.payload, range: ac.range, speed: ac.speed,
                    soh: ac.soh, windMax: ac.windMax, baseCost: ac.baseCost,
                    kind: ac.kind, craft: ac.craft
                });
            }
        });
        return slots;
    }

    /**
     * 贪心指派（对照基准）：按工单顺序，各自挑当前剩余的最高分槽位
     * @param {object} [opts.scoreMatrix] 可直接传入分数矩阵，用于与全局最优做同口径对比
     */
    function greedyAssign(orders, slots, ctx, opts) {
        opts = opts || {};
        var minScore = opts.minScore === undefined ? 35 : opts.minScore;
        var mat = opts.scoreMatrix;
        var usedSlot = new Array(slots.length).fill(false);
        var pairs = [], total = 0;

        orders.forEach(function(order, oi) {
            var best = -1, bestScore = -Infinity;
            for (var s = 0; s < slots.length; s++) {
                if (usedSlot[s]) continue;
                var sc;
                if (mat) {
                    sc = { feasible: isFiniteScore(mat[oi][s]), score: mat[oi][s] };
                } else {
                    sc = scoreAircraft(order, slots[s], ctx);
                }
                if (sc.feasible && sc.score > bestScore) { bestScore = sc.score; best = s; }
            }
            if (best >= 0 && bestScore >= minScore) {
                usedSlot[best] = true;
                pairs.push({ orderIndex: oi, slotIndex: best, score: bestScore });
                total += bestScore;
            } else {
                pairs.push({ orderIndex: oi, slotIndex: -1, score: 0 });
            }
        });
        return { pairs: pairs, total: total };
    }

    /**
     * 全局最优指派 vs 贪心，输出对比
     *
     * 为什么需要全局优化：贪心会为了眼前最高分抢占多工单争抢的稀缺机型，
     * 导致后面本可以匹配的工单无可用运力——这正是"局部最优 ≠ 全局最优"。
     */
    function assignFleet(orders, fleet, ctx, opts) {
        opts = opts || {};
        var slots = expandSlots(fleet);
        var minScore = opts.minScore === undefined ? 35 : opts.minScore;

        var score = orders.map(function(order) {
            return slots.map(function(slot) {
                var sc = scoreAircraft(order, slot, ctx);
                return sc.feasible ? sc.score : null;
            });
        });

        var opt = maxAssignment(score, { minScore: minScore });
        var greedy = greedyAssign(orders, slots, ctx, { minScore: minScore });

        // 情景约束下真正可用的槽位数（用于展示运力紧张度）
        var usable = slots.filter(function(slot) {
            return slot.soh >= SO_MIN && (ctx.windBase || 0) <= slot.windMax;
        }).length;

        return {
            optimal: {
                total: Math.round(opt.total * 10) / 10,
                pairs: opt.rowToCol.map(function(si, oi) {
                    return {
                        order: orders[oi],
                        slot: si >= 0 ? slots[si] : null,
                        score: si >= 0 ? score[oi][si] : 0
                    };
                }),
                assignedCount: opt.rowToCol.filter(function(x) { return x >= 0; }).length,
                unassignedCount: opt.unassigned.length
            },
            greedy: { total: Math.round(greedy.total * 10) / 10, pairs: greedy.pairs },
            improvement: greedy.total > 0
                ? Math.round((opt.total - greedy.total) / greedy.total * 1000) / 10
                : 0,
            slotCount: slots.length,
            usableSlots: usable
        };
    }

    // ================================================================
    // 5. 仿生控制：串级 PID 侧风抗扰仿真
    // ================================================================

    var CRAFT_MODELS = {
        '无锁落地窗': { zeta: 0.18, wn: 9.0, humanW: 0.60, tag: '空心薄壁单点 · 极易滑脱形变', color: '#EF5350' },
        '推拉活动窗': { zeta: 0.45, wn: 12.0, humanW: 0.40, tag: '轻型异形易偏移 · 侧风影响显著', color: '#D4A040' },
        '多点锁平开窗': { zeta: 0.72, wn: 16.0, humanW: 0.20, tag: '多电机冗余稳态 · 抗扰动能力强', color: '#27AE60' }
    };

    /**
     * 外环 10Hz 航线锁定 + 内环 200Hz 姿态抑制，t=1.5s 注入侧风阶跃
     * @param {object} cfg {craft, kp, ki, kd, wind, duration, windAt}
     */
    function simulateCascade(cfg) {
        var m = CRAFT_MODELS[cfg.craft] || CRAFT_MODELS['多点锁平开窗'];
        var dt = 0.005;
        var T = cfg.duration || 8.0;
        var windAt = cfg.windAt === undefined ? 1.5 : cfg.windAt;
        var steps = Math.round(T / dt);
        var outerEvery = Math.round(0.1 / dt);       // 10Hz

        var x = 0, xd = 0;                           // 横向航迹偏差 (m)
        var th = 0, thd = 0;                         // 姿态角 (rad)
        var iOut = 0, prevErr = 0, thCmd = 0;
        var series = [], windSeries = [];
        var peak = 0, settleTime = null;
        var g = 9.81, kWind = 0.90;                  // 15m/s 侧风应造成米级偏移

        for (var k = 0; k < steps; k++) {
            var t = k * dt;
            var wind = (t >= windAt) ? cfg.wind * kWind : 0;

            // —— 外环（航线）：10Hz ——
            if (k % outerEvery === 0) {
                var err = 0 - x;
                iOut += err * outerEvery * dt;
                iOut = clamp(iOut, -8, 8);
                var dErr = (err - prevErr) / (outerEvery * dt);
                prevErr = err;
                thCmd = clamp(cfg.kp * err + cfg.ki * iOut + cfg.kd * dErr, -0.6, 0.6);
            }

            // —— 内环（姿态）：200Hz 抑制 ——
            var eTh = thCmd - th;
            var u = 4.0 * eTh - 0.35 * thd;
            var thdd = m.wn * m.wn * (u - th) - 2 * m.zeta * m.wn * thd + wind;
            thd += thdd * dt;
            th += thd * dt;
            th = clamp(th, -0.7, 0.7);

            var xdd = g * th - 1.2 * xd;             // 倾角 → 水平加速度，含空气阻尼
            xd += xdd * dt;
            x += xd * dt;

            if (t >= windAt && Math.abs(x) > peak) peak = Math.abs(x);
            if (k % 4 === 0) {
                series.push([+t.toFixed(3), +x.toFixed(4)]);
                windSeries.push([+t.toFixed(3), +(t >= windAt ? cfg.wind : 0)]);
            }
        }

        // 调节时间：扰动后最后一次越出 ±5cm 带的时刻
        var band = 0.05;
        for (var n = series.length - 1; n >= 0; n--) {
            if (series[n][0] < windAt) break;
            if (Math.abs(series[n][1]) > band) { settleTime = series[n][0] - windAt; break; }
        }
        if (settleTime === null) settleTime = 0;

        var steadyErr = Math.abs(series[series.length - 1][1]);
        return {
            series: series,
            windSeries: windSeries,
            peak: peak,
            settle: +settleTime.toFixed(2),
            steady: +steadyErr.toFixed(3),
            overshoot: steadyErr > 0.001 ? +(peak / steadyErr).toFixed(2) : 0,
            humanW: m.humanW,
            zeta: m.zeta,
            wn: m.wn,
            tag: m.tag,
            color: m.color
        };
    }

    /** 控制品质评级：A/B/C/D */
    function gradeCascade(r) {
        if (r.steady < 0.02 && r.settle < 3.2) return { grade: 'A', text: '稳态几乎无偏，扰动 3s 内收敛，可放心投入商业飞行。', color: 'success' };
        if (r.steady < 0.08 && r.settle < 5.0) return { grade: 'B', text: '可接受，乘客能感知轻微偏移，建议增大 I 消除稳态差。', color: 'gold' };
        if (r.steady < 0.30) return { grade: 'C', text: '偏差偏大，建议提高 P 或切换至多点锁平开窗机型。', color: 'danger' };
        return { grade: 'D', text: '已失控，积分饱和或增益过低，请立即复位参数。', color: 'danger' };
    }

    // ================================================================
    // 6. 应急策略匹配
    // ================================================================

    var DEFAULT_STRATEGIES = [
        { id: 'evacuation', name: '优先疏散型', desc: '火势/洪水蔓延快时，立即疏散危险区域', icon: '🚨', weight: 10,
            condition: function(d) { return d.fireLevel >= 7 || (d.disasterType === 'flood' && d.evacuees > 80); } },
        { id: 'supply', name: '物资投放型', desc: '灾区物资短缺时，空投紧急物资', icon: '🎁', weight: 9,
            condition: function(d) { return d.supplyGap > 150; } },
        { id: 'comm', name: '通信恢复型', desc: '通信中断时，派遣无人机中继恢复通信', icon: '📡', weight: 8,
            condition: function(d) { return d.commStatus === 'interrupted'; } },
        { id: 'search', name: '搜救探测型', desc: '有被困人员时，热成像扫描搜索生命迹象', icon: '🔍', weight: 7,
            condition: function(d) { return d.trapped > 0; } },
        { id: 'shelter', name: '安置点分配型', desc: '疏散人数超预期时，启用备用安置点', icon: '🏠', weight: 6,
            condition: function(d) { return d.evacuees > 100; } },
        { id: 'monitor', name: '监测评估型', desc: '持续监测并评估灾害态势，提供数据支持', icon: '📊', weight: 5,
            condition: function() { return true; } }
    ];

    function matchStrategy(data, strategies) {
        var list = strategies || DEFAULT_STRATEGIES;
        var scored = list.map(function(s) {
            var matched = !!s.condition(data);
            var conf = matched ? s.weight : 0;
            if (matched) {
                if (s.id === 'evacuation' && data.fireLevel >= 8) conf += 2;
                if (s.id === 'supply' && data.supplyGap > 300) conf += 2;
                if (s.id === 'search' && data.trapped > 50) conf += 2;
                if (s.id === 'shelter' && data.evacuees > 200) conf += 2;
                conf = Math.min(conf, 12);
            }
            return { id: s.id, name: s.name, desc: s.desc, icon: s.icon, matched: matched, conf: conf };
        });
        var hit = scored.filter(function(s) { return s.matched; });
        if (!hit.length) {
            var fb = scored.filter(function(s) { return s.id === 'monitor'; })[0] || scored[scored.length - 1];
            return { id: fb.id, name: fb.name, desc: fb.desc, icon: fb.icon, conf: 3, matched: true };
        }
        hit.sort(function(a, b) { return b.conf - a.conf; });
        return hit[0];
    }

    // ================================================================
    // 7. 风控 Agent + Guardrail
    //
    // 设计原则（这三条决定了它能不能真的拦住错误）：
    //   1. Agent 是"判断"，Guardrail 是"复算" —— Guardrail 不读 Agent 的结论，
    //      而是对最终方案独立重跑物理约束。Agent 漏判时它仍能拦下。
    //   2. 级别只有 BLOCK / WARN 两种。BLOCK 必须阻断，没有"商量的余地"。
    //   3. 全程纯函数、无副作用 —— 因此可单测、可复现、可审计。
    // ================================================================

    var SEVERITY = { BLOCK: 'BLOCK', WARN: 'WARN', PASS: 'PASS' };

    /**
     * 风控规则库
     * 每条规则是纯函数：给定 ctx，返回 null（通过）或违规对象
     * ctx = {
     *   scenario: {windBase, congestion, demand, weatherIdx, equilibrium, fStar, ...},
     *   kelly:    {f, fStar, ruinProb, geoGrowth},
     *   plan:     {pairs:[{order, slot, score}], assignedCount, unassignedCount},
     *   slots:    [...], orders: [...]
     * }
     */
    var RISK_RULES = [
        {
            id: 'SOH_FLOOR',
            name: '电池健康下限',
            severity: SEVERITY.BLOCK,
            why: 'SOH 低于 60% 的电池在高负载下可能空中掉电',
            check: function(ctx) {
                var bad = (ctx.plan.pairs || []).filter(function(p) {
                    return p.slot && p.slot.soh < SO_MIN;
                });
                if (!bad.length) return null;
                return {
                    detail: bad.map(function(p) { return p.slot.slotId + ' SOH ' + p.slot.soh + '%'; }),
                    fix: '改用 SOH ≥ ' + SO_MIN + '% 的机型，或将该工单转为地面运输'
                };
            }
        },
        {
            id: 'WIND_LIMIT',
            name: '抗风上限',
            severity: SEVERITY.BLOCK,
            why: '侧风超过机型抗风上限会导致姿态失控',
            check: function(ctx) {
                var wind = ctx.scenario.windBase || 0;
                var bad = (ctx.plan.pairs || []).filter(function(p) {
                    return p.slot && wind > p.slot.windMax;
                });
                if (!bad.length) return null;
                return {
                    detail: bad.map(function(p) { return p.slot.slotId + ' 抗风 ' + p.slot.windMax + 'm/s < ' + wind + 'm/s'; }),
                    fix: '切换至抗风更强的多点锁平开窗机型，或等待风速回落'
                };
            }
        },
        {
            id: 'PAYLOAD_LIMIT',
            name: '载重上限',
            severity: SEVERITY.BLOCK,
            why: '超载会直接导致无法起飞',
            check: function(ctx) {
                var bad = (ctx.plan.pairs || []).filter(function(p) {
                    return p.slot && p.order && p.order.weight > p.slot.payload;
                });
                if (!bad.length) return null;
                return {
                    detail: bad.map(function(p) { return '#' + p.order.id + ' ' + p.order.weight + 'kg > ' + p.slot.payload + 'kg'; }),
                    fix: '拆分货量或改用更大载重机型'
                };
            }
        },
        {
            id: 'ETA_DEADLINE',
            name: '时效违约',
            severity: SEVERITY.BLOCK,
            why: '预计到达时间超过客户时限',
            check: function(ctx) {
                var bad = [];
                (ctx.plan.pairs || []).forEach(function(p) {
                    if (!p.slot || !p.order) return;
                    var eta = (p.order.distance / p.slot.speed) * 60 + 8;
                    if (eta > p.order.deadline) bad.push('#' + p.order.id + ' ' + eta.toFixed(0) + 'min > ' + p.order.deadline + 'min');
                });
                if (!bad.length) return null;
                return { detail: bad, fix: '改用更快机型，或与客户重新协商时限' };
            }
        },
        {
            id: 'NEGATIVE_EDGE',
            name: '负期望重仓',
            severity: SEVERITY.BLOCK,
            why: '凯利建议值 ≤0 意味着期望亏损，此时重仓会持续失血',
            check: function(ctx) {
                var k = ctx.kelly;
                if (!k) return null;
                if (k.fStar > 0) return null;
                if (!(k.f > 0.05)) return null;        // 空仓则无风险
                return {
                    detail: ['f* = ' + k.fStar.toFixed(3) + ' ≤ 0，而实际仓位 f = ' + k.f.toFixed(2)],
                    fix: '立即降至空仓或反向对冲，当前结构不值得投入'
                };
            }
        },
        {
            id: 'RUIN_RISK',
            name: '破产概率',
            severity: SEVERITY.BLOCK,
            why: '长期运行下本金归零概率过高',
            check: function(ctx) {
                var k = ctx.kelly;
                if (!k || k.f <= 0) return null;
                if (!(k.ruinProb > 0.30)) return null;
                var pd = (k.periods || 120);
                return {
                    detail: [pd + ' 期推演下破产概率 ' + (k.ruinProb * 100).toFixed(1) + '%'],
                    fix: '下调仓位至 f* = ' + (k.fStar > 0 ? k.fStar.toFixed(2) : '0') + ' 附近'
                };
            }
        },
        {
            id: 'CIRCUIT_BREAKER',
            name: '系统熔断',
            severity: SEVERITY.BLOCK,
            why: '均衡度进入熔断区，全域调度应停止接新单',
            check: function(ctx) {
                var eq = ctx.scenario.equilibrium;
                if (eq === undefined || eq === null) return null;
                if (!(eq >= 0.80)) return null;
                return {
                    detail: ['均衡度 ' + eq.toFixed(2) + ' ≥ 0.80（熔断区）'],
                    fix: '暂停接单，优先消化在途任务'
                };
            }
        },
        {
            id: 'RUIN_WATCH',
            name: '破产概率偏高',
            severity: SEVERITY.WARN,
            why: '破产概率进入警戒区间',
            check: function(ctx) {
                var k = ctx.kelly;
                if (!k || k.f <= 0) return null;
                if (!(k.ruinProb > 0.05 && k.ruinProb <= 0.30)) return null;
                return {
                    detail: ['破产概率 ' + (k.ruinProb * 100).toFixed(1) + '%'],
                    fix: '考虑适度下调仓位'
                };
            }
        },
        {
            id: 'MARGIN_DISPATCH',
            name: '低分派遣',
            severity: SEVERITY.WARN,
            why: '匹配分数过低仍执行，性价比差',
            check: function(ctx) {
                var bad = (ctx.plan.pairs || []).filter(function(p) {
                    return p.slot && p.score < 50;
                });
                if (!bad.length) return null;
                return {
                    detail: bad.map(function(p) { return '#' + p.order.id + ' 仅 ' + p.score + ' 分'; }),
                    fix: '评估是否延后至运力充裕时段'
                };
            }
        },
        {
            id: 'CONCENTRATION',
            name: '机型集中度',
            severity: SEVERITY.WARN,
            why: '过多工单压在单一机型上，该机型故障会导致大面积瘫痪',
            check: function(ctx) {
                var assigned = (ctx.plan.pairs || []).filter(function(p) { return p.slot; });
                if (assigned.length < 3) return null;
                var byFleet = {};
                assigned.forEach(function(p) { byFleet[p.slot.fleetId] = (byFleet[p.slot.fleetId] || 0) + 1; });
                var top = Object.keys(byFleet).map(function(k) { return { id: k, n: byFleet[k] }; })
                    .sort(function(a, b) { return b.n - a.n; })[0];
                if (!top || top.n / assigned.length <= 0.60) return null;
                return {
                    detail: [top.id + ' 承担 ' + top.n + '/' + assigned.length + ' 单（' + Math.round(top.n / assigned.length * 100) + '%）'],
                    fix: '向其他机型分散，保留冗余运力'
                };
            }
        },
        {
            id: 'CAPACITY_SHORT',
            name: '运力缺口',
            severity: SEVERITY.WARN,
            why: '存在无法指派的工单',
            check: function(ctx) {
                var n = ctx.plan.unassignedCount || 0;
                if (!n) return null;
                return {
                    detail: [n + ' 个工单无可用运力'],
                    fix: '考虑外包、延后或提升机队规模'
                };
            }
        }
    ];

    /**
     * 风控 Agent：对当前决策上下文执行全部规则
     * @returns {{level, blocks:Array, warns:Array, passed:boolean}}
     */
    function evaluateRisk(ctx) {
        ctx = ctx || {};
        ctx.scenario = ctx.scenario || {};
        ctx.plan = ctx.plan || { pairs: [], assignedCount: 0, unassignedCount: 0 };
        ctx.plan.pairs = ctx.plan.pairs || [];

        var blocks = [], warns = [];
        RISK_RULES.forEach(function(rule) {
            var hit;
            try {
                hit = rule.check(ctx);
            } catch (e) {
                // 规则自身异常不能让风控静默失效 —— 显式升级为 BLOCK
                blocks.push({
                    id: rule.id, name: rule.name, severity: SEVERITY.BLOCK,
                    why: rule.why, detail: ['规则执行异常: ' + e.message], fix: '请检查输入数据完整性'
                });
                return;
            }
            if (!hit) return;
            var v = {
                id: rule.id, name: rule.name, severity: rule.severity,
                why: rule.why, detail: hit.detail || [], fix: hit.fix || ''
            };
            (rule.severity === SEVERITY.BLOCK ? blocks : warns).push(v);
        });

        return {
            level: blocks.length ? SEVERITY.BLOCK : (warns.length ? SEVERITY.WARN : SEVERITY.PASS),
            blocks: blocks,
            warns: warns,
            passed: blocks.length === 0,
            checkedAt: null   // 由调用方注入时间戳，保持纯函数
        };
    }

    /**
     * Guardrail：对最终方案做独立硬校验
     *
     * 与 evaluateRisk 的关键区别：
     *   - 它**不读** Agent 的任何结论，而是直接对 plan 重算物理约束
     *   - 即便 Agent 被禁用、被绕过、或返回空结果，Guardrail 依然生效
     *   - 返回 forcedActions：被强制剔除的指派（降级为"不派"）
     *
     * @returns {{passed:boolean, violations:Array, forcedActions:Array, safePlan:Object}}
     */
    function guardrail(plan, ctx) {
        ctx = ctx || {};
        var wind = (ctx.scenario && ctx.scenario.windBase) || 0;
        var pairs = (plan && plan.pairs) || [];
        var violations = [], forcedActions = [];
        var safe = [];

        pairs.forEach(function(p, idx) {
            if (!p.slot || !p.order) { safe.push(p); return; }
            var s = p.slot, o = p.order;
            var reasons = [];

            // 以下四条是不可协商的物理约束，逐条独立复算
            if (s.soh < SO_MIN) reasons.push('SOH ' + s.soh + '% < ' + SO_MIN + '%');
            if (wind > s.windMax) reasons.push('侧风 ' + wind + 'm/s > 上限 ' + s.windMax + 'm/s');
            if (o.weight > s.payload) reasons.push('载重 ' + o.weight + 'kg > ' + s.payload + 'kg');
            var eta = (o.distance / s.speed) * 60 + 8;
            if (eta > o.deadline) reasons.push('ETA ' + eta.toFixed(0) + 'min > 时限 ' + o.deadline + 'min');

            if (reasons.length) {
                violations.push({
                    orderId: o.id, slotId: s.slotId, reasons: reasons,
                    action: '已强制剔除该指派（降级为不派）'
                });
                forcedActions.push({ index: idx, orderId: o.id, slotId: s.slotId, reasons: reasons });
                safe.push({ order: o, slot: null, score: 0, blockedBy: 'guardrail' });
            } else {
                safe.push(p);
            }
        });

        var safeAssigned = safe.filter(function(p) { return p.slot; }).length;
        return {
            passed: violations.length === 0,
            violations: violations,
            forcedActions: forcedActions,
            safePlan: {
                pairs: safe,
                assignedCount: safeAssigned,
                unassignedCount: safe.length - safeAssigned,
                total: safe.reduce(function(a, p) { return a + (p.score || 0); }, 0)
            }
        };
    }

    /**
     * 生成人类可读的裁决说明（用于 UI 与审计日志）
     */
    function explainRisk(assessment) {
        if (!assessment) return '未执行风控';
        if (assessment.level === SEVERITY.PASS) {
            return '✅ 全部 ' + RISK_RULES.length + ' 条规则通过，未发现阻断项。';
        }
        var parts = [];
        if (assessment.blocks.length) {
            parts.push('🚫 ' + assessment.blocks.length + ' 项阻断：' +
                assessment.blocks.map(function(b) { return b.name; }).join('、'));
        }
        if (assessment.warns.length) {
            parts.push('⚠️ ' + assessment.warns.length + ' 项警告：' +
                assessment.warns.map(function(w) { return w.name; }).join('、'));
        }
        return parts.join('；') + '。';
    }

    // ================================================================
    // 导出
    // ================================================================
    return {
        // 工具
        clamp: clamp, lerp: lerp, mulberry32: mulberry32, quantile: quantile,
        // 博弈
        kellyFraction: kellyFraction,
        kellyGrowthRate: kellyGrowthRate,
        kellyCurve: kellyCurve,
        kellyMonteCarlo: kellyMonteCarlo,
        // 定价
        PRICE_TIERS: PRICE_TIERS, tierRate: tierRate, quoteCost: quoteCost,
        // 运力
        SO_MIN: SO_MIN, SCORE_WEIGHTS: SCORE_WEIGHTS,
        scoreAircraft: scoreAircraft, rankFleet: rankFleet,
        hungarianMin: hungarianMin, maxAssignment: maxAssignment,
        expandSlots: expandSlots, greedyAssign: greedyAssign, assignFleet: assignFleet,
        // 控制
        CRAFT_MODELS: CRAFT_MODELS, simulateCascade: simulateCascade, gradeCascade: gradeCascade,
        // 应急
        DEFAULT_STRATEGIES: DEFAULT_STRATEGIES, matchStrategy: matchStrategy,
        // 风控
        SEVERITY: SEVERITY, RISK_RULES: RISK_RULES,
        evaluateRisk: evaluateRisk, guardrail: guardrail, explainRisk: explainRisk
    };
});
