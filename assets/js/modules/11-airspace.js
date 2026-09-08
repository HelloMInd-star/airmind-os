/*!
 * AirMind V2.3 — 数字孪生空域（Canvas 自绘）
 *
 * 为什么不用 MapLibre / Leaflet 接真实瓦片：
 *   1. 瓦片服务在国内网络下不稳定，面试现场可能直接白屏
 *   2. 引入 ~800KB 依赖，破坏"双击就能跑"与秒开体验
 *   3. 低空态势真正需要的是"空域网格 + 禁飞区 + 航线"，不是街道地图
 * 因此这里用 Canvas 自绘一套指挥中心风格的数字孪生底图，
 * 零外部依赖、离线可用、与项目暗色主题天然一致。
 * 真实数据由 12-livefeed.js 注入（同样带降级）。
 */
'use strict';

// ================================================================
// 空域配置：以成都为原型（真实经纬度，国内低空经济试点城市）
// ================================================================
var AIR_VIEW = {
    centerLng: 104.0665,
    centerLat: 30.5723,
    spanKm: 62
};

var AIR_VERTIPORTS = [
    { id: 'V1', name: '天府广场', lng: 104.0665, lat: 30.6570 },
    { id: 'V2', name: '双流机场', lng: 103.9471, lat: 30.5785 },
    { id: 'V3', name: '天府机场', lng: 104.4417, lat: 30.3125 },
    { id: 'V4', name: '高新南区', lng: 104.0657, lat: 30.5453 },
    { id: 'V5', name: '龙泉驿', lng: 104.2737, lat: 30.5563 },
    { id: 'V6', name: '郫都', lng: 103.8862, lat: 30.7906 },
    { id: 'V7', name: '新津', lng: 103.8086, lat: 30.4170 },
    { id: 'V8', name: '青白江', lng: 104.2490, lat: 30.8800 }
];

// 禁飞区：circle 用中心+半径；poly 用多边形顶点
// ceilingM = 高度上限，从上方飞越不算违规
// 注意：禁飞区刻意不覆盖起降点本身——真实管制中，
// 机场净空区约束的是"穿越与迫近"，本机起降是合法行为。
// 早期版本把禁飞区圆心直接压在机场上，导致 39% 的飞机"一起飞就违规"，
// 那不是安全能力强，是规则建模错了。
var AIR_ZONES = [
    { id: 'NFZ-1', name: '双流进近管制区', type: 'circle', center: { lng: 103.9000, lat: 30.6400 }, radiusKm: 5.2, ceilingM: 900, level: 'block' },
    { id: 'NFZ-2', name: '天府进近管制区', type: 'circle', center: { lng: 104.5200, lat: 30.2700 }, radiusKm: 6.0, ceilingM: 900, level: 'block' },
    {
        id: 'NFZ-3', name: '政务核心管制区', type: 'poly', ceilingM: 600, level: 'block',
        points: [
            { lng: 104.0200, lat: 30.6300 }, { lng: 104.1000, lat: 30.6350 },
            { lng: 104.1100, lat: 30.5900 }, { lng: 104.0300, lat: 30.5820 }
        ]
    },
    { id: 'WRN-1', name: '军事管理区（限高）', type: 'circle', center: { lng: 103.8700, lat: 30.7000 }, radiusKm: 6.0, ceilingM: 300, level: 'warn' }
];

// ================================================================
// 状态
// ================================================================
var airCanvas = null, airCtx = null;
var airAircraft = [];
var airRoutes = [];
var airRunning = true;
var airSpeed = 1;
var airShowZones = true, airShowTrails = true;
var airSelectedId = null;
var airHoverId = null;
var airRafId = null;
var airLastT = 0;
var airFps = 0, airFrameCount = 0, airFpsT0 = 0;
var airView = null;              // {centerLng, centerLat, spanKm, w, h}
var airInitDone = false;
var airDashPhase = 0;
var airSourceLabel = '模拟推演';

