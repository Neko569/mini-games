// fxq-node —— 游戏平台 Node.js 版服务端（单进程，协议与 CF 版逐字节兼容）
// 依赖：ws（唯一的运行时依赖）；静态资源与前端完全复用 fxq-cf/public
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BaseRoomDO } from './src/room-base.js';
import { lobbyHub, statsHub, flushStats, GAMES } from './src/hubs.js';

import { RoomDO } from './src/room.js';
import { GobangRoomDO } from './src/gobang-room.js';
import { UnoRoomDO } from './src/uno-room.js';
import { PlanesRoomDO } from './src/planes-room.js';
import { DavinciRoomDO } from './src/davinci-room.js';
import { KittensRoomDO } from './src/kittens-room.js';
import { ReversiRoomDO } from './src/reversi-room.js';

const GAME_DEFS = {
  fxq: { cls: RoomDO, prefix: 'f', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  gobang: { cls: GobangRoomDO, prefix: 'g', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  uno: { cls: UnoRoomDO, prefix: 'u', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  planes: { cls: PlanesRoomDO, prefix: 'p', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  davinci: { cls: DavinciRoomDO, prefix: 'd', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  kittens: { cls: KittensRoomDO, prefix: 'k', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  reversi: { cls: ReversiRoomDO, prefix: 'r', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
};

const PORT = +(process.env.PORT || 8787);
// VPS 部署：默认只绑回环（由 Caddy 反代对外）；直连公网时设 HOST=0.0.0.0
const HOST = process.env.HOST || '127.0.0.1';
// 静态资源：默认取仓库根的 public/（本文件在 server/ 下）；可用 STATIC_DIR 覆盖
const STATIC_DIR = path.resolve(process.env.STATIC_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public'));
const RATE_LIMIT_OFF = process.env.RATE_LIMIT_OFF === '1';

// ---------- 输入消毒（与 CF 版一致）----------
function cleanName(raw) { return (raw || '玩家').replace(/[<>&"']/g, '').slice(0, 16) || '玩家'; }
function cleanAvatar(raw) {
  if (!raw || raw.length > 600) return '';
  if (!/^(data:image\/[a-z0-9.+-]+;|https:\/\/)/i.test(raw)) return '';
  if (/["'`<>\s\\]/.test(raw)) return '';
  return raw;
}

// ---------- 房间注册表 ----------
const rooms = new Map(); // key: game:code -> { base, def, conns:Set<ws>, tags:Map<ws,tag>, alarmTimer, recycleTimer, data }
function roomKey(game, code) { return `${game}:${code}`; }

function getRoom(game, code) {
  const key = roomKey(game, code);
  let r = rooms.get(key);
  if (r) return r;
  const def = GAME_DEFS[game];
  if (!def) return null;
  r = {
    game, code, def, base: null, conns: new Set(), tags: new Map(),
    data: null, alarmTimer: null, recycleTimer: null,
  };
  const state = {
    getWebSockets: () => [...r.conns],
    getTags: (ws) => r.tags.get(ws) || null,
    acceptWebSocket: () => {},
    setWebSocketAutoResponsePair: () => {},
    storage: {
      get: async () => r.data,
      put: async (_k, v) => { r.data = v; },
      deleteAll: async () => { r.data = null; },
      setAlarm: (t) => {
        if (r.alarmTimer) clearTimeout(r.alarmTimer);
        r.alarmTimer = setTimeout(() => { r.alarmTimer = null; r.base.alarm().catch(() => {}); }, Math.max(0, t - Date.now()));
      },
      deleteAlarm: () => { if (r.alarmTimer) { clearTimeout(r.alarmTimer); r.alarmTimer = null; } },
    },
  };
  const env = {
    LOBBY: { idFromName: () => ({}), get: () => ({ fetch: async (_u, o) => { console.log('[lobby-shim]', o.body.slice(0, 120)); return ResponseShim(lobbyHub.report(JSON.parse(o.body))); } }) },
    STATS: { idFromName: () => ({}), get: () => ({ fetch: async (_u, o) => ResponseShim(statsHub.record(JSON.parse(o.body))) }) },
  };
  r.base = new def.cls(state, env);
  rooms.set(key, r);
  return r;
}
function ResponseShim(obj) { return { json: async () => obj }; }

// ---------- 限速（每 IP 每路由，滑动窗口；与 CF 版同参数）----------
const RATE = { 'new-room': 10, 'room-info': 60, lobby: 30, stats: 30 };
const rateMap = new Map();
function rateLimit(ip, route) {
  if (RATE_LIMIT_OFF) return false;
  const limit = RATE[route];
  if (!limit) return false;
  const now = Date.now();
  const key = route + ':' + ip;
  const arr = (rateMap.get(key) || []).filter(ts => now - ts < 60000);
  if (arr.length >= limit) { rateMap.set(key, arr); return true; }
  arr.push(now);
  rateMap.set(key, arr);
  if (rateMap.size > 10000) rateMap.clear();
  return false;
}

// ---------- 静态资源 + 安全头 ----------
const SEC_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(rel) {
  const root = path.resolve(STATIC_DIR);
  const file = path.resolve(root, '.' + path.sep + path.normalize(rel).replace(/^([/\\]|\.\.)+/, ''));
  if (!file.startsWith(root)) return null;
  try {
    const data = fs.readFileSync(file);
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...SEC_HEADERS };
    return { status: 200, body: data, headers };
  } catch { return null; }
}

function jsonRes(obj, status = 200) {
  return { status, body: JSON.stringify(obj), headers: { 'content-type': 'application/json; charset=utf-8' } };
}

function genCode(cfg) {
  const pool = cfg.abc + cfg.dig;
  return cfg.prefix + Array.from({ length: 3 }, () => pool[(Math.random() * pool.length) | 0]).join('');
}

// ---------- 真实客户端 IP（Caddy 反代后取 X-Forwarded-For）----------
// 安全规则：仅当直连来源是回环地址（即经本机反代）时才信任 XFF，
// 直绑公网（HOST=0.0.0.0）时来源不可伪造，恒用 socket 地址。
function clientIp(req) {
  const remote = req.socket.remoteAddress || 'local';
  const norm = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  const loopback = norm === '127.0.0.1' || norm === '::1';
  if (loopback && process.env.TRUST_PROXY !== '0') {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return norm;
}

// ---------- HTTP 路由 ----------
function handleApi(req, url, ip) {
  // 健康检查（供 systemd/监控探活）
  if (url.pathname === '/healthz') return jsonRes({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
  // /ws 路径上的普通 GET：非升级请求（与 CF 版一致，校验 Origin 防跨站探测）
  if (WS_ROUTE.test(url.pathname)) {
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== url.host) return { status: 403, body: 'origin not allowed', headers: {} }; }
      catch { return { status: 403, body: 'origin not allowed', headers: {} }; }
    }
    return { status: 426, body: 'expected websocket', headers: {} };
  }
  // 新建房
  if (url.pathname === '/api/new-room') {
    if (rateLimit(ip, 'new-room')) return jsonRes({ error: '太快了，稍后再试' }, 429);
    const game = url.searchParams.get('game') || 'fxq';
    const cfg = GAME_DEFS[game];
    if (!cfg) return jsonRes({ error: 'unknown game' }, 400);
    let code;
    for (let i = 0; i < 8; i++) {
      code = genCode(cfg);
      if (!rooms.get(roomKey(game, code))) break;
    }
    return jsonRes({ code, game });
  }
  // 房间探测
  if (url.pathname === '/api/room-info') {
    if (rateLimit(ip, 'room-info')) return jsonRes({ error: '太快了' }, 429);
    const code = (url.searchParams.get('code') || '').toLowerCase();
    if (!/^[a-z0-9]{4}$/.test(code)) return jsonRes({ error: 'invalid code' }, 400);
    const game = GAME_DEFS[Object.keys(GAME_DEFS).find(g => GAME_DEFS[g].prefix === code[0])];
    if (!game) return jsonRes({ error: 'unknown game' }, 400);
    const r = rooms.get(roomKey(Object.keys(GAME_DEFS).find(g => GAME_DEFS[g].prefix === code[0]), code));
    if (!r) return jsonRes({ code, occupied: false, started: false, game: Object.keys(GAME_DEFS).find(g => GAME_DEFS[g].prefix === code[0]) });
    const occupied = r.data && (r.data.seats.some(s => s && s.connected) || r.data.started === true);
    return jsonRes({ code, occupied: !!occupied, started: !!(r.data && r.data.started === true), game: r.game });
  }
  // 大厅
  if (url.pathname === '/api/lobby') {
    if (rateLimit(ip, 'lobby')) return jsonRes({ error: '太快了' }, 429);
    return jsonRes({ rooms: lobbyHub.list() });
  }
  // 战绩（只读；写入仅限服务端内部）
  if (url.pathname === '/api/stats') {
    if (req.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405);
    if (rateLimit(ip, 'stats')) return jsonRes({ error: '太快了' }, 429);
    return jsonRes(statsHub.query(url));
  }
  return null;
}

// ---------- WS ----------
const wss = new WebSocketServer({ noServer: true });
const WS_ROUTE = /^\/ws\/(fxq|gobang|uno|planes|davinci|kittens|reversi)\/([a-z0-9]{4})$/i;

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = clientIp(req);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || WS_ROUTE.test(url.pathname)) {
      const r = handleApi(req, url, ip);
      if (!r) return send(res, jsonRes({ error: 'not found' }, 404));
      return send(res, r);
    }
    const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const s = serveStatic(rel);
    if (!s) return send(res, { status: 404, body: 'not found', headers: SEC_HEADERS });
    return send(res, s);
  } catch (e) {
    return send(res, jsonRes({ error: String(e && e.message) }, 500));
  }
});

function send(res, r) {
  res.writeHead(r.status, r.headers);
  res.end(r.body);
}

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(WS_ROUTE);
  // Origin 校验（防跨站 WebSocket 劫持；无 Origin 的非浏览器客户端放行）
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== url.host) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; } }
    catch { socket.destroy(); return; }
  }
  if (!m) { socket.destroy(); return; }
  const game = m[1].toLowerCase();
  const code = m[2].toLowerCase();
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, game, code, url);
  });
});

