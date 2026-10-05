// LobbyDO：跨游戏活跃房间注册中心（房间状态变化时上报，大厅页轮询列表）
export class LobbyDO {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/report') {
      const e = await req.json();
      const rooms = (await this.state.storage.get('rooms')) || {};
      const key = `${e.game}:${e.code}`;
      // 房间结束或无人在线 → 移除；否则更新
      if (e.over || e.players === 0) delete rooms[key];
      else {
        // 容量上限：满 100 时淘汰最旧条目，防恶意刷房撑爆
        if (!rooms[key] && Object.keys(rooms).length >= 100) {
          const oldest = Object.entries(rooms).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))[0];
          if (oldest) delete rooms[oldest[0]];
        }
        rooms[key] = e;
      }
      await this.state.storage.put('rooms', rooms);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/list') {
      const rooms = (await this.state.storage.get('rooms')) || {};
      const now = Date.now();
      const out = [];
      let dirty = false;
      for (const [k, v] of Object.entries(rooms)) {
        if (now - (v.ts || 0) > 30 * 60 * 1000) { delete rooms[k]; dirty = true; } // 30 分钟无更新过期
        else out.push(v);
      }
      if (dirty) await this.state.storage.put('rooms', rooms);
      out.sort((a, b) => b.ts - a.ts);
      return Response.json({ rooms: out.slice(0, 60) });
    }

    return new Response('not found', { status: 404 });
  }
}

// 房间 DO 在 saveRoom 后调用：上报大厅（失败静默，不影响对局）
export async function reportLobby(env, game, max, room) {
  try {
    if (!env || !env.LOBBY || !room || !room.code) return;
    const seats = (room.seats || []).filter(Boolean);
    const host = (seats.find(s => s.connected !== false) || seats[0] || {}).name || '房主';
    const stub = env.LOBBY.get(env.LOBBY.idFromName('global'));
    await stub.fetch('https://lobby/report', {
      method: 'POST',
      body: JSON.stringify({
        game, code: room.code, max,
        players: seats.filter(s => s.connected !== false).length,
        seated: seats.length,
        started: room.started === true,
        over: room.started === 'over',
        host,
        ts: Date.now(),
      }),
    });
  } catch {}
}
