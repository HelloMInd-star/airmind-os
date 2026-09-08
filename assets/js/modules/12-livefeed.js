/*!
 * AirMind V2.3 — 真实数据接入（OpenSky ADS-B / Open-Meteo）
 *
 * 设计原则：真实数据必须"优雅降级"。
 *   网络不通、CORS 被拦、API 限流、返回空——任何一种情况都只能退回模拟推演，
 *   绝不能留一个白屏或一片空白地图给面试官看。
 * 界面顶部徽章会如实显示当前数据源是「真实」还是「模拟推演」。
 *
 * ⚠️ 说明：本模块的网络请求在受限沙盒环境中无法自测（OpenSky / Open-Meteo 均返回 403），
 *    逻辑按 CORS + 超时 + 空结果三层防御编写，需在真实网络下验证。
 */
'use strict';

var LIVE = {
    bbox: { lamin: 29.9, lomin: 103.3, lamax: 31.3, lomax: 104.9 },   // 成都及周边
    timeoutMs: 9000,
    lastOk: null,        // 上次成功时间
    lastError: null      // 上次错误信息
};

var LIVE_SPEED_STEPS = [0.5, 1, 2, 4];
var liveSpeedIdx = 1;

/** 带超时的 fetch */
function liveFetch(url, ms) {
    if (typeof AbortController === 'undefined') return fetch(url);
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, ms || LIVE.timeoutMs);
    return fetch(url, { signal: ctrl.signal }).then(function(r) {
        clearTimeout(timer);
        return r;
    }, function(e) {
        clearTimeout(timer);
        throw e;
    });
}

/**
 * 拉取 OpenSky 真实航班快照
 * @returns {Promise<Array>} 归一化后的航空器数组；失败时 reject
 */
function fetchOpenSky() {
    var b = LIVE.bbox;
    var url = 'https://opensky-network.org/api/states/all' +
        '?lamin=' + b.lamin + '&lomin=' + b.lomin + '&lamax=' + b.lamax + '&lomax=' + b.lomax;
    return liveFetch(url).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }).then(function(j) {
        var states = (j && j.states) || [];
        var out = states.map(function(s, i) {
            // OpenSky 状态向量字段顺序（官方文档）：
            // 0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact,
            // 5 longitude, 6 latitude, 7 baro_altitude, 8 on_ground, 9 velocity,
            // 10 true_track, 11 vertical_rate, 12 sensors, 13 geo_altitude, ...
            var lng = s[5], lat = s[6];
            if (lng === null || lat === null) return null;     // 无定位的航迹丢弃
            var altM = s[13] !== null ? s[13] : (s[7] !== null ? s[7] : 0);
            if (s[8] === true) return null;                    // 地面上的不算"在空"
            return {
                id: 'OS' + String(i),
                callsign: (s[1] || '').trim() || ('ICAO' + String(s[0] || i).slice(0, 5)),
                lng: lng, lat: lat,
                alt: Math.round(altM),
                speedKmh: s[9] !== null ? Math.round(s[9] * 3.6) : 0,
                heading: s[10] !== null ? Math.round(s[10]) : 0,
                kind: '民航', craft: 'ADS-B',
                battery: 0, payload: 0,
                routeId: 'LIVE', t: 0
            };
        }).filter(Boolean);
        if (!out.length) throw new Error('空域内暂无真实航迹');
        return out;
    });
}

/** 拉取 Open-Meteo 实时气象（无需 API Key） */
function fetchWeather() {
    var url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + AIR_VIEW.centerLat + '&longitude=' + AIR_VIEW.centerLng +
        '&current=temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code';
    return liveFetch(url, 7000).then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }).then(function(j) {
        var c = j && j.current;
        if (!c) throw new Error('气象数据为空');
        return {
            temp: c.temperature_2m,
            wind: c.wind_speed_10m,
            gust: c.wind_gusts_10m,
            code: c.weather_code
        };
    });
}

/** 天气代码 → 中文描述 */
function weatherDesc(code) {
    var map = {
        0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
        45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '小雨', 55: '中雨',
        61: '小雨', 63: '中雨', 65: '大雨',
        71: '小雪', 73: '中雪', 75: '大雪',
        80: '阵雨', 81: '强阵雨', 82: '暴雨',
        95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴'
    };
    return map[code] || ('代码 ' + code);
}

