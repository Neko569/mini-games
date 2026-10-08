// 五子棋房间插件（2 人对坐 + 观战）—— 公共逻辑在 room-base.js
import { newGame, place } from './gobang.js';
import { BaseRoomDO } from './room-base.js';

const COLORS = ['#1a1a1a', '#f5f5f5']; // 黑 白
const CN = ['黑方', '白方'];

const DEF = {
  game: 'gobang', max: 2,
  minPlayers: 2, minMsg: '五子棋需要 2 名玩家',
  fullMsg: '房间已满（2 人）', fullClose: false,
  spectate: true, viewGame: true,
  colors: COLORS, cn: CN,
  newGame: () => newGame(),
  actions: {
    place(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战不能落子');
      place(r.game, seat, m.x, m.y);
      if (r.game.winner !== null) {
        const winners = r.game.winner === -1 ? [] : [r.game.winner];
        base.finish(winners, { t: 'finished', winner: r.game.winner, game: r.game, room: base.roomView() });
        return;
      }
      base.saveRoom();
      base._broadcast({ t: 'game', game: r.game, by: seat });
    },
  },
};

export class GobangRoomDO extends BaseRoomDO {
  constructor(state, env) { super(state, env, DEF); }
}