// ================================================================
// 航线生成：起降点之间连成网络，带中间航路点（模拟绕飞）
// ================================================================
function airBuildRoutes() {
    var rnd = AirMind.mulberry32(20260308);
    var pairs = [
        [0, 1], [0, 3], [0, 4], [1, 3], [1, 6], [2, 4], [2, 7],
        [3, 4], [3, 5], [4, 7], [5, 6], [5, 0], [6, 1], [7, 2]
    ];
    airRoutes = pairs.map(function(p, idx) {
        var a = AIR_VERTIPORTS[p[0]], b = AIR_VERTIPORTS[p[1]];
        var mid = AirMind.lerpGeo(a, b, 0.5);
        // 航路点做垂直偏移，让航线是弧线而不是直线——真实航线也要绕飞
        var dx = b.lng - a.lng, dy = b.lat - a.lat;
        var off = (rnd() - 0.5) * 0.055;
        mid = { lng: mid.lng - dy * off, lat: mid.lat + dx * off };
        return { id: 'R' + (idx + 1), from: a.id, to: b.id, waypoints: [a, mid, b] };
    });
    return airRoutes;
}

// ================================================================
// 机队生成（带种子，可复现）
// ================================================================
function airBuildFleet(n) {
    var rnd = AirMind.mulberry32(20260309);
    var kinds = [
        { kind: '多旋翼', craft: 'MX-03', spd: 45, alt: [80, 160] },
        { kind: '复合翼', craft: 'FH-11', spd: 70, alt: [120, 260] },
        { kind: '固定翼', craft: 'FG-07', spd: 95, alt: [200, 400] },
        { kind: 'eVTOL', craft: 'VT-21', spd: 130, alt: [150, 320] }
    ];
    airAircraft = [];
    for (var i = 0; i < n; i++) {
        var route = airRoutes[i % airRoutes.length];
        var k = kinds[Math.floor(rnd() * kinds.length)];
        var alt = k.alt[0] + rnd() * (k.alt[1] - k.alt[0]);
        airAircraft.push({
            id: 'A' + String(i + 1).padStart(3, '0'),
            callsign: 'YM' + String(100 + i),
            routeId: route.id,
            waypoints: route.waypoints,
            t: rnd(),                                  // 航程进度 0-1
            dir: route.waypoints,                      // 当前方向（往返会切换）
            reverse: false,
            speedKmh: k.spd * (0.85 + rnd() * 0.3),
            alt: Math.round(alt),
            kind: k.kind, craft: k.craft,
            lng: route.waypoints[0].lng, lat: route.waypoints[0].lat,
            heading: 0,
            trail: [],
            battery: Math.round(55 + rnd() * 45),
            payload: Math.round((1 + rnd() * 12) * 10) / 10
        });
    }
    return airAircraft;
}

/** 推进一帧（dt 秒） */
function airStep(dt) {
    var totalKm = 0;
    airAircraft.forEach(function(ac) {
        var cum = AirMind.routeLengths(ac.waypoints);
        var lenKm = cum[cum.length - 1];
        if (lenKm <= 0) return;
        // 速度 → 进度：dt(秒) × km/h ÷ 3600 ÷ 里程
        var dt2 = ac.t + (ac.speedKmh * dt / 3600) / lenKm;
        if (dt2 >= 1) {
            // 到端点：往返切换，模拟循环执飞
            ac.reverse = !ac.reverse;
            ac.waypoints = ac.reverse ? ac.waypoints.slice().reverse() : ac.waypoints;
            dt2 = 0;
            ac.trail.length = 0;
        }
        ac.t = dt2;
        var p = AirMind.routePointAt(ac.waypoints, ac.t);
        if (p) {
            ac.lng = p.lng; ac.lat = p.lat; ac.heading = p.heading;
            if (airShowTrails) {
                ac.trail.push({ lng: ac.lng, lat: ac.lat });
                if (ac.trail.length > 46) ac.trail.shift();
            }
        }
        totalKm += ac.speedKmh * dt / 3600;
    });
    airDashPhase = (airDashPhase + dt * 22) % 1000;
    return totalKm;
}

