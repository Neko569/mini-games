// UNO 房间插件（2-6 人）—— 公共逻辑在 room-base.js
import { newGame, play, drawCards, mustDraw, CNAME } from './uno.js';
import { BaseRoomDO } from './room-base.js';

function pushHands(base) {
  for (const ws of base.state.getWebSockets()) {
    const tag = base._tagOf(ws);
    const seat = tag ? base.seatOf(tag.gid) : -1;
    if (seat >= 0) base._send(ws, { t: 'hand', cards: base.room.game.hands[seat] });
  }
}

function pubView(base) {
  const g = base.room.game;
  return {
    turn: g.turn, dir: g.dir, color: g.color, pendingDraw: g.pendingDraw,
    top: g.discard[g.discard.length - 1],
    handCounts: g.hands.map(h => h.length),
    deckLeft: g.deck.length,
    winner: g.winner,
  };
}

const DEF = {
  game: 'uno', max: 6,
  minPlayers: 2, minMsg: 'UNO 至少需要 2 人',
  fullMsg: '房间已满（6 人）', fullClose: true,
  roomWinners: true,
  newGame: (seats) => newGame(seats.length),
  afterStart: (base) => { pushHands(base); base._broadcast({ t: 'state', pub: pubView(base) }); },
  rejoinSync: (base, ws, seat) => base._send(ws, { t: 'state', pub: pubView(base), hand: base.room.game.hands[seat] }),
  actions: {
    play(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      play(r.game, seat, m.idx, m.color); // 观战/轮次错误由引擎抛错 → error
      if (r.game.winner !== null) {
        base.finish([r.game.winner], { t: 'finished', winner: r.game.winner, pub: pubView(base), room: base.roomView() });
        return;
      }
      base.saveRoom();
      pushHands(base);
      base._broadcast({ t: 'state', pub: pubView(base), last: r.game.lastPlay });
    },
    draw(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      const res = drawCards(r.game, seat);
      base.saveRoom();
      pushHands(base);
      base._send(ws, { t: 'drawn', cards: res.drawn });
      base._broadcast({ t: 'state', pub: pubView(base) });
    },
  },
};

export class UnoRoomDO extends BaseRoomDO {
  constructor(state, env) { super(state, env, DEF); }
}
