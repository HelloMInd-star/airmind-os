/*!
 * AirMind V2.2 — 02-matching
 * 机型库 + 运力匹配（委托算法层）
 *
 * 注意：本文件不使用 IIFE 包裹，顶层 var 声明与其它模块共享同一全局作用域。
 * 这是刻意为之——用传统 <script src> 顺序加载，保证 file:// 双击可运行。
 * （若改用 ES Module，浏览器的 CORS 策略会拦住 file:// 请求。）
 * 所有顶层标识符均已检查，不与 window 内置属性冲突。
 */
'use strict';

// ============================================================
            // 1.6 Tab3 机型库 + 运力匹配算法（真算，不再是写死的 96%）
            // ============================================================
            var FLEET = [
                { id: 'FG-07', name: '固定翼 FG-07',     kind: '固定翼',   payload: 10, range: 120, speed: 90,  soh: 92, windMax: 12, unit: 4,  craft: '多点锁平开窗', baseCost: 1.00 },
                { id: 'MX-03', name: '多旋翼 MX-03',     kind: '多旋翼',   payload: 5,  range: 25,  speed: 45,  soh: 65, windMax: 10, unit: 12, craft: '推拉活动窗',   baseCost: 0.70 },
                { id: 'QT-02', name: '倾转旋翼 QT-02',   kind: '倾转旋翼', payload: 8,  range: 80,  speed: 120, soh: 58, windMax: 15, unit: 3,  craft: '无锁落地窗',   baseCost: 1.60 },
                { id: 'FH-11', name: '复合翼 FH-11',     kind: '复合翼',   payload: 6,  range: 60,  speed: 70,  soh: 88, windMax: 13, unit: 6,  craft: '多点锁平开窗', baseCost: 1.15 },
                { id: 'ZS-05', name: '轻型直升机 ZS-05', kind: '直升机',   payload: 20, range: 200, speed: 160, soh: 74, windMax: 18, unit: 2,  craft: '多点锁平开窗', baseCost: 3.20 },
                { id: 'AS-09', name: '无人飞艇 AS-09',   kind: '飞艇',     payload: 30, range: 40,  speed: 30,  soh: 83, windMax: 6,  unit: 1,  craft: '无锁落地窗',   baseCost: 0.55 }
            ];
            var DEFAULT_ORDERS = [
                { id: 1021, name: '医疗样本', weight: 5,  distance: 32, deadline: 30, priority: '紧急' },
                { id: 1022, name: '快递包裹', weight: 12, distance: 18, deadline: 60, priority: '标准' },
                { id: 1023, name: '外卖餐盒', weight: 3,  distance: 6,  deadline: 20, priority: '普通' },
                { id: 1024, name: '跨城急件', weight: 8,  distance: 95, deadline: 45, priority: '高优先级' }
            ];
            var orders = safeStore.get('orders', null) || DEFAULT_ORDERS.slice();
            var assignments = safeStore.get('assignments', {}) || {};   // orderId -> fleetId

            function persistOrders() { safeStore.set('orders', orders); safeStore.set('assignments', assignments); }

            // 单层费率 × 距离 × 载重系数 × 气象溢价 × 时段系数
            function quoteCost(order, ac) { return AirMind.quoteCost(order, ac, store.scenario); }

            // 核心：单机型打分（返回明细，方便解释"为什么是它"）
            function scoreAircraft(order, ac) { return AirMind.scoreAircraft(order, ac, store.scenario); }

            function matchFleet(order) { return AirMind.rankFleet(order, FLEET, store.scenario); }

            // 全局最优指派（匈牙利）—— 取代逐单贪心，避免高分工单抢占稀缺运力
            function globalAssign() { return AirMind.assignFleet(orders, FLEET, store.scenario, { minScore: 35 }); }

            // ============================================================
            // 1.7 Tab4 串级 PID + 仿生窗型 仿真引擎
            // ============================================================
            var CRAFT_MODELS = AirMind.CRAFT_MODELS;

            // 外环 10Hz 航线锁定 + 内环 200Hz 姿态抑制，t=1.5s 注入侧风阶跃
            function simulateCascade(cfg) { return AirMind.simulateCascade(cfg); }
