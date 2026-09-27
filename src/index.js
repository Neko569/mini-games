// Worker 入口：静态资源 + WS 路由 + 房间号生成
import { RoomDO } from './room.js';

export { RoomDO };

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz'; // 无易混字符
const DIGITS = '23456789';
function genRoomCode() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return `${ALPHABET[b[0] % ALPHABET.length]}${ALPHABET[b[1] % ALPHABET.length]}${DIGITS[b[2] % DIGITS.length]}${DIGITS[b[3] % DIGITS.length]}`;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',   // https 页面 → localhost 调试场景
};

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

    // 新建房（CORS 开放：仅返回随机房间号，无敏感数据）
    if (url.pathname === '/api/new-room') {
      if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
      for (let i = 0; i < 8; i++) {
        const code = genRoomCode();
        const id = env.ROOM.idFromName(code);
        const probe = await env.ROOM.get(id).fetch('https://do/probe');
        const j = await probe.json();
        if (!j.occupied) return Response.json({ code }, { headers: CORS });
      }
      return Response.json({ code: genRoomCode() }, { headers: CORS });
    }

    // 房间探测（CORS 开放：房间是否存在/是否开局）
    if (url.pathname === '/api/room-info') {
      if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
      const code = (url.searchParams.get('code') || '').toLowerCase();
      if (!/^[a-z0-9]{4}$/.test(code)) return Response.json({ error: 'code' }, { status: 400, headers: CORS });
      const id = env.ROOM.idFromName(code);
      const resp = await env.ROOM.get(id).fetch('https://do/probe');
      const j = await resp.json();
      return Response.json(j, { headers: CORS });
    }

    // WS 升级：/ws/{code}
    const m = url.pathname.match(/^\/ws\/([a-z0-9]{4})$/i);
    if (m) {
      const code = m[1].toLowerCase();
      const id = env.ROOM.idFromName(code);
      return env.ROOM.get(id).fetch('https://do/join' + url.search, req);
    }

    // 静态资源
    if (env.ASSETS) {
      return env.ASSETS.fetch(req);
    }
    return new Response('not found', { status: 404 });
  },
};