/**
 * 一键接入真实数据
 * 成功 → 替换机队为真实航迹；失败 → 保留模拟并如实报错
 */
function connectLiveData() {
    var btn = document.getElementById('airLive');
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 接入中…'; }

    Promise.all([
        fetchOpenSky(),
        fetchWeather().catch(function() { return null; })    // 气象失败不影响主流程
    ]).then(function(res) {
        var fleet = res[0], wx = res[1];
        if (window.AirMindAirspace) {
            window.AirMindAirspace.replaceFleet(fleet);
            window.AirMindAirspace.setSource('真实 ADS-B · ' + fleet.length + ' 架');
        }
        LIVE.lastOk = new Date();
        var msg = '📡 已接入真实航迹 ' + fleet.length + ' 架';
        if (wx) {
            msg += ' · ' + weatherDesc(wx.code) + ' ' + wx.temp + '℃ · 风 ' + wx.wind + 'km/h';
            // 真实风速回写情景，驱动其余面板（如果存在该接口）
            if (typeof setLiveWind === 'function') setLiveWind(wx.wind, weatherDesc(wx.code));
        }
        toast(msg, 'success');
        if (btn) { btn.textContent = '✅ 已接真实数据'; }
    }).catch(function(e) {
        LIVE.lastError = e && e.message ? e.message : String(e);
        if (window.AirMindAirspace) {
            window.AirMindAirspace.setSource('模拟推演');
        }
        toast('⚠️ 真实数据不可用（' + LIVE.lastError + '），已保持模拟推演', 'warn');
        if (btn) { btn.textContent = old || '📡 接真实数据'; }
    }).then(function() {
        if (btn) btn.disabled = false;
    });
}

/** 恢复模拟推演 */
function disconnectLiveData() {
    if (window.AirMindAirspace) {
        window.AirMindAirspace.setSource('模拟推演');
        window.AirMindAirspace.restoreSim(18);
    }
    var btn = document.getElementById('airLive');
    if (btn) btn.textContent = '📡 接真实数据';
    toast('↺ 已恢复模拟推演', 'info');
}

// ================================================================
// 控制按钮绑定
// ================================================================
function bindAirspaceControls() {
    var play = document.getElementById('airPlay');
    if (play) play.addEventListener('click', function() {
        var running = play.getAttribute('data-running') !== 'false';
        running = !running;
        play.setAttribute('data-running', running ? 'true' : 'false');
        play.textContent = running ? '⏸ 暂停' : '▶ 播放';
        if (window.AirMindAirspace) window.AirMindAirspace.setPlaying(running);
    });

    var spd = document.getElementById('airSpeed');
    if (spd) spd.addEventListener('click', function() {
        liveSpeedIdx = (liveSpeedIdx + 1) % LIVE_SPEED_STEPS.length;
        spd.textContent = LIVE_SPEED_STEPS[liveSpeedIdx] + '×';
        // airSpeed 是 11-airspace.js 的模块级变量，这里通过闭包外的方法设置
        if (typeof setAirSpeed === 'function') setAirSpeed(LIVE_SPEED_STEPS[liveSpeedIdx]);
    });

    var zones = document.getElementById('airZones');
    if (zones) zones.addEventListener('click', function() {
        var on = zones.getAttribute('aria-pressed') !== 'true';
        zones.setAttribute('aria-pressed', on ? 'true' : 'false');
        zones.style.opacity = on ? '1' : '0.45';
        if (typeof setAirShowZones === 'function') setAirShowZones(on);
    });

    var trails = document.getElementById('airTrails');
    if (trails) trails.addEventListener('click', function() {
        var on = trails.getAttribute('aria-pressed') !== 'true';
        trails.setAttribute('aria-pressed', on ? 'true' : 'false');
        trails.style.opacity = on ? '1' : '0.45';
        if (typeof setAirShowTrails === 'function') setAirShowTrails(on);
    });

    var live = document.getElementById('airLive');
    if (live) live.addEventListener('click', connectLiveData);
}

/** 供 11-airspace.js 暴露的开关（避免跨文件直接改变量） */
function setAirSpeed(v) { if (typeof airSpeed !== 'undefined') airSpeed = v; }
function setAirShowZones(v) { if (typeof airShowZones !== 'undefined') airShowZones = !!v; }
function setAirShowTrails(v) { if (typeof airShowTrails !== 'undefined') airShowTrails = !!v; }