// ================================================================
// 渲染
// ================================================================
function airResize() {
    if (!airCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    var rect = airCanvas.getBoundingClientRect();
    var w = Math.max(320, Math.round(rect.width));
    var h = Math.max(200, Math.round(rect.height));
    airCanvas.width = Math.round(w * dpr);
    airCanvas.height = Math.round(h * dpr);
    if (airCtx) airCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    airView = {
        centerLng: AIR_VIEW.centerLng, centerLat: AIR_VIEW.centerLat,
        spanKm: AIR_VIEW.spanKm, w: w, h: h
    };
}

function airColor(name) {
    var st = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (st || '').trim() || '#8b93a7';
}

function airDraw() {
    if (!airCtx || !airView) return;
    var V = airView, c = airCtx;
    var P = function(lng, lat) { return AirMind.projectToCanvas(lng, lat, V); };

    c.clearRect(0, 0, V.w, V.h);

    // —— 背景网格 ——
    c.save();
    c.strokeStyle = 'rgba(90,110,150,0.10)';
    c.lineWidth = 1;
    var step = V.w / 12;
    for (var gx = 0; gx <= V.w; gx += step) {
        c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, V.h); c.stroke();
    }
    for (var gy = 0; gy <= V.h; gy += step) {
        c.beginPath(); c.moveTo(0, gy); c.lineTo(V.w, gy); c.stroke();
    }
    c.restore();

    // —— 比例尺 ——
    c.save();
    c.fillStyle = 'rgba(139,147,167,0.55)';
    c.font = '10px monospace';
    c.fillText('视宽 ≈ ' + V.spanKm.toFixed(0) + ' km', 10, V.h - 10);
    c.restore();

    // —— 禁飞区 ——
    if (airShowZones) {
        AIR_ZONES.forEach(function(z) {
            var isBlock = (z.level || 'block') === 'block';
            var stroke = isBlock ? 'rgba(239,83,80,0.75)' : 'rgba(212,160,64,0.7)';
            var fill = isBlock ? 'rgba(239,83,80,0.10)' : 'rgba(212,160,64,0.09)';
            c.save();
            c.beginPath();
            if (z.type === 'poly') {
                (z.points || []).forEach(function(pt, i) {
                    var q = P(pt.lng, pt.lat);
                    i === 0 ? c.moveTo(q.x, q.y) : c.lineTo(q.x, q.y);
                });
                c.closePath();
            } else {
                var ctr = P(z.center.lng, z.center.lat);
                // 半径换算：km → 像素
                var rPx = (z.radiusKm / V.spanKm) * V.w;
                c.arc(ctr.x, ctr.y, rPx, 0, Math.PI * 2);
            }
            c.fillStyle = fill; c.fill();
            c.setLineDash([6, 4]);
            c.lineDashOffset = -airDashPhase * 0.35;
            c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke();
            c.setLineDash([]);

            // 标签
            var lp = z.type === 'poly'
                ? P((z.points || [])[0].lng, (z.points || [])[0].lat)
                : P(z.center.lng, z.center.lat);
            c.fillStyle = isBlock ? 'rgba(239,83,80,0.9)' : 'rgba(212,160,64,0.9)';
            c.font = '10px -apple-system,"PingFang SC",sans-serif';
            c.fillText((isBlock ? '🚫 ' : '⚠️ ') + z.name, lp.x + 8, lp.y - 4);
            c.restore();
        });
    }

    // —— 航线 ——
    c.save();
    airRoutes.forEach(function(r) {
        c.beginPath();
        r.waypoints.forEach(function(pt, i) {
            var q = P(pt.lng, pt.lat);
            i === 0 ? c.moveTo(q.x, q.y) : c.lineTo(q.x, q.y);
        });
        c.setLineDash([3, 5]);
        c.lineDashOffset = -airDashPhase * 0.5;
        c.strokeStyle = 'rgba(59,130,246,0.28)';
        c.lineWidth = 1.2;
        c.stroke();
    });
    c.restore();

    // —— 航迹 ——
    if (airShowTrails) {
        c.save();
        airAircraft.forEach(function(ac) {
            if (ac.trail.length < 2) return;
            for (var i = 1; i < ac.trail.length; i++) {
                var a = P(ac.trail[i - 1].lng, ac.trail[i - 1].lat);
                var b = P(ac.trail[i].lng, ac.trail[i].lat);
                var alpha = (i / ac.trail.length) * 0.42;
                c.beginPath();
                c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
                c.strokeStyle = 'rgba(212,160,64,' + alpha.toFixed(3) + ')';
                c.lineWidth = 1.6;
                c.stroke();
            }
        });
        c.restore();
    }

    // —— 起降点 ——
    AIR_VERTIPORTS.forEach(function(v) {
        var q = P(v.lng, v.lat);
        c.save();
        c.translate(q.x, q.y);
        c.rotate(Math.PI / 4);
        c.fillStyle = 'rgba(59,130,246,0.85)';
        c.fillRect(-4, -4, 8, 8);
        c.restore();
        c.save();
        c.fillStyle = 'rgba(139,160,200,0.75)';
        c.font = '10px -apple-system,"PingFang SC",sans-serif';
        c.fillText(v.name, q.x + 8, q.y + 3);
        c.restore();
    });

    // —— 航空器 ——
    airAircraft.forEach(function(ac) {
        var q = P(ac.lng, ac.lat);
        var breaches = AirMind.checkAirspace(ac, AIR_ZONES);
        var bad = breaches.length > 0;
        var isSel = ac.id === airSelectedId;
        var isHov = ac.id === airHoverId;

        c.save();
        c.translate(q.x, q.y);

        // 违规光晕
        if (bad) {
            c.beginPath();
            c.arc(0, 0, 13, 0, Math.PI * 2);
            c.fillStyle = 'rgba(239,83,80,0.18)';
            c.fill();
        }
        if (isSel || isHov) {
            c.beginPath();
            c.arc(0, 0, 11, 0, Math.PI * 2);
            c.strokeStyle = isSel ? 'rgba(212,160,64,0.95)' : 'rgba(139,147,167,0.6)';
            c.lineWidth = 1.4;
            c.stroke();
        }

        // 机体：三角形，朝向 = 航向（0=正北）
        c.rotate((ac.heading || 0) * Math.PI / 180);
        c.beginPath();
        c.moveTo(0, -7);
        c.lineTo(4.6, 5.5);
        c.lineTo(0, 3);
        c.lineTo(-4.6, 5.5);
        c.closePath();
        c.fillStyle = bad ? '#EF5350' : (isSel ? '#D4A040' : '#7DD3FC');
        c.fill();
        c.strokeStyle = 'rgba(10,13,21,0.85)';
        c.lineWidth = 0.8;
        c.stroke();
        c.restore();
    });

    // —— 帧率 ——
    airFrameCount++;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (now - airFpsT0 > 500) {
        airFps = Math.round(airFrameCount * 1000 / (now - airFpsT0));
        airFrameCount = 0; airFpsT0 = now;
        var fe = document.getElementById('airFps');
        if (fe) fe.textContent = airFps + ' fps';
    }
}

