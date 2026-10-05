// Worker 入口：静态资源 + 多游戏路由（fxq / gobang）+ 房间号生成
import { RoomDO } from './room.js';
import { GobangRoomDO } from './gobang-room.js';
import { UnoRoomDO } from './uno-room.js';
import { PlanesRoomDO } from './planes-room.js';
import { DavinciRoomDO } from './davinci-room.js';
import { KittensRoomDO } from './kittens-room.js';
import { StatsDO } from './stats.js';
import { ReversiRoomDO } from './reversi-room.js';
import { LobbyDO } from './lobby.js';

export { RoomDO, GobangRoomDO, UnoRoomDO, PlanesRoomDO, DavinciRoomDO, KittensRoomDO, StatsDO, ReversiRoomDO, LobbyDO };

// ---- 安全：简易限速（每 IP 每路由滑动窗口，内存实现，重启清零） ----
const RATE = { 'new-room': 10, 'room-info': 60, lobby: 30, stats: 30 }; // 次/分钟
const rateMap = new Map();
function rateLimit(req, route, env) {
  if (env && env.RATE_LIMIT_OFF === '1') return false; // CI/本地功能测试旁路
  const limit = RATE[route];
  if (!limit) return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const now = Date.now();
  const key = route + ':' + ip;
  const arr = (rateMap.get(key) || []).filter(ts => now - ts < 60000);
  if (arr.length >= limit) { rateMap.set(key, arr); return true; }
  arr.push(now);
  rateMap.set(key, arr);
  if (rateMap.size > 10000) rateMap.clear(); // 防内存膨胀
  return false;
}

// ---- 安全：静态资源响应附加安全头 ----
const SEC_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
async function assetWithHeaders(env, req) {
  const resp = await env.ASSETS.fetch(req);
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

// 房间号首字母标识游戏：f=飞行棋 g=五子棋（加入时按首字母路由）
const GAMES = {
  fxq:    { cls: 'ROOM',    prefix: 'f', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  gobang: { cls: 'GOBANG',  prefix: 'g', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  uno:    { cls: 'UNO',     prefix: 'u', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  planes: { cls: 'PLANES',  prefix: 'p', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  davinci: { cls: 'DAVINCI', prefix: 'd', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  kittens: { cls: 'KITTENS', prefix: 'k', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
  reversi: { cls: 'REVERSI', prefix: 'r', abc: 'abcdefghjkmnpqrstuvwxyz', dig: '23456789' },
};

function genRoomCode(cfg) {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  // 首字母 = 游戏标识（f=飞行棋 g=五子棋），加入时按此路由
  return `${cfg.prefix}${cfg.abc[b[0] % cfg.abc.length]}${cfg.dig[b[1] % cfg.dig.length]}${cfg.dig[b[2] % cfg.dig.length]}`;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',   // https 页面 → localhost 调试场景
};

function gameDO(env, game, code) {
  const g = GAMES[game];
  if (!g) return null;
  return env[g.cls].get(env[g.cls].idFromName(`${game}:${code}`));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // PNA 预检：https 页面内嵌/调试场景（本地开发用，生产无副作用）
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Private-Network': 'true',
      }});
    }

    // 新建房：/api/new-room?game=fxq|gobang
    if (url.pathname === '/api/new-room') {
      if (rateLimit(req, 'new-room', env)) return Response.json({ error: '太快了，稍后再试' }, { status: 429, headers: CORS });
      const game = url.searchParams.get('game') || 'fxq';
      const cfg = GAMES[game];
      if (!cfg) return Response.json({ error: 'unknown game' }, { status: 400, headers: CORS });
      for (let i = 0; i < 8; i++) {
        const code = genRoomCode(cfg);
        const probe = await (await gameDO(env, game, code)).fetch('https://do/probe');
        const j = await probe.json();
        if (!j.occupied) return Response.json({ code, game }, { headers: CORS });
      }
      return Response.json({ code: genRoomCode(cfg), game }, { headers: CORS });
    }

    // 房间探测：/api/room-info?code=xxxx（按首字母识别游戏）
    if (url.pathname === '/api/room-info') {
      if (rateLimit(req, 'room-info', env)) return Response.json({ error: '太快了' }, { status: 429, headers: CORS });
      const code = (url.searchParams.get('code') || '').toLowerCase();
      if (!/^[a-z0-9]{4}$/.test(code)) return Response.json({ error: 'code' }, { status: 400, headers: CORS });
      const PREFIX_GAME = { f: 'fxq', g: 'gobang', u: 'uno', p: 'planes', d: 'davinci', k: 'kittens', r: 'reversi' };
      const game = PREFIX_GAME[code[0]] || 'fxq';
      const resp = await (await gameDO(env, game, code)).fetch('https://do/probe');
      const j = await resp.json();
      return Response.json({ ...j, game }, { headers: CORS });
    }

    // 大厅：跨游戏活跃房间列表（LobbyDO 维护，房间 DO 状态变化时上报）
    if (url.pathname === '/api/lobby') {
      if (rateLimit(req, 'lobby', env)) return Response.json({ error: '太快了' }, { status: 429, headers: CORS });
      const stub = env.LOBBY.get(env.LOBBY.idFromName('global'));
      return stub.fetch('https://lobby/list');
    }

    // 战绩：只读查询（写入仅限 DO 内部 binding 上报，公开写接口已封禁防伪造/投毒）
    if (url.pathname === '/api/stats') {
      if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });
      if (rateLimit(req, 'stats', env)) return Response.json({ error: '太快了' }, { status: 429, headers: CORS });
      const stub = env.STATS.get(env.STATS.idFromName('global'));
      return stub.fetch('https://stats/query' + url.search);
    }

    // WS 升级：/ws/{game}/{code}（Origin 校验防跨站 WebSocket 劫持）
    const origin = req.headers.get('Origin');
    if (origin && (() => { try { return new URL(origin).host !== url.host; } catch { return true; } })()) {
      return new Response('origin not allowed', { status: 403 });
    }
  const m = url.pathname.match(/^\/ws\/(fxq|gobang|uno|planes|davinci|kittens|reversi)\/([a-z0-9]{4})$/i);
    if (m) {
      const game = m[1].toLowerCase();
      const code = m[2].toLowerCase();
      const stub = await gameDO(env, game, code);
      // room= 编码进 query：DO 内部据此持久化房间号（大厅上报依赖）
      const qs = url.search ? url.search + '&' : '?';
      return stub.fetch(`https://do/join${qs}room=${code}`, req);
    }

    // 静态资源（附加安全响应头）
    if (env.ASSETS) {
      return assetWithHeaders(env, req);
    }
    return new Response('not found', { status: 404 });
  },
};