wss.on('connection', (ws, req, game, code, url) => {
  const r = getRoom(game, code);
  if (!r) { ws.close(1011); return; }
  // 输入消毒（与 CF 版一致）
  const tag = {
    gid: url.searchParams.get('gid') || crypto.randomUUID(),
    name: cleanName(url.searchParams.get('name') || ''),
    avatar: cleanAvatar(url.searchParams.get('avatar') || ''),
  };
  r.conns.add(ws);
  r.tags.set(ws, tag);
  if (r.recycleTimer) { clearTimeout(r.recycleTimer); r.recycleTimer = null; }
  // 心跳兜底：客户端发 {"t":"ping"} 由 base.webSocketMessage 应答 pong
  ws.on('message', (data) => { r.base.webSocketMessage(ws, data.toString()).catch((e) => console.error('[msg]', e && e.message)); });
  ws.on('close', () => {
    r.conns.delete(ws);
    r.tags.delete(ws);
    r.base.webSocketClose(ws).catch(() => {});
    // 无连接时安排回收（回收窗口内重连可恢复）
    if (r.conns.size === 0) {
      r.recycleTimer = setTimeout(() => { rooms.delete(roomKey(game, code)); }, 10 * 60 * 1000);
      r.recycleTimer.unref();
    }
  });
  ws.on('error', () => {});
  // joinOnUpgrade 语义（reversi）：先加载房间再入座；同时补设房间号（对应 CF 版 worker 路由传入的 room=）
  r.base.loadRoom()
    .then(() => {
      if (!r.base.room.code) { r.base.room.code = code; r.base.saveRoom().catch(() => {}); }
      if (r.base.def.joinOnUpgrade) r.base.handleJoin(ws, tag);
    })
    .catch((e) => console.error('[upgrade-join]', e && e.message));
});

// probe 支持给 room-info 用：getRoom 时 data 可能为 null → probe occupied false ✓
setInterval(() => {
  // 内存兜底清理：无连接且 data 为空的房间直接移除
  for (const [k, r] of rooms) if (r.conns.size === 0 && !r.data) rooms.delete(k);
}, 60 * 1000).unref();

httpServer.listen(PORT, HOST, () => {
  console.log(`[fxq-node] listening on http://${HOST}:${PORT} (static: ${STATIC_DIR}, rateLimit: ${RATE_LIMIT_OFF ? 'OFF' : 'ON'})`);
});

// ---------- 优雅停机（systemd restart / deploy 时保战绩、礼貌断线）----------
function shutdown(sig) {
  console.log(`[fxq-node] ${sig} received, shutting down…`);
  flushStats();
  httpServer.close(() => process.exit(0));
  for (const r of rooms.values()) for (const ws of r.conns) { try { ws.close(1001, 'server restart'); } catch {} }
  setTimeout(() => process.exit(0), 3000).unref(); // 兜底强退
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