function airLoop(ts) {
    if (!airCtx) return;
    var t = ts || 0;
    var dt = airLastT ? Math.min(0.1, (t - airLastT) / 1000) : 0.016;
    airLastT = t;
    if (airRunning && !document.hidden) {
        airStep(dt * airSpeed);
    }
    airDraw();
    airUpdateStats();
    airRafId = window.requestAnimationFrame(airLoop);
}

// ================================================================
// 统计面板
// ================================================================
function airUpdateStats() {
    var violations = AirMind.findAirspaceViolations(airAircraft, AIR_ZONES);
    var n = airAircraft.length;
    var avgAlt = n ? Math.round(airAircraft.reduce(function(a, c) { return a + c.alt; }, 0) / n) : 0;

    var ce = document.getElementById('airCount'); if (ce) ce.textContent = n;
    var ve = document.getElementById('airViol');
    if (ve) {
        ve.textContent = violations.length;
        ve.className = 'value ' + (violations.length ? 'danger' : 'success');
    }
    var ae = document.getElementById('airAvgAlt'); if (ae) ae.textContent = avgAlt + ' m';

    var host = document.getElementById('airViolList');
    if (host) {
        host.innerHTML = violations.length
            ? violations.slice(0, 6).map(function(v) {
                var z = v.breaches[0];
                var isBlock = z.level === 'block';
                return '<div style="padding:4px 7px;background:rgba(239,83,80,.09);border-left:2px solid ' +
                    (isBlock ? 'var(--ym-danger)' : 'var(--ym-gold)') + ';border-radius:3px;">' +
                    '<strong style="color:var(--ym-text-primary);">' + v.ac.callsign + '</strong> ' +
                    '闯入 ' + esc(z.zoneName) + ' <span style="color:var(--ym-text-dim);">(' + v.ac.alt + 'm)</span></div>';
            }).join('')
            : '';
    }

    var sel = null;
    for (var i = 0; i < airAircraft.length; i++) if (airAircraft[i].id === airSelectedId) sel = airAircraft[i];
    var sh = document.getElementById('airSelected');
    if (sh) {
        if (!sel) {
            sh.innerHTML = '点击图中航空器查看详情<br/><span style="color:var(--ym-text-dim);">当前 ' +
                n + ' 架在空 · 数据源：' + airSourceLabel + '</span>';
        } else {
            var b = AirMind.checkAirspace(sel, AIR_ZONES);
            sh.innerHTML =
                '<div style="color:var(--ym-text-primary);font-weight:600;">' + sel.callsign +
                ' <span style="color:var(--ym-text-dim);font-weight:400;">' + sel.craft + '</span></div>' +
                '机型 ' + esc(sel.kind) + ' · 航段 ' + sel.routeId + '<br/>' +
                '高度 ' + sel.alt + ' m · 地速 ' + Math.round(sel.speedKmh) + ' km/h<br/>' +
                '航向 ' + Math.round(sel.heading) + '° · 进度 ' + Math.round(sel.t * 100) + '%<br/>' +
                '电量 ' + sel.battery + '% · 载荷 ' + sel.payload + ' kg' +
                (b.length ? '<br/><span style="color:var(--ym-danger);">🚫 ' + esc(b[0].zoneName) + '</span>' : '');
        }
    }
}

