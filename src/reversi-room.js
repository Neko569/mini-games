// Durable Object: 黑白棋房间（2 人，黑=座位0 白=座位1）
import { newGame, move, pass, legalMoves, counts } from './reversi.js';
import { reportResult } from './stats-report.js';
import { reportLobby } from './lobby.js';

export class ReversiRoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.state.storage.get('room')) || {
      code: null, seats: Array(2).fill(null), owner: null,
      started: false, game: null, winners: [],
    };
    return this.room;
  }
  async saveRoom() {
    if (this.room) {
      await this.state.storage.put('room', this.room);
      await reportLobby(this.env, 'reversi', 2, this.room);
    }
  }

  async fetch(req) {
    await this.loadRoom();
    const url = new URL(req.url);
    if (url.pathname === '/probe') {
      const occupied = this.room.seats.some(s => s && s.connected) || this.room.started === true;
      return Response.json({ code: this.room.code, occupied, started: this.room.started === true });
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const u = new URL(req.url);
      const tag = {
        gid: u.searchParams.get('gid') || '',
        name: (u.searchParams.get('name') || '玩家').slice(0, 16),
        avatar: (u.searchParams.get('avatar') || '').slice(0, 500),
      };
      if (!this.room.code) this.room.code = u.searchParams.get('room') || null;
      await this.saveRoom(); // 持久化房间号（休眠唤醒后 storage 中 code 才非空）
      this.state.acceptWebSocket(pair[1], [JSON.stringify(tag)]);
      this.handleJoin(pair[1], tag);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    let tag = null;
    try { tag = JSON.parse(this.state.getTags(ws)[0] || 'null'); } catch {}
    try {
      switch (m.t) {
        case 'join': this.handleJoin(ws, tag); break;
        case 'start': this.handleStart(ws, tag); break;
        case 'place': this.handlePlace(ws, tag, m); break;
        case 'pass': this.handlePass(ws, tag); break;
        case 'chat': this.handleChat(ws, tag, m); break;
        case 'leave': this.handleLeave(ws, tag); break;
      }
    } catch (e) {
      this._send(ws, { t: 'error', msg: e.message });
    }
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
      if (free !== -1) {
        seat = free;
        r.seats[seat] = { gid: tag.gid, name: tag.name, avatar: tag.avatar, connected: true };
        if (!r.owner) r.owner = tag.gid;
      } else {
        r.spectators = r.spectators || {};
        r.spectators[tag.gid] = { name: tag.name };
      }
    } else {
      r.seats[seat].connected = true;
      r.seats[seat].name = tag.name;
      r.seats[seat].avatar = tag.avatar;
    }
    tag.seat = seat;
    try { this.state.getWebSockets().includes(ws) && this.state.acceptWebSocket(ws, [JSON.stringify(tag)]); } catch {}
    this.saveRoom();
    this._send(ws, { t: 'welcome', you: { seat, gid: tag.gid }, room: this.roomView() });
    if (r.started && r.game) this._send(ws, { t: 'state', pub: this.pubView() });
    this._broadcast({ t: 'players', players: this.playerList() });
  }

  handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) { this._send(ws, { t: 'error', msg: '只有房主能开始' }); return; }
    const active = r.seats.filter(Boolean).length;
    if (active < 2) { this._send(ws, { t: 'error', msg: '至少需要 2 名玩家' }); return; }
    r.started = true; r.winners = [];
    r.game = newGame();
    this.saveRoom();
    this._broadcast({ t: 'start', room: this.roomView() });
    this._broadcast({ t: 'state', pub: this.pubView() });
  }

  handlePlace(ws, tag, m) {
    const r = this.room;
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    const seat = this.seatOf(tag ? tag.gid : '');
    if (seat < 0) { this._send(ws, { t: 'error', msg: '观战不能落子' }); return; }
    const x = m.x | 0, y = m.y | 0;
    if (x < 0 || x > 7 || y < 0 || y > 7) { this._send(ws, { t: 'error', msg: '坐标越界' }); return; }
    const color = seat + 1; // 座位0=黑(1) 座位1=白(2)
    move(r.game, color, x, y);
    this.saveRoom();
    this._broadcast(this.moveMsg(x, y, seat));
    if (r.game.winner !== null) {
      r.winners = r.game.winner === -1 ? [] : [r.game.winner - 1];
      this._broadcast({ t: 'finished', winner: r.game.winner, score: r.game.score, pub: this.pubView(), room: this.roomView() });
      reportResult(this.env, 'reversi', this.room.seats, r.winners);
    }
  }

  handlePass(ws, tag) {
    const r = this.room;
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    const seat = this.seatOf(tag ? tag.gid : '');
    if (seat < 0) { this._send(ws, { t: 'error', msg: '观战不能跳过' }); return; }
    pass(r.game, seat + 1);
    this.saveRoom();
    this._broadcast({ t: 'passby', seat, nextTurn: r.game.turn, pub: this.pubView() });
    if (r.game.winner !== null) {
      r.winners = r.game.winner === -1 ? [] : [r.game.winner - 1];
      this._broadcast({ t: 'finished', winner: r.game.winner, score: r.game.score, pub: this.pubView(), room: this.roomView() });
      reportResult(this.env, 'reversi', this.room.seats, r.winners);
    }
  }

  moveMsg(x, y, seat) {
    const g = this.room.game;
    const last = g.moves[g.moves.length - 1];
    return {
      t: 'move', x, y, seat, flips: last.flips,
      autoPass: !!last.autoPass,
      nextTurn: g.turn, winner: g.winner,
      score: g.score || null,
      pub: this.pubView(),
    };
  }

  handleChat(ws, tag, m) {
    const name = tag && this.seatOf(tag.gid) >= 0 ? this.room.seats[this.seatOf(tag.gid)].name : (this.room.spectators || {})[tag?.gid]?.name || '观战';
    if (!m.text) return;
    this._broadcast({ t: 'chat', name, text: String(m.text).slice(0, 200) });
  }

  handleLeave(ws, tag) {
    const seat = this.seatOf(tag ? tag.gid : '');
    if (seat >= 0 && !this.room.started) {
      this.room.seats[seat] = null;
      if (this.room.owner === tag.gid) this.room.owner = this.room.seats.find(Boolean)?.gid || null;
    }
    this.saveRoom();
    try { ws.close(1000, 'bye'); } catch {}
    this._broadcast({ t: 'players', players: this.playerList() });
  }

  pubView() {
    const g = this.room.game;
    const c = counts(g.board);
    return {
      board: g.board, turn: g.turn, winner: g.winner, score: g.score || null,
      legal: legalMoves(g.board, g.turn),
      lastMove: g.moves.length ? g.moves[g.moves.length - 1] : null,
      black: c.black, white: c.white,
      seats: this.room.seats.map((s, i) => s ? { seat: i, gid: s.gid, name: s.name, avatar: s.avatar, connected: s.connected } : null),
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

  async webSocketClose(ws) {
    await this.loadRoom();
    let tag = null;
    try { tag = JSON.parse(this.state.getTags(ws)[0] || 'null'); } catch {}
    const seat = this.seatOf(tag ? tag.gid : '');
    if (seat >= 0 && this.room.seats[seat]) {
      this.room.seats[seat].connected = false;
      this.saveRoom();
      this._broadcast({ t: 'players', players: this.playerList() });
    }
  }

  _tagOf(ws) { try { return JSON.parse(this.state.getTags(ws)[0] || 'null'); } catch { return null; } }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  _broadcast(obj) { for (const ws of this.state.getWebSockets()) this._send(ws, obj); }
}
