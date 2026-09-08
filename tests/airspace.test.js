/**
 * 空域地理 + 禁飞区入侵检测 单元测试
 * 运行： node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/js/core/algorithms.js');

const CD = { lng: 104.0665, lat: 30.5723 };   // 成都

// ================================================================
// 1. 球面距离与方位
// ================================================================
test('haversineKm：已知距离正确', () => {
    // 同一经度，纬度差 1° ≈ 111.19 km
    const d = A.haversineKm({ lng: 104, lat: 30 }, { lng: 104, lat: 31 });
    assert.ok(Math.abs(d - 111.19) < 1.5, `纬度 1° 应约 111km，实际 ${d}`);
    // 赤道经度差 1° ≈ 111.32 km
    const d2 = A.haversineKm({ lng: 0, lat: 0 }, { lng: 1, lat: 0 });
    assert.ok(Math.abs(d2 - 111.32) < 0.5, `赤道经度 1° 应约 111.32km，实际 ${d2}`);
});

test('haversineKm：对称性与零距离', () => {
    const a = { lng: 104.1, lat: 30.5 }, b = { lng: 104.4, lat: 30.8 };
    assert.ok(Math.abs(A.haversineKm(a, b) - A.haversineKm(b, a)) < 1e-9, '应满足对称性');
    assert.equal(A.haversineKm(a, a), 0);
});

test('bearingDeg：四个基本方向正确', () => {
    const o = { lng: 104, lat: 30 };
    assert.ok(Math.abs(A.bearingDeg(o, { lng: 104, lat: 31 }) - 0) < 0.5, '正北应为 0°');
    assert.ok(Math.abs(A.bearingDeg(o, { lng: 105, lat: 30 }) - 90) < 0.5, '正东应为 90°');
    assert.ok(Math.abs(A.bearingDeg(o, { lng: 104, lat: 29 }) - 180) < 0.5, '正南应为 180°');
    assert.ok(Math.abs(A.bearingDeg(o, { lng: 103, lat: 30 }) - 270) < 0.5, '正西应为 270°');
});

test('bearingDeg：结果始终落在 [0,360)', () => {
    const rnd = A.mulberry32(5);
    for (let i = 0; i < 100; i++) {
        const a = { lng: rnd() * 360 - 180, lat: rnd() * 170 - 85 };
        const b = { lng: rnd() * 360 - 180, lat: rnd() * 170 - 85 };
        const br = A.bearingDeg(a, b);
        assert.ok(br >= 0 && br < 360, `方位角越界: ${br}`);
    }
});

test('lerpGeo：端点与中点正确', () => {
    const a = { lng: 104, lat: 30 }, b = { lng: 105, lat: 31 };
    assert.deepEqual(A.lerpGeo(a, b, 0), { lng: 104, lat: 30 });
    assert.deepEqual(A.lerpGeo(a, b, 1), { lng: 105, lat: 31 });
    const m = A.lerpGeo(a, b, 0.5);
    assert.ok(Math.abs(m.lng - 104.5) < 1e-9 && Math.abs(m.lat - 30.5) < 1e-9);
});

// ================================================================
// 2. 航线
// ================================================================
const route = [
    { lng: 104.0, lat: 30.5 },
    { lng: 104.2, lat: 30.6 },
    { lng: 104.4, lat: 30.7 }
];

test('routeLengths：累积长度单调递增', () => {
    const cum = A.routeLengths(route);
    assert.equal(cum.length, 3);
    assert.equal(cum[0], 0);
    assert.ok(cum[1] > 0 && cum[2] > cum[1], '累积长度应严格递增');
});

test('★ routePointAt：端点精确、中间连续、朝向合理', () => {
    const p0 = A.routePointAt(route, 0);
    assert.ok(Math.abs(p0.lng - 104.0) < 1e-9 && Math.abs(p0.lat - 30.5) < 1e-9, '起点应精确');

    const p1 = A.routePointAt(route, 1);
    assert.ok(Math.abs(p1.lng - 104.4) < 1e-9 && Math.abs(p1.lat - 30.7) < 1e-9, '终点应精确');

    // 中间点应落在航线上：到相邻航点距离和 ≈ 段长
    const mid = A.routePointAt(route, 0.5);
    assert.ok(mid.lng > 104.0 && mid.lng < 104.4, '中点应在起终点之间');
    assert.ok(mid.heading >= 0 && mid.heading < 360);

    // 连续性：t 微小变化不应导致位置跳变
    let prev = A.routePointAt(route, 0);
    for (let t = 0.01; t <= 1; t += 0.01) {
        const cur = A.routePointAt(route, t);
        const jump = A.haversineKm(prev, cur);
        assert.ok(jump < 2, `t=${t.toFixed(2)} 处位置跳变 ${jump.toFixed(2)}km`);
        prev = cur;
    }
});

test('routePointAt：退化输入不崩溃', () => {
    assert.equal(A.routePointAt([], 0.5), null);
    const one = A.routePointAt([{ lng: 104, lat: 30 }], 0.5);
    assert.equal(one.lng, 104);
    // 零长航线（重复点）
    const dup = A.routePointAt([{ lng: 104, lat: 30 }, { lng: 104, lat: 30 }], 0.5);
    assert.ok(isFinite(dup.lng) && isFinite(dup.lat), '零长航线不应产生 NaN');
});

test('routePointAt：t 会被裁剪到 [0,1]', () => {
    const over = A.routePointAt(route, 1.5);
    const end = A.routePointAt(route, 1);
    assert.ok(Math.abs(over.lng - end.lng) < 1e-9, '超出 1 应裁剪到终点');
    const under = A.routePointAt(route, -0.5);
    const start = A.routePointAt(route, 0);
    assert.ok(Math.abs(under.lng - start.lng) < 1e-9, '小于 0 应裁剪到起点');
});

// ================================================================
// 3. 投影
// ================================================================
const view = { centerLng: 104.0665, centerLat: 30.5723, spanKm: 62, w: 800, h: 360 };

test('projectToCanvas：中心点映射到画布中心', () => {
    const p = A.projectToCanvas(view.centerLng, view.centerLat, view);
    assert.ok(Math.abs(p.x - 400) < 1e-6, `x 应为 400，实际 ${p.x}`);
    assert.ok(Math.abs(p.y - 180) < 1e-6, `y 应为 180，实际 ${p.y}`);
});

test('★ projectToCanvas 与 unprojectFromCanvas 互逆', () => {
    const pts = [
        { lng: 104.0665, lat: 30.5723 },
        { lng: 103.90, lat: 30.70 },
        { lng: 104.44, lat: 30.31 },
        { lng: 104.20, lat: 30.90 }
    ];
    pts.forEach(pt => {
        const px = A.projectToCanvas(pt.lng, pt.lat, view);
        const back = A.unprojectFromCanvas(px.x, px.y, view);
        assert.ok(Math.abs(back.lng - pt.lng) < 1e-9, `经度往返失真: ${pt.lng} → ${back.lng}`);
        assert.ok(Math.abs(back.lat - pt.lat) < 1e-9, `纬度往返失真: ${pt.lat} → ${back.lat}`);
    });
});

test('projectToCanvas：往北纬度增加则 y 减小（屏幕坐标）', () => {
    const south = A.projectToCanvas(104.0665, 30.40, view);
    const north = A.projectToCanvas(104.0665, 30.75, view);
    assert.ok(north.y < south.y, '北方应在屏幕上方（y 更小）');
});

// ================================================================
// 4. 禁飞区入侵检测
// ================================================================
const zones = [
    { id: 'Z1', name: '进近管制区', type: 'circle', center: { lng: 103.90, lat: 30.64 }, radiusKm: 5.2, ceilingM: 900, level: 'block' },
    { id: 'Z2', name: '军事管理区', type: 'circle', center: { lng: 103.87, lat: 30.70 }, radiusKm: 6.0, ceilingM: 300, level: 'warn' },
    {
        id: 'Z3', name: '政务管制区', type: 'poly', ceilingM: 600, level: 'block',
        points: [
            { lng: 104.02, lat: 30.63 }, { lng: 104.10, lat: 30.635 },
            { lng: 104.11, lat: 30.59 }, { lng: 104.03, lat: 30.582 }
        ]
    }
];

test('checkAirspace：区外合规、区内违规', () => {
    const outside = A.checkAirspace({ lng: 104.0665, lat: 30.5723, alt: 200 }, zones);
    assert.equal(outside.length, 0, '区外应无违规');

    const inside = A.checkAirspace({ lng: 103.90, lat: 30.64, alt: 200 }, zones);
    assert.ok(inside.length >= 1, '圆心处应判违规');
    assert.equal(inside[0].zoneId, 'Z1');
});

test('★ 高度上限之上飞越不算违规', () => {
    // 同一水平位置，低空违规、高空合规——这是"净空区"的正确语义
    const low = A.checkAirspace({ lng: 103.90, lat: 30.64, alt: 500 }, zones);
    assert.ok(low.some(b => b.zoneId === 'Z1'), '500m 应在 900m 上限内 → 违规');

    const high = A.checkAirspace({ lng: 103.90, lat: 30.64, alt: 1200 }, zones);
    assert.ok(!high.some(b => b.zoneId === 'Z1'), '1200m 已超过 900m 上限 → 合规');
});

test('checkAirspace：多边形禁飞区生效', () => {
    const inPoly = A.checkAirspace({ lng: 104.065, lat: 30.61, alt: 300 }, zones);
    assert.ok(inPoly.some(b => b.zoneId === 'Z3'), '多边形内部应违规');
    const outPoly = A.checkAirspace({ lng: 104.30, lat: 30.61, alt: 300 }, zones);
    assert.ok(!outPoly.some(b => b.zoneId === 'Z3'), '多边形外部应合规');
});

test('checkAirspace：违规级别被正确保留', () => {
    const r = A.checkAirspace({ lng: 103.87, lat: 30.70, alt: 100 }, zones);
    const warnZone = r.find(b => b.zoneId === 'Z2');
    assert.ok(warnZone, '应检出军事管理区');
    assert.equal(warnZone.level, 'warn');
});

test('pointInCircleKm 边界：判定与实测距离一致（阈值语义为 <=）', () => {
    const c = { lng: 104, lat: 30 };
    assert.equal(A.pointInCircleKm(c, c, 5), true, '圆心必然在内部');

    // 沿正北取一系列点，用 haversine 实测距离交叉验证判定结果。
    // 不去硬编码"纬度 1° = 111.19km"——那个近似值会带来 0.0002km 误差，
    // 足以让"恰好在半径上"的断言翻车。
    [3, 4.9, 5.0, 5.1, 8].forEach(nominalKm => {
        const pt = { lng: 104, lat: 30 + nominalKm / 110.0 };
        const d = A.haversineKm(pt, c);
        assert.equal(
            A.pointInCircleKm(pt, c, 5),
            d <= 5,
            `距圆心 ${d.toFixed(4)}km 时判定应与 (d <= 5) 一致`
        );
    });
});

test('pointInPolygon：已知三角形内外判定', () => {
    const tri = [{ lng: 0, lat: 0 }, { lng: 4, lat: 0 }, { lng: 0, lat: 4 }];
    assert.equal(A.pointInPolygon({ lng: 1, lat: 1 }, tri), true);
    assert.equal(A.pointInPolygon({ lng: 3, lat: 3 }, tri), false, '斜边外侧应为外部');
    assert.equal(A.pointInPolygon({ lng: -1, lat: -1 }, tri), false);
});

test('findAirspaceViolations：只返回违规飞机', () => {
    const fleet = [
        { id: 'a', lng: 104.0665, lat: 30.5723, alt: 200 },   // 合规
        { id: 'b', lng: 103.90, lat: 30.64, alt: 200 },        // 违规 Z1
        { id: 'c', lng: 104.30, lat: 30.90, alt: 200 }         // 合规
    ];
    const v = A.findAirspaceViolations(fleet, zones);
    assert.equal(v.length, 1);
    assert.equal(v[0].ac.id, 'b');
});

test('随机化：违规检测不崩溃且结果自洽', () => {
    const rnd = A.mulberry32(77);
    for (let i = 0; i < 200; i++) {
        const ac = {
            lng: 103.7 + rnd() * 0.8,
            lat: 30.2 + rnd() * 0.8,
            alt: Math.round(rnd() * 1500)
        };
        const b = A.checkAirspace(ac, zones);
        b.forEach(x => {
            assert.ok(x.zoneId && x.zoneName, '违规项应带区域信息');
            assert.ok(['block', 'warn'].includes(x.level));
        });
    }
});

test('★ 起降点不被自身净空区误判（回归：曾导致 39% 误报）', () => {
    // 起降点在机场，净空区圆心不应压在起降点上
    const vertiports = [
        { id: 'V2', name: '双流机场', lng: 103.9471, lat: 30.5785 },
        { id: 'V3', name: '天府机场', lng: 104.4417, lat: 30.3125 }
    ];
    vertiports.forEach(v => {
        const b = A.checkAirspace({ lng: v.lng, lat: v.lat, alt: 120 }, zones);
        assert.equal(b.length, 0,
            `${v.name} 起降点被判违规——净空区不应覆盖起降点本身（否则飞机一起飞就算违规）`);
    });
});
