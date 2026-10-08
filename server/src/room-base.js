// BaseRoomDO —— Node 版房间基类（与 Cloudflare 版 src/room-base.js 逻辑逐行对应）
// 通过 state/env shim 复用 CF 版的游戏插件 defs（*-room.js 零改动）：
//   state: { getWebSockets, getTags, storage{get,put,deleteAll,setAlarm,deleteAlarm}, acceptWebSocket, setWebSocketAutoResponsePair }
//   env:   { LOBBY: {get(){return {fetch}}}, STATS: {get(){return {fetch}}} } —— 由 server.js 提供 shim
export class BaseRoomDO {
  constructor(state, env, def) {
    this.state = state;
    this.env = env;
    this.def = def;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.state.storage.get('room')) || {
      code: null, seats: Array(this.def.max).fill(null), spectators: {},
      owner: null, started: false, game: null, winners: [],
      ...(this.def.extraState ? this.def.extraState() : {}),
    };
    return this.room;
  }

  async saveRoom() {
    if (this.room) {
      await this.state.storage.put('room', this.room);
      await reportLobby(this.env, this.def.game, this.def.max, this.room);
    }
  }

  // ---- 消息分发（与 CF 版一致：30/s 限速 + ping 兜底 + 错误包装）----
  async webSocketMessage(ws, raw) {
    let rl = this._rl && this._rl.get(ws);
    if (!rl) (this._rl ||= new WeakMap()).set(ws, rl = { n: 0, ts: 0, strikes: 0 });
    const nowMs = Date.now();
    if (nowMs - rl.ts > 1000) { rl.ts = nowMs; rl.n = 0; }
    if (++rl.n > 30) {
      if (++rl.strikes >= 3) { try { ws.close(1008, 'flood'); } catch {} }
      return;
    }
    await this.loadRoom();
    const tag = this._tagOf(ws);
    if (!tag) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') { this._send(ws, { t: 'pong' }); return; }
    const custom = this.def.actions && Object.prototype.hasOwnProperty.call(this.def.actions, m.t)
      && this.def.actions[m.t];
    try {
      if (custom) return await custom(this, ws, tag, m);
      switch (m.t) {
        case 'join':      return this.handleJoin(ws, tag);
        case 'start':     return this.handleStart(ws, tag);
        case 'chat':      return this.handleChat(ws, tag, m);
        case 'leave':     return this.handleLeave(ws, tag);
        case 'leaveSeat': return this.handleLeaveSeat(ws, tag);
      }
    } catch (e) {
      this._send(ws, { t: 'error', msg: (e && e.message) || String(e) });
    }
  }

  async webSocketClose(ws) { await this.loadRoom(); await this.onOffline(this._tagOf(ws)); }

  // ---- 闹钟统一入口：游戏计时优先，随后死房间回收 ----
  async alarm() {
    await this.loadRoom();
    if (this.def.alarm) { try { await this.def.alarm(this); } catch {} }
    try {
      if (this.state.getWebSockets().length === 0) {
        const r = this.room;
        const anyLive = r.seats.some(s => s && s.connected) || Object.keys(r.spectators || {}).length > 0;
        if (!anyLive) {
          await this.state.storage.deleteAll();
          this.room = null;
        }
      }
    } catch {}
  }

  _tagOf(ws) {
    const t = this.state.getTags(ws);
    return t || null;
  }
  seatOf(gid) { return this.room.seats.findIndex(s => s && s.gid === gid); }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  _broadcast(obj) { for (const ws of this.state.getWebSockets()) this._send(ws, obj); }

  // ---- 入座 / 重连 ----
  handleJoin(ws, tag) {
    const r = this.room;
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const ot = this._tagOf(other);
      if (ot && ot.gid === tag.gid) {
        this._send(other, { t: 'kicked', reason: 'duplicate' });
        try { other.close(4000, 'duplicate'); } catch {}
      }
    }
    let seat = this.seatOf(tag.gid);
    if (seat >= 0) {
      r.seats[seat].connected = true;
      r.seats[seat].name = tag.name;
      r.seats[seat].avatar = tag.avatar;
    } else {
      seat = r.seats.findIndex(s => !s);
      if (seat >= 0) {
        r.seats[seat] = { gid: tag.gid, name: tag.name, avatar: tag.avatar, connected: true, joinedAt: Date.now() };
        if (!r.owner) r.owner = tag.gid;
      } else if (this.def.spectate) {
        if (Object.keys(r.spectators || {}).length >= 50) {
          this._send(ws, { t: 'error', msg: '观战人数已达上限' });
          return;
        }
        r.spectators[tag.gid] = { name: tag.name, avatar: tag.avatar };
      } else {
        this._send(ws, { t: 'error', msg: this.def.fullMsg });
        this._send(ws, { t: 'kicked', reason: 'full' });
        if (this.def.fullClose) { try { ws.close(4001, 'full'); } catch {} }
        return;
      }
    }
    this.saveRoom();
    const room = this.def.welcomeRoom ? this.def.welcomeRoom(this, seat) : this.roomView();
    this._send(ws, { t: 'welcome', you: { seat, gid: tag.gid }, room });
    this._broadcast({ t: 'players', players: this.playerList() });
    if (r.started === true && r.game && this.def.rejoinSync) this.def.rejoinSync(this, ws, seat);
  }

  handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) throw new Error('只有房主可以开始');
    const players = r.seats.filter(Boolean);
    if (players.length < this.def.minPlayers) throw new Error(this.def.minMsg);
    r.seats = players.slice(0, this.def.max);
    r.game = this.def.newGame(r.seats);
    r.started = true;
    r.winners = [];
    this.saveRoom();
    this._broadcast({ t: 'start', room: this.roomView(), ...(this.def.viewGame ? { game: r.game } : {}) });
    if (this.def.afterStart) this.def.afterStart(this);
  }

  handleChat(ws, tag, m) {
    const text = String(m.text || '').slice(0, 200);
    if (!text) return;
    const seat = this.seatOf(tag.gid);
    const name = seat >= 0 ? this.room.seats[seat].name
      : ((this.room.spectators && this.room.spectators[tag.gid]) || {}).name || '观战';
    this._broadcast({ t: 'chat', seat, name, text });
  }

  handleLeaveSeat(ws, tag) {
    const seat = this.seatOf(tag.gid);
    if (seat < 0 || this.room.started === true) return;
    this.room.seats[seat] = null;
    if (this.room.owner === tag.gid) {
      this.room.owner = (this.room.seats.find(s => s) || {}).gid || null;
    }
    this.saveRoom();
    this._broadcast({ t: 'players', players: this.playerList() });
  }

  async handleLeave(ws, tag) { await this.onOffline(tag); try { ws.close(1000, 'leave'); } catch {} }

  async onOffline(tag) {
    if (!tag) return;
    const r = this.room;
    const seat = this.seatOf(tag.gid);
    if (seat >= 0 && r.seats[seat]) {
      r.seats[seat].connected = false;
    } else if (r.spectators && r.spectators[tag.gid]) {
      delete r.spectators[tag.gid];
    }
    this.saveRoom();
    this._broadcast({ t: 'players', players: this.playerList() });
    if (this.state.getWebSockets().length === 0) {
      this.state.storage.setAlarm(Date.now() + 10 * 60 * 1000); // 10 分钟后回收
    }
  }

  async finish(winners, msg) {
    const r = this.room;
    r.started = 'over';
    r.winners = winners || [];
    await this.saveRoom();
    this._broadcast(msg);
    await reportResult(this.env, this.def.game, r.seats, r.winners);
  }

  playerList() {
    return this.room.seats.map((s, i) => s ? {
      seat: i, name: s.name, avatar: s.avatar, connected: s.connected,
      owner: this.room.owner === s.gid,
      ...(this.def.colors ? { color: this.def.colors[i], ...(this.def.cn ? { cn: this.def.cn[i] } : {}) } : {}),
    } : null);
  }

  roomView() {
    const v = { code: this.room.code, owner: this.room.owner, players: this.playerList(), started: this.room.started };
    if (this.def.viewGame) v.game = this.room.game;
    if (this.def.viewGame || this.def.roomWinners) v.winners = this.room.winners;
    return v;
  }
}

// 与 CF 版同签名的上报模块（stub 转发到 env shim，见 hubs.js / server.js）
import { reportLobby } from './lobby.js';
import { reportResult } from './stats-report.js';