// ================================================================
// 交互
// ================================================================
function airPick(mx, my) {
    if (!airView) return null;
    var best = null, bestD = 14;
    airAircraft.forEach(function(ac) {
        var q = AirMind.projectToCanvas(ac.lng, ac.lat, airView);
        var d = Math.sqrt((q.x - mx) * (q.x - mx) + (q.y - my) * (q.y - my));
        if (d < bestD) { bestD = d; best = ac; }
    });
    return best;
}

function airBindEvents() {
    if (!airCanvas) return;

    airCanvas.addEventListener('mousemove', function(e) {
        var rect = airCanvas.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var ac = airPick(mx, my);
        airHoverId = ac ? ac.id : null;
        var tip = document.getElementById('airTip');
        if (tip) {
            if (ac) {
                tip.style.display = 'block';
                tip.style.left = Math.min(mx + 12, rect.width - 150) + 'px';
                tip.style.top = (my + 12) + 'px';
                tip.innerHTML = ac.callsign + ' · ' + ac.kind + '<br/>' +
                    ac.alt + 'm · ' + Math.round(ac.speedKmh) + 'km/h';
            } else {
                tip.style.display = 'none';
            }
        }
        airCanvas.style.cursor = ac ? 'pointer' : 'crosshair';
    });

    airCanvas.addEventListener('mouseleave', function() {
        airHoverId = null;
        var tip = document.getElementById('airTip');
        if (tip) tip.style.display = 'none';
    });

    airCanvas.addEventListener('click', function(e) {
        var rect = airCanvas.getBoundingClientRect();
        var ac = airPick(e.clientX - rect.left, e.clientY - rect.top);
        airSelectedId = ac ? ac.id : null;
    });
}

