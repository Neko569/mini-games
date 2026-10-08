// 炸飞机房间插件（2 人，布局阶段 + 交战阶段）—— 公共逻辑在 room-base.js
import { reportResult } from './stats-report.js';
import { newGame, place, strike, bothPlaced } from './planes.js';
import { BaseRoomDO } from './room-base.js';

/* 视角裁剪：自己看得到自己的布局；对方机头只在击落时揭晓 */
function pubGame(base, seat) {
  const g = base.room.game;
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

function sendEachPrivate(base) {
  for (const ws of base.state.getWebSockets()) {
    const tag = base._tagOf(ws);
    const seat = tag ? base.seatOf(tag.gid) : -1;
    if (seat >= 0) base._send(ws, { t: 'state', you: seat, game: pubGame(base, seat), ready: base.room.ready });
  }
}

const DEF = {
  game: 'planes', max: 2,
  minPlayers: 2, minMsg: '炸飞机需要 2 名玩家',
  fullMsg: '房间已满（炸飞机为 2 人对弈）', fullClose: false,
  extraState: () => ({ ready: [false, false] }),
  newGame: () => newGame(),
  welcomeRoom: (base, seat) => ({ ...base.roomView(), game: base.room.game ? pubGame(base, seat) : null, ready: base.room.ready }),
  afterStart: (base) => sendEachPrivate(base),
  actions: {
    place(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战不能布置');
      r.game.boards[seat] = place(m.planes);
      r.ready[seat] = true;
      if (bothPlaced(r.game)) r.game.phase = 'fighting';
      base.saveRoom();
      base._broadcast({ t: 'placed', seat, phase: r.game.phase, ready: r.ready });
    },
    strike(base, ws, tag, m) {
      const r = base.room;
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战不能打击');
      const res = strike(r.game, seat, m.x, m.y);
      base.saveRoom();
      base._broadcast({
        t: 'strike', by: seat, x: m.x, y: m.y, res,
        nextTurn: r.game.turn,
        winner: r.game.winner,
        phase: r.game.phase,
      });
      if (r.game.winner !== null) {
        // planes 保持原语义：终局广播但不置 started='over'
        base._broadcast({ t: 'finished', winner: r.game.winner });
        reportResult(base.env, 'planes', base.room.seats, [r.game.winner]);
      }
    },
  },
};

export class PlanesRoomDO extends BaseRoomDO {
  constructor(state, env) { super(state, env, DEF); }
}
