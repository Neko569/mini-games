// Durable Object: UNO 房间（2-6 人，SQLite 持久化 + WS Hibernation）
import { reportResult } from './stats-report.js';
import { newGame, play, drawCards, mustDraw, CNAME } from './uno.js';

export class UnoRoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.state.storage.get('room')) || {
      code: null, seats: Array(6).fill(null), owner: null,
      started: false, game: null, winners: [],
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
    let m; try { m = JSON.parse(message); } catch { return; }
    try {
      switch (m.t) {
        case 'join': await this.handleJoin(ws, tag); break;
        case 'start': await this.handleStart(ws, tag); break;
        case 'play': await this.handlePlay(ws, tag, m); break;
        case 'draw': await this.handleDraw(ws, tag, m); break;
        case 'chat': this.handleChat(ws, tag, m); break;
        case 'leave': await this.handleLeave(ws, tag); break;
      }
    } catch (e) {
      this._send(ws, { t: 'error', msg: e.message || String(e) });
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

  async handleJoin(ws, tag) {
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
        this._send(ws, { t: 'error', msg: '房间已满（6 人）' });
        try { ws.close(1000, 'full'); } catch {}
        return;
      }
    } else {
      r.seats[seat].connected = true;
      r.seats[seat].name = tag.name;
      r.seats[seat].avatar = tag.avatar;
    }
    tag.seat = seat;
    try { this.state.acceptWebSocket(ws, [JSON.stringify(tag)]); } catch {}
    this.saveRoom();
    this._send(ws, { t: 'welcome', you: { seat, gid: tag.gid }, room: this.roomView() });
    if (r.started && r.game) this._send(ws, { t: 'state', pub: this.pubView(), hand: r.game.hands[seat] });
    this._broadcast({ t: 'players', players: this.playerList() });
  }

  async handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) { this._send(ws, { t: 'error', msg: '只有房主可以开始' }); return; }
    const players = r.seats.filter(Boolean);
    if (players.length < 2) { this._send(ws, { t: 'error', msg: 'UNO 至少需要 2 人' }); return; }
    r.seats = players;
    r.game = newGame(players.length);
    r.started = true; r.winners = [];
    this.saveRoom();
    this._broadcast({ t: 'start', room: this.roomView() });
    this.pushHands();
    this._broadcast({ t: 'state', pub: this.pubView() });
  }

  async handlePlay(ws, tag, m) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    play(r.game, seat, m.idx, m.color); // 引擎抛错由外层 catch 发 error
    if (r.game.winner !== null) {
      r.winners = [r.game.winner];
      r.started = 'over';
      this.saveRoom();
      this._broadcast({ t: 'finished', winner: r.game.winner, pub: this.pubView(), room: this.roomView() });
      reportResult(this.env, 'uno', this.room.seats, r.winners);
      return;
    }
    this.saveRoom();
    this.pushHands();
    this._broadcast({ t: 'state', pub: this.pubView(), last: r.game.lastPlay });
  }

  async handleDraw(ws, tag, m) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    const res = drawCards(r.game, seat);
    this.saveRoom();
    this.pushHands();
    this._send(ws, { t: 'drawn', cards: res.drawn });
    this._broadcast({ t: 'state', pub: this.pubView() });
  }

  handleChat(ws, tag, m) {
    const text = String(m.text || '').slice(0, 200);
    if (!text) return;
    this._broadcast({ t: 'chat', seat: this.seatOf(tag.gid), name: tag.name, text });
  }

  async handleLeave(ws, tag) { await this.onOffline(tag); try { ws.close(1000, 'leave'); } catch {} }

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

  pushHands() {
    for (const ws of this.state.getWebSockets()) {
      const tag = this._tagOf(ws);
      const seat = tag ? this.seatOf(tag.gid) : -1;
      if (seat >= 0) this._send(ws, { t: 'hand', cards: this.room.game.hands[seat] });
    }
  }

  pubView() {
    const g = this.room.game;
    return {
      turn: g.turn, dir: g.dir, color: g.color, pendingDraw: g.pendingDraw,
      top: g.discard[g.discard.length - 1],
      handCounts: g.hands.map(h => h.length),
      deckLeft: g.deck.length,
      winner: g.winner,
    };
  }
  playerList() {
    return this.room.seats.map((s, i) => s ? {
      seat: i, name: s.name, avatar: s.avatar, connected: s.connected,
      owner: this.room.owner === s.gid,
    } : null);
  }
  roomView() {
    return { code: this.room.code, owner: this.room.owner, players: this.playerList(), started: this.room.started, winners: this.room.winners };
  }
  _send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  _broadcast(obj) { for (const ws of this.state.getWebSockets()) this._send(ws, obj); }
}
