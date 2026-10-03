// Durable Object: 炸飞机房间（2 人，布局阶段 + 交战阶段）
import { reportResult } from './stats-report.js';
import { newGame, place, strike, bothPlaced } from './planes.js';

export class PlanesRoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.state.storage.get('room')) || {
      code: null, seats: [null, null], owner: null,
      started: false, game: null, ready: [false, false],
    };
    return this.room;
  }
  async saveRoom() { if (this.room) await this.state.storage.put('room', this.room); }

  async fetch(req) {
    await this.loadRoom();
    const url = new URL(req.url);
    if (url.pathname === '/probe') {
      const occupied = this.room.seats.some(s => s && s.connected) || this.room.started === true;
      return Response.json({ code: this.room.code, occupied, started: this.room.started === true });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 400 });
    if (!this.room.code) this.room.code = url.searchParams.get('room') || null;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const info = {
      gid: url.searchParams.get('gid') || crypto.randomUUID(),
      name: (url.searchParams.get('name') || '玩家').slice(0, 16),
      avatar: url.searchParams.get('avatar') || '',
    };
    this.state.acceptWebSocket(server, [JSON.stringify(info)]);
    this.saveRoom();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this.loadRoom();
    const tag = this._tagOf(ws);
    if (!tag) return;
    let m;
    try { m = JSON.parse(message); } catch { return; }
    try {
      switch (m.t) {
        case 'join': this.handleJoin(ws, tag); break;
        case 'start': this.handleStart(ws, tag); break;
        case 'place': this.handlePlace(ws, tag, m); break;
        case 'strike': this.handleStrike(ws, tag, m); break;
        case 'chat': {
          const text = String(m.text || '').slice(0, 200);
          if (text) this._broadcast({ t: 'chat', name: tag.name, text });
          break;
        }
      }
    } catch (e) {
      this._send(ws, { t: 'error', msg: e.message || String(e) });
    }
  }

  async webSocketClose(ws) { await this.loadRoom(); await this.onOffline(this._tagOf(ws)); }
  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch {}
    await this.loadRoom();
    await this.onOffline(this._tagOf(ws));
  }

  _tagOf(ws) {
    for (const tag of this.state.getTags(ws)) {
      try { return JSON.parse(tag); } catch {}
    }
    return null;
  }
  seatOf(gid) { return this.room.seats.findIndex(s => s && s.gid === gid); }

  handleJoin(ws, tag) {
    const r = this.room;
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const ot = this._tagOf(other);
      if (ot && ot.gid === tag.gid) { this._send(other, { t: 'kicked', reason: 'duplicate' }); try { other.close(4000, 'duplicate'); } catch {} }
    }
    let seat = this.seatOf(tag.gid);
    if (seat === -1) {
      const free = r.seats.findIndex(s => !s);
      if (free === -1) { this._send(ws, { t: 'error', msg: '房间已满（炸飞机为 2 人对弈）' }); return; }
      seat = free;
      r.seats[seat] = { gid: tag.gid, name: tag.name, avatar: tag.avatar, connected: true };
      if (!r.owner) r.owner = tag.gid;
    } else {
      r.seats[seat].connected = true;
      r.seats[seat].name = tag.name;
    }
    this.saveRoom();
    this._send(ws, {
      t: 'welcome', you: { seat }, room: {
        ...this.roomView(), game: r.game ? this.pubGame(seat) : null, ready: r.ready,
      },
    });
    this._broadcast({ t: 'players', players: this.playerList() });
  }

  handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) { this._send(ws, { t: 'error', msg: '只有房主可以开始' }); return; }
    if (r.seats.filter(Boolean).length < 2) { this._send(ws, { t: 'error', msg: '炸飞机需要 2 名玩家' }); return; }
    this.room.seats = r.seats.filter(Boolean).slice(0, 2);
    r.game = newGame();
    r.ready = [false, false];
    r.started = true;
    this.saveRoom();
    this._broadcast({ t: 'start', room: this.roomView() });
    this.sendEachPrivate();
  }

  handlePlace(ws, tag, m) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    if (seat < 0) { this._send(ws, { t: 'error', msg: '观战不能布置' }); return; }
    try {
      r.game.boards[seat] = place(m.planes);
    } catch (e) {
      this._send(ws, { t: 'error', msg: e.message });
      return;
    }
    r.ready[seat] = true;
    if (bothPlaced(r.game)) r.game.phase = 'fighting';
    this.saveRoom();
    this._broadcast({ t: 'placed', seat, phase: r.game.phase, ready: r.ready });
  }

  handleStrike(ws, tag, m) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (seat < 0) { this._send(ws, { t: 'error', msg: '观战不能打击' }); return; }
    let res;
    try {
      res = strike(r.game, seat, m.x, m.y);
    } catch (e) {
      this._send(ws, { t: 'error', msg: e.message });
      return;
    }
    this.saveRoom();
    this._broadcast({
      t: 'strike', by: seat, x: m.x, y: m.y, res,
      nextTurn: r.game.turn,
      winner: r.game.winner,
      phase: r.game.phase,
    });
    if (r.game.winner !== null) {
      this._broadcast({ t: 'finished', winner: r.game.winner });
      reportResult(this.env, 'planes', this.room.seats, [r.game.winner]);
    }
  }

  sendEachPrivate() {
    for (const ws of this.state.getWebSockets()) {
      const tag = this._tagOf(ws);
      const seat = tag ? this.seatOf(tag.gid) : -1;
      if (seat >= 0) this._send(ws, { t: 'state', you: seat, game: this.pubGame(seat), ready: this.room.ready });
    }
  }

  /* 视角裁剪：自己看得到自己的布局；对方机头只在击落时揭晓 */
  pubGame(seat) {
    const g = this.room.game;
    if (!g) return null;
    const over = g.winner !== null;
    return {
      phase: g.phase,
      turn: g.turn,
      winner: g.winner,
      strikes: g.strikes,
      mine: g.boards[seat],
      enemyDowns: g.boards[1 - seat] ? g.boards[1 - seat].filter(p => p.down).map(p => p.head) : [],
      enemyHeadsAll: over ? (g.boards[1 - seat] || []).map(p => p.head) : null,
    };
  }

  playerList() {
    return this.room.seats.map((s, i) => s ? {
      seat: i, name: s.name, avatar: s.avatar, connected: s.connected,
      owner: this.room.owner === s.gid,
    } : null);
  }
  roomView() {
    return { code: this.room.code, owner: this.room.owner, players: this.playerList(), started: this.room.started };
  }

  async onOffline(tag) {
    if (!tag) return;
    await this.loadRoom();
    const seat = this.seatOf(tag.gid);
    if (seat !== -1 && this.room.seats[seat]) {
      this.room.seats[seat].connected = false;
      this.saveRoom();
      this._broadcast({ t: 'players', players: this.playerList() });
    }
  }

  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  _broadcast(obj) { for (const ws of this.state.getWebSockets()) this._send(ws, obj); }
}
