// Worker 入口：静态资源 + 多游戏路由（fxq / gobang）+ 房间号生成
import { RoomDO } from './room.js';
import { GobangRoomDO } from './gobang-room.js';
import { UnoRoomDO } from './uno-room.js';
import { PlanesRoomDO } from './planes-room.js';
import { DavinciRoomDO } from './davinci-room.js';
import { KittensRoomDO } from './kittens-room.js';
import { StatsDO } from './stats.js';
import { ReversiRoomDO } from './reversi-room.js';

export { RoomDO, GobangRoomDO, UnoRoomDO, PlanesRoomDO, DavinciRoomDO, KittensRoomDO, StatsDO, ReversiRoomDO };

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
      const code = (url.searchParams.get('code') || '').toLowerCase();
      if (!/^[a-z0-9]{4}$/.test(code)) return Response.json({ error: 'code' }, { status: 400, headers: CORS });
      const PREFIX_GAME = { f: 'fxq', g: 'gobang', u: 'uno', p: 'planes', d: 'davinci', k: 'kittens', r: 'reversi' };
      const game = PREFIX_GAME[code[0]] || 'fxq';
      const resp = await (await gameDO(env, game, code)).fetch('https://do/probe');
      const j = await resp.json();
      return Response.json({ ...j, game }, { headers: CORS });
    }

    // WS 升级：/ws/{game}/{code}
    if (url.pathname === '/api/stats') {
    const stub = env.STATS.get(env.STATS.idFromName('global'));
    const inner = req.method === 'POST' ? 'https://stats/record' : 'https://stats/query' + url.search;
    return stub.fetch(inner, req.method === 'POST' ? req : undefined);
  }
  const m = url.pathname.match(/^\/ws\/(fxq|gobang|uno|planes|davinci|kittens|reversi)\/([a-z0-9]{4})$/i);
    if (m) {
      const game = m[1].toLowerCase();
      const code = m[2].toLowerCase();
      const stub = await gameDO(env, game, code);
      return stub.fetch(`https://do/join${url.search}`, req);
    }

    // 静态资源
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }
    return new Response('not found', { status: 404 });
  },
};