// ================================================================
// 初始化 / 销毁
// ================================================================
function initAirspace() {
    airCanvas = document.getElementById('airCanvas');
    if (!airCanvas) return;
    if (!airCtx) {
        airCtx = airCanvas.getContext('2d');
        airBuildRoutes();
        airBuildFleet(18);
        airBindEvents();
        airFpsT0 = (window.performance && performance.now) ? performance.now() : Date.now();
    }
    airResize();
    if (!airInitDone) {
        airInitDone = true;
        airRafId = window.requestAnimationFrame(airLoop);
    // 首次初始化时显式落一次徽章（HTML 里的占位文案可能与状态不同步）
    if (!window.__airBadgeInit) {
        window.__airBadgeInit = true;
        window.AirMindAirspace.setSource(airSourceLabel);
    }
    }
    var hint = document.getElementById('airHint');
    if (hint) {
        hint.textContent = '· 共 ' + airAircraft.length + ' 架在空 · ' +
            AIR_ZONES.length + ' 个管制空域 · 高度上限内飞越不计违规';
    }
}

window.AirMindAirspace = {
    init: initAirspace,
    resize: function() { if (airInitDone) airResize(); },
    getAircraft: function() { return airAircraft; },
    getZones: function() { return AIR_ZONES; },
    getView: function() { return airView; },
    setSource: function(label) {
        airSourceLabel = label;
        var el = document.getElementById('airSource');
        if (el) {
            el.textContent = label;
            el.className = 'badge ' + (label.indexOf('真实') >= 0 ? 'badge-blue' : 'badge-gold');
        }
    },
    /** 供真实数据接入：整体替换机队 */
    replaceFleet: function(list) {
        if (!list || !list.length) return false;
        airAircraft = list.map(function(a, i) {
            return {
                id: a.id || ('L' + i),
                callsign: a.callsign || ('CS' + i),
                routeId: a.routeId || 'LIVE',
                waypoints: a.waypoints || [{ lng: a.lng, lat: a.lat }],
                t: a.t || 0,
                reverse: false,
                speedKmh: a.speedKmh || 0,
                alt: a.alt || 0,
                kind: a.kind || '未知',
                craft: a.craft || '—',
                lng: a.lng, lat: a.lat,
                heading: a.heading || 0,
                trail: [],
                battery: a.battery || 0,
                payload: a.payload || 0,
                static: true      // 真实快照不推进，等下次刷新
            };
        });
        var hint = document.getElementById('airHint');
        if (hint) hint.textContent = '· 真实快照 ' + airAircraft.length + ' 架 · 静态呈现，点击刷新';
        return true;
    },
    setPlaying: function(v) { airRunning = !!v; },
    /** 恢复模拟推演：重建航线与机队 */
    restoreSim: function(n) {
        airBuildRoutes();
        airBuildFleet(n || 18);
        airSelectedId = null;
        var hint = document.getElementById('airHint');
        if (hint) {
            hint.textContent = '· 共 ' + airAircraft.length + ' 架在空 · ' +
                AIR_ZONES.length + ' 个管制空域 · 高度上限内飞越不计违规';
        }
    }
};
