// Durable Object: 五子棋房间（2 人对坐 + 观战，SQLite 持久化 + WS Hibernation）
import { reportResult } from './stats-report.js';
import { newGame, place } from './gobang.js';

const COLORS = ['#1a1a1a', '#f5f5f5']; // 黑 白
const CN = ['黑方', '白方'];

export class GobangRoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.state.storage.get('room')) || {
      code: null, seats: [null, null], spectators: {},
      owner: null, started: false, game: null, winners: [],
    };
    return this.room;
  }

  async saveRoom() {
    if (this.room) await this.state.storage.put('room', this.room);
  }

  async fetch(req) {
    await this.loadRoom();
    const url = new URL(req.url);

    if (url.pathname === '/probe') {
      const occupied = this.room.seats.some(s => s && s.connected) ||
                       Object.keys(this.room.spectators).length > 0 ||
                       this.room.started === true;
      return Response.json({ code: this.room.code, occupied, started: this.room.started === true });
    }

    // WS 升级
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 400 });
    if (!this.room.code) this.room.code = url.searchParams.get('room') || null;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const info = {
      gid: url.searchParams.get('gid') || crypto.randomUUID(),
      name: (url.searchParams.get('name') || '玩家').slice(0, 16),
      avatar: url.searchParams.get('avatar') || '',
      seat: -1,
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
    switch (m.t) {
      case 'join': this.handleJoin(ws, tag); break;
      case 'start': this.handleStart(ws, tag); break;
      case 'place': this.handlePlace(ws, tag, m); break;
      case 'chat': this.handleChat(ws, tag, m); break;
      case 'leave': this.handleLeave(ws, tag); break;
    }
  }

  async webSocketClose(ws) {
    await this.loadRoom();
    await this.onOffline(this._tagOf(ws));
  }

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
    // 挤占：同 gid 旧连接踢下线（close 4000，复刻 hullqin 语义）
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const ot = this._tagOf(other);
      if (ot && ot.gid === tag.gid) { this._send(other, { t: 'kicked', reason: 'duplicate' }); try { other.close(4000, 'duplicate'); } catch {} }
    }
    let seat = this.seatOf(tag.gid);
    if (seat === -1) {
      const free = r.seats.findIndex(s => !s);
      if (free !== -1) {
        seat = free;
        r.seats[seat] = { gid: tag.gid, name: tag.name, avatar: tag.avatar, connected: true };
        if (!r.owner) r.owner = tag.gid;
      } else {
        r.spectators[tag.gid] = { name: tag.name };
      }
    } else {
      r.seats[seat].connected = true;
      r.seats[seat].name = tag.name;
      r.seats[seat].avatar = tag.avatar;
    }
    tag.seat = seat;
    // 持久化 seat 到 WS 标签（hibernation 复活后仍可读）
    try { this.state.getWebSockets().includes(ws) && this.state.acceptWebSocket(ws, [JSON.stringify(tag)]); } catch {}
    this.saveRoom();
    this._send(ws, { t: 'welcome', you: { seat, gid: tag.gid }, room: this.roomView() });
    this._broadcast({ t: 'players', players: this.playerList() });
  }

  handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) { this._send(ws, { t: 'error', msg: '只有房主可以开始' }); return; }
    const players = r.seats.filter(Boolean);
    if (players.length < 2) { this._send(ws, { t: 'error', msg: '五子棋需要 2 名玩家' }); return; }
    // 座位压缩：黑方=座位0，白方=座位1
    this.room.seats = players.slice(0, 2);
    r.game = newGame();
    r.started = true;
    r.winners = [];
    this.saveRoom();
    this._broadcast({ t: 'start', game: r.game, room: this.roomView() });
  }

  handlePlace(ws, tag, m) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    if (seat < 0) { this._send(ws, { t: 'error', msg: '观战不能落子' }); return; }
    try {
      place(r.game, seat, m.x, m.y);
    } catch (e) {
      this._send(ws, { t: 'error', msg: e.message });
      return;
    }
    if (r.game.winner !== null) {
      r.winners = r.game.winner === -1 ? [] : [r.game.winner];
      r.started = 'over';
      this.saveRoom();
      this._broadcast({ t: 'finished', winner: r.game.winner, game: r.game, room: this.roomView() });
      reportResult(this.env, 'gobang', this.room.seats, r.winners);
      return;
    }
    this.saveRoom();
    this._broadcast({ t: 'game', game: r.game, by: seat });
  }

  handleChat(ws, tag, m) {
    const text = String(m.text || '').slice(0, 200);
    if (!text) return;
    const seat = this.seatOf(tag.gid);
    this._broadcast({ t: 'chat', seat, name: tag.name, text });
  }

  async handleLeave(ws, tag) {
    await this.onOffline(tag);
    try { ws.close(1000, 'leave'); } catch {}
  }

  async onOffline(tag) {
    if (!tag) return;
    await this.loadRoom();
    const r = this.room;
    const seat = this.seatOf(tag.gid);
    if (seat !== -1 && r.seats[seat]) {
      r.seats[seat].connected = false;
      this.saveRoom();
      this._broadcast({ t: 'players', players: this.playerList() });
    } else if (r.spectators[tag.gid]) {
      delete r.spectators[tag.gid];
      this.saveRoom();
    }
  }

  playerList() {
    return this.room.seats.map((s, i) => s ? {
      seat: i, name: s.name, avatar: s.avatar, connected: s.connected,
      owner: this.room.owner === s.gid, color: COLORS[i], cn: CN[i],
    } : null);
  }

  roomView() {
    return {
      code: this.room.code, owner: this.room.owner,
      players: this.playerList(), started: this.room.started,
      game: this.room.game, winners: this.room.winners,
    };
  }

  _send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
  _broadcast(obj) {
    for (const ws of this.state.getWebSockets()) this._send(ws, obj);
  }
}
