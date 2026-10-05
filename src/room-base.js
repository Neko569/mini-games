// BaseRoomDO —— 房间 DO 插件化基类
// 公共逻辑全在这里：连接生命周期（WS 升级 / hibernation 消息分发 / 离线）、
// 座位管理（入座/重连复活/挤占/让座）、心跳自动应答（不唤醒 DO）、
// 持久化 + 大厅上报、聊天、终局上报收口。
// 每个游戏只需提供一个 def（插件描述）+ 游戏专属 actions，见各 *-room.js。
import { reportLobby } from './lobby.js';
import { reportResult } from './stats-report.js';

// 头像消毒：只放行 data:image 与 https 图片地址，且不得含 HTML 危险字符
function cleanAvatar(raw) {
  if (!raw || raw.length > 600) return '';
  if (!/^(data:image\/[a-z0-9.+-]+;|https:\/\/)/i.test(raw)) return '';
  if (/["'`<>\s\\]/.test(raw)) return '';
  return raw;
}

export class BaseRoomDO {
  constructor(state, env, def) {
    this.state = state;
    this.env = env;
    this.def = def;
    this.room = null;
    // 心跳自动应答：ping/pong 在 platform 层完成，不唤醒 DO、不计费
    try {
      this.state.setWebSocketAutoResponsePair(
        new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    } catch {}
  }

  // ---- 状态 ----
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

  // ---- HTTP：probe + WS 升级 ----
  async fetch(req) {
    await this.loadRoom();
    const url = new URL(req.url);
    if (url.pathname === '/probe') {
      const occupied = this.room.seats.some(s => s && s.connected) || this.room.started === true;
      return Response.json({ code: this.room.code, occupied, started: this.room.started === true });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 400 });
    if (!this.room.code) this.room.code = url.searchParams.get('room') || null;
    await this.saveRoom(); // 持久化房间号（休眠唤醒后 storage 中 code 才非空）

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const info = {
      // 输入消毒：昵称剥离 HTML 危险字符（防存储型 XSS）；头像仅允许 data:image / https 且
      // 不含引号/尖括号/空白（防 <img src="..."> 属性逃逸）
      gid: url.searchParams.get('gid') || crypto.randomUUID(),
      name: (url.searchParams.get('name') || '玩家').replace(/[<>&"']/g, '').slice(0, 16) || '玩家',
      avatar: cleanAvatar(url.searchParams.get('avatar') || ''),
    };
    this.state.acceptWebSocket(server, [JSON.stringify(info)]);
    if (this.def.joinOnUpgrade) this.handleJoin(server, info);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- hibernation 消息分发 ----
  async webSocketMessage(ws, raw) {
    await this.loadRoom(); // 休眠唤醒后 room 为 null，必须先加载
    const tag = this._tagOf(ws);
    if (!tag) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') { this._send(ws, { t: 'pong' }); return; } // 兜底：dev 环境无 auto-response 时手动应答
    const custom = this.def.actions && Object.prototype.hasOwnProperty.call(this.def.actions, m.t)
      && this.def.actions[m.t]; // hasOwnProperty：防 constructor/__proto__ 等原型链键误命中
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
  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch {}
    await this.loadRoom(); await this.onOffline(this._tagOf(ws));
  }

  _tagOf(ws) {
    for (const tag of this.state.getTags(ws)) { try { return JSON.parse(tag); } catch {} }
    return null;
  }
  seatOf(gid) { return this.room.seats.findIndex(s => s && s.gid === gid); }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  _broadcast(obj) { for (const ws of this.state.getWebSockets()) this._send(ws, obj); }

  // ---- 入座 / 重连 ----
  handleJoin(ws, tag) {
    const r = this.room;
    // 挤占：同 gid 旧连接踢下线（复刻 hullqin close 4000 语义）
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
      // 断线重连：座位复活 + 同步最新资料
      r.seats[seat].connected = true;
      r.seats[seat].name = tag.name;
      r.seats[seat].avatar = tag.avatar;
    } else {
      seat = r.seats.findIndex(s => !s);
      if (seat >= 0) {
        r.seats[seat] = { gid: tag.gid, name: tag.name, avatar: tag.avatar, connected: true, joinedAt: Date.now() };
        if (!r.owner) r.owner = tag.gid;
      } else if (this.def.spectate) {
        r.spectators[tag.gid] = { name: tag.name, avatar: tag.avatar };
      } else {
        this._send(ws, { t: 'error', msg: this.def.fullMsg });
        if (this.def.fullClose) { try { ws.close(1000, 'full'); } catch {} }
        return;
      }
    }
    this.saveRoom();
    const room = this.def.welcomeRoom ? this.def.welcomeRoom(this, seat) : this.roomView();
    this._send(ws, { t: 'welcome', you: { seat, gid: tag.gid }, room });
    this._broadcast({ t: 'players', players: this.playerList() });
    if (r.started === true && r.game && this.def.rejoinSync) this.def.rejoinSync(this, ws, seat);
  }

  // ---- 开局 ----
  handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) throw new Error('只有房主可以开始');
    const players = r.seats.filter(Boolean);
    if (players.length < this.def.minPlayers) throw new Error(this.def.minMsg);
    // 座位压缩到前排
    r.seats = players.slice(0, this.def.max);
    r.game = this.def.newGame(r.seats);
    r.started = true;
    r.winners = [];
    this.saveRoom();
    this._broadcast({ t: 'start', room: this.roomView(), ...(this.def.viewGame ? { game: r.game } : {}) });
    if (this.def.afterStart) this.def.afterStart(this);
  }

  // ---- 聊天 ----
  handleChat(ws, tag, m) {
    const text = String(m.text || '').slice(0, 200);
    if (!text) return;
    const seat = this.seatOf(tag.gid);
    const name = seat >= 0 ? this.room.seats[seat].name
      : ((this.room.spectators && this.room.spectators[tag.gid]) || {}).name || '观战';
    this._broadcast({ t: 'chat', seat, name, text });
  }

  // ---- 让座 / 离开 ----
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
  }

  // ---- 终局：统一收口（started='over' + 战绩上报）----
  async finish(winners, msg) {
    const r = this.room;
    r.started = 'over';
    r.winners = winners || [];
    await this.saveRoom();
    this._broadcast(msg);
    reportResult(this.env, this.def.game, r.seats, r.winners);
  }

  // ---- 视图 ----
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
