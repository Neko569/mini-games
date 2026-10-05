// 达芬奇密码房间插件（2-4 人推理）—— 公共逻辑在 room-base.js
import { newGame, draw, guess, discard, faceDownCount } from './davinci.js';
import { BaseRoomDO } from './room-base.js';

function pushHands(base) {
  for (const ws of base.state.getWebSockets()) {
    const tag = base._tagOf(ws);
    const seat = tag ? base.seatOf(tag.gid) : -1;
    if (seat >= 0) base._send(ws, { t: 'hand', cards: base.room.game.hands[seat] });
  }
}

/* 公开视角：每人只有 明牌列表 + 暗牌数量 */
function pubView(base) {
  const g = base.room.game;
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

function stateMsg(base) { return { t: 'state', pub: pubView(base) }; }

const DEF = {
  game: 'davinci', max: 4,
  minPlayers: 2, minMsg: '至少需要 2 名玩家',
  fullMsg: '房间已满（达芬奇密码 2-4 人）', fullClose: false,
  newGame: (seats) => newGame(seats.length),
  afterStart: (base) => { pushHands(base); base._broadcast(stateMsg(base)); },
  rejoinSync: (base, ws, seat) => base._send(ws, { t: 'hand', cards: base.room.game.hands[seat] }),
  actions: {
    draw(base, ws, tag) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      draw(r.game, seat);
      base.saveRoom();
      pushHands(base);
      base._send(ws, { t: 'drawn', card: r.game.hands[seat].find(k => k.uid === r.game.drawnUid) });
      base._broadcast(stateMsg(base));
    },
    guess(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      guess(r.game, seat, m.seat, m.uid, m.c, m.r);
      base.saveRoom();
      pushHands(base);
      base._broadcast(stateMsg(base));
      if (r.game.winner !== null) {
        base.finish([r.game.winner], { t: 'finished', winner: r.game.winner, pub: pubView(base), room: base.roomView() });
      }
    },
    discard(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      discard(r.game, seat, m.uid);
      base.saveRoom();
      pushHands(base);
      base._broadcast(stateMsg(base));
      if (r.game.winner !== null) {
        base.finish([r.game.winner], { t: 'finished', winner: r.game.winner, pub: pubView(base), room: base.roomView() });
      }
    },
  },
};

export class DavinciRoomDO extends BaseRoomDO {
  constructor(state, env) { super(state, env, DEF); }
}
