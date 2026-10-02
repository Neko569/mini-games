// Durable Object: 达芬奇密码房间（2-4 人推理）
import { newGame, draw, guess, discard, faceDownCount } from './davinci.js';

export class DavinciRoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
  }

  async loadRoom() {
    if (this.room) return this.room;
    this.room = (await this.state.storage.get('room')) || {
      code: null, seats: Array(4).fill(null), owner: null,
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
    let m;
    try { m = JSON.parse(message); } catch { return; }
    try {
      switch (m.t) {
        case 'join': this.handleJoin(ws, tag); break;
        case 'start': this.handleStart(ws, tag); break;
        case 'draw': this.handleDraw(ws, tag); break;
        case 'guess': this.handleGuess(ws, tag, m); break;
        case 'discard': this.handleDiscard(ws, tag, m); break;
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
      if (free === -1) { this._send(ws, { t: 'error', msg: '房间已满（达芬奇密码 2-4 人）' }); return; }
      seat = free;
      r.seats[seat] = { gid: tag.gid, name: tag.name, avatar: tag.avatar, connected: true };
      if (!r.owner) r.owner = tag.gid;
    } else {
      r.seats[seat].connected = true;
      r.seats[seat].name = tag.name;
    }
    this.saveRoom();
    this._send(ws, { t: 'welcome', you: { seat }, room: this.roomView() });
    this._broadcast({ t: 'players', players: this.playerList() });
    if (r.started && r.game) this._send(ws, { t: 'hand', cards: r.game.hands[seat] });
  }

  handleStart(ws, tag) {
    const r = this.room;
    if (r.owner !== tag.gid) { this._send(ws, { t: 'error', msg: '只有房主可以开始' }); return; }
    const players = r.seats.filter(Boolean);
    if (players.length < 2) { this._send(ws, { t: 'error', msg: '至少需要 2 名玩家' }); return; }
    r.seats = players;
    r.game = newGame(players.length);
    r.started = true; r.winners = [];
    this.saveRoom();
    this._broadcast({ t: 'start', room: this.roomView() });
    this.pushHands();
    this._broadcast({ t: 'state', pub: this.pubView() });
  }

  handleDraw(ws, tag) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    draw(r.game, seat);
    this.saveRoom();
    this.pushHands();
    this._send(ws, { t: 'drawn', card: r.game.hands[seat].find(k => k.uid === r.game.drawnUid) });
    this._broadcast({ t: 'state', pub: this.pubView() });
  }

  handleGuess(ws, tag, m) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    guess(r.game, seat, m.seat, m.uid, m.c, m.r);
    this.saveRoom();
    this.pushHands();
    this._broadcast({ t: 'state', pub: this.pubView() });
    if (r.game.winner !== null) {
      r.winners = [r.game.winner];
      r.started = 'over';
      this.saveRoom();
      this._broadcast({ t: 'finished', winner: r.game.winner, pub: this.pubView(), room: this.roomView() });
    }
  }

  handleDiscard(ws, tag, m) {
    const r = this.room;
    const seat = this.seatOf(tag ? tag.gid : '');
    if (!r.started || !r.game) { this._send(ws, { t: 'error', msg: '对局未开始' }); return; }
    discard(r.game, seat, m.uid);
    this.saveRoom();
    this.pushHands();
    this._broadcast({ t: 'state', pub: this.pubView() });
    if (r.game.winner !== null) {
      r.winners = [r.game.winner];
      r.started = 'over';
      this.saveRoom();
      this._broadcast({ t: 'finished', winner: r.game.winner, pub: this.pubView(), room: this.roomView() });
    }
  }

  pushHands() {
    for (const ws of this.state.getWebSockets()) {
      const tag = this._tagOf(ws);
      const seat = tag ? this.seatOf(tag.gid) : -1;
      if (seat >= 0) this._send(ws, { t: 'hand', cards: this.room.game.hands[seat] });
    }
  }

  /* 公开视角：每人只有 明牌列表 + 暗牌数量 */
  pubView() {
    const g = this.room.game;
    return {
      turn: g.turn,
      deckLeft: g.deck.length,
      drawnBy: g.drawnUid ? g.hands.findIndex(h => h.some(k => k.uid === g.drawnUid)) : null,
      mustGuess: g.drawnUid === null && g.deck.length === 0,
      winner: g.winner,
      last: g.lastAction,
      players: g.hands.map((h, i) => ({
        seat: i,
        revealed: h.filter(c => c.revealed),
        faceDown: faceDownCount(g, i),
        downUids: h.filter(c => !c.revealed).map(c => c.uid), // uid 无信息量，仅作猜测目标定位
        eliminated: g.eliminated[i],
      })),
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
