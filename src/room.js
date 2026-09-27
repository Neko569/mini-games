// Durable Object: 一个房间 = 一个 DO（状态持久化 + WebSocket Hibernation）
import { initGame, rollDice, movePlane, penalty, movablePlanes } from './engine.js';

const COLORS = ['#f43f5e', '#3b82f6', '#22c55e', '#eab308']; // 红蓝绿黄

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.state.storage.get('room')) || {
      code: null, seats: [null, null, null, null], spectators: {},
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
    const upgrade = req.headers.get('Upgrade') === 'websocket';
    if (!upgrade) return new Response('expected websocket', { status: 400 });

    if (!this.room.code) this.room.code = url.searchParams.get('room') || null;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const info = {
      gid: url.searchParams.get('gid') || crypto.randomUUID(),
      name: (url.searchParams.get('name') || '玩家').slice(0, 16),
      avatar: (url.searchParams.get('avatar') || '').slice(0, 300),
    };
    this.state.acceptWebSocket(server, [JSON.stringify(info)]);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- hibernation API ----
  async webSocketMessage(ws, raw) {
    await this.loadRoom();
    const tag = this._tagOf(ws);
    if (!tag) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      switch (msg.t) {
        case 'join':      return this.handleJoin(ws, tag);
        case 'start':     return this.handleStart(ws, tag);
        case 'roll':      return this.handleRoll(ws, tag);
        case 'move':      return this.handleMove(ws, tag, msg.plane);
        case 'pass':      return this.handlePass(ws, tag);
        case 'chat':      return this.handleChat(ws, tag, msg.text);
        case 'leaveSeat': return this.handleLeaveSeat(ws, tag);
      }
    } catch (e) {
      this._send(ws, { t: 'error', msg: String(e.message || e) });
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

  // ---- 房间逻辑 ----
  get seats() { return this.room.seats; }
  seatOf(gid) { return this.seats.findIndex(s => s && s.gid === gid); }

  handleJoin(ws, tag) {
    const r = this.room;
    // 挤占：同 gid 旧连接踢下线（复刻 hullqin close 4000 语义）
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const ot = this._tagOf(other);
      if (ot && ot.gid === tag.gid) {
        try { other.close(4000, 'duplicate'); } catch {}
      }
    }
    // 断线重连：已有座位直接复活
    let seat = this.seatOf(tag.gid);
    const isRejoin = seat >= 0;
    if (!isRejoin) {
      seat = this.seats.findIndex(s => !s);
      if (seat < 0) seat = -1; // 满员 → 观战
    }
    if (seat >= 0) {
      this.seats[seat] = { gid: tag.gid, name: tag.name, avatar: tag.avatar,
                           connected: true, joinedAt: Date.now() };
    } else {
      r.spectators[tag.gid] = { name: tag.name, avatar: tag.avatar };
    }
    if (r.owner === null && seat >= 0) r.owner = tag.gid;
    this.saveRoom();

    this._send(ws, { t: 'welcome', you: { seat, gid: tag.gid }, room: this.roomView() });
    this._broadcast({ t: 'players', players: this.playerList() });
    if (r.started === true && r.game) {
      // 重连补发当前局面
      this._send(ws, {
        t: 'game', action: 'sync', by: -1, game: r.game,
        movable: (r.game.state >= 4) ? movablePlanes(r.game, r.game.state - 4) : [],
      });
    }
  }

  handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) throw new Error('只有房主可以开始');
    const players = this.seats.filter(Boolean);
    if (players.length < 2) throw new Error('至少 2 名玩家');
    // 座位压缩到前排（引擎按实际人数 n 运转：state 只会在 0..n-1 / 4..4+n-1 轮转）
    this.room.seats = players.slice(0, 4);
    const g = initGame(this.room.seats.length);
    g.seatMap = this.room.seats.map((_, i) => i);
    r.game = g;
    r.started = true;
    r.winners = [];
    this.saveRoom();
    this._broadcast({ t: 'start', room: this.roomView(), game: g });
  }

  handleRoll(ws, tag) {
    const r = this.room;
    if (r.started !== true) throw new Error('游戏未开始');
    const seat = this.seatOf(tag.gid);
    if (seat < 0) throw new Error('观战中');
    const g = r.game;
    if (g.state !== seat) throw new Error('还没轮到你');
    r.game = rollDice(g, seat);
    // 三连 6 惩罚（引擎自动）
    if (r.game.sixTimes >= 3) r.game = penalty(r.game, seat);
    this.afterAction('roll', seat);
  }

  handleMove(ws, tag, plane) {
    const r = this.room;
    if (r.started !== true) throw new Error('游戏未开始');
    const seat = this.seatOf(tag.gid);
    if (seat < 0) throw new Error('观战中');
    const g = r.game;
    if (g.state !== 4 + seat) throw new Error('未到移动阶段');
    const movable = movablePlanes(g, seat);
    if (!movable.includes(plane)) throw new Error('该飞机无法移动');
    r.game = movePlane(g, seat, plane);
    this.afterAction('move', seat);
  }

  handlePass(ws, tag) {
    const r = this.room;
    if (r.started !== true) throw new Error('游戏未开始');
    const seat = this.seatOf(tag.gid);
    if (seat < 0) throw new Error('观战中');
    const g = r.game;
    if (g.state !== 4 + seat) throw new Error('未到移动阶段');
    if (movablePlanes(g, seat).length > 0) throw new Error('你有可移动的飞机');
    r.game = penalty(g, seat);
    this.afterAction('pass', seat);
  }

  handleChat(ws, tag, text) {
    const text2 = String(text || '').slice(0, 200);
    if (!text2) return;
    const seat = this.seatOf(tag.gid);
    const name = seat >= 0 ? this.seats[seat].name : (this.room.spectators[tag.gid] || {}).name || '观战';
    this._broadcast({ t: 'chat', seat, name, text: text2 });
  }

  handleLeaveSeat(ws, tag) {
    const seat = this.seatOf(tag.gid);
    if (seat >= 0) {
      if (this.room.started !== true) {
        this.seats[seat] = null;
        if (this.room.owner === tag.gid) {
          this.room.owner = (this.seats.find(s => s) || {}).gid || null;
        }
        this.saveRoom();
        this._broadcast({ t: 'players', players: this.playerList() });
      }
    }
  }

  async onOffline(tag) {
    if (!tag) return;
    const seat = this.seatOf(tag.gid);
    if (seat >= 0) {
      this.seats[seat].connected = false;
    } else {
      delete this.room.spectators[tag.gid];
    }
    this.saveRoom();
    this._broadcast({ t: 'players', players: this.playerList() });
  }

  // 空座位托管：引擎 state 轮到没人坐的槽位时自动掷骰+移动
  autoEmptyTurns() {
    const r = this.room;
    if (!r.game || r.started !== true) return;
    const seatMap = new Set(r.game.seatMap);
    let guard = 0;
    while (guard++ < 40) {
      const g = r.game;
      const p = g.state;
      if (p < 4 && seatMap.has(p) && !this.seats[p]) {
        // 空位掷骰
        r.game = rollDice(g, p);
        if (r.game.sixTimes >= 3) r.game = penalty(r.game, p);
        continue;
      }
      if (g.state >= 4) {
        const q = g.state - 4;
        if (seatMap.has(q) && !this.seats[q]) {
          const mv = movablePlanes(g, q);
          if (mv.length) r.game = movePlane(g, q, mv[Math.floor(Math.random() * mv.length)]);
          else r.game = penalty(g, q);
          continue;
        }
      }
      break;
    }
  }

  afterAction(action, seat) {
    const r = this.room;
    this.autoEmptyTurns();
    const activePlayers = r.game.seatMap.length;
    // 终局判定：与官方 bot 相同 —— winners >= 活跃人数-1
    if (r.game.winners.length >= activePlayers - 1) {
      r.started = 'over';
      r.winners = r.game.winners;
      this.saveRoom();
      this._broadcast({ t: 'finished', winners: r.game.winners, game: r.game, room: this.roomView() });
      return;
    }
    this.saveRoom();
    this._broadcast({
      t: 'game', action, by: seat,
      game: r.game,
      movable: (r.game.state >= 4) ? movablePlanes(r.game, r.game.state - 4) : [],
    });
  }

  playerList() {
    return this.room.seats.map((s, i) => s ? {
      seat: i, name: s.name, avatar: s.avatar, connected: s.connected,
      owner: this.room.owner === s.gid, color: COLORS[i],
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
    for (const ws of this.state.getWebSockets()) {
      this._send(ws, obj);
    }
  }
}
