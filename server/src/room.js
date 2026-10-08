// 飞行棋房间插件（2-4 人）—— 公共逻辑在 room-base.js
import { initGame, rollDice, movePlane, penalty, movablePlanes } from './engine.js';
import { BaseRoomDO } from './room-base.js';

const COLORS = ['#f43f5e', '#3b82f6', '#22c55e', '#eab308']; // 红蓝绿黄

// 空座位托管：引擎 state 轮到没人坐的槽位时自动掷骰+移动
function autoEmptyTurns(base) {
  const r = base.room;
  if (!r.game || r.started !== true) return;
  const seatMap = new Set(r.game.seatMap);
  let guard = 0;
  while (guard++ < 40) {
    const g = r.game;
    const p = g.state;
    if (p < 4 && seatMap.has(p) && !base.room.seats[p]) {
      r.game = rollDice(g, p);
      if (r.game.sixTimes >= 3) r.game = penalty(r.game, p);
      continue;
    }
    if (g.state >= 4) {
      const q = g.state - 4;
      if (seatMap.has(q) && !base.room.seats[q]) {
        const mv = movablePlanes(g, q);
        if (mv.length) r.game = movePlane(g, q, mv[Math.floor(Math.random() * mv.length)]);
        else r.game = penalty(g, q);
        continue;
      }
    }
    break;
  }
}

const DEF = {
  game: 'fxq', max: 4,
  minPlayers: 2, minMsg: '至少 2 名玩家',
  fullMsg: '', fullClose: false,
  spectate: true, viewGame: true,
  colors: COLORS,
  newGame: (seats) => {
    const g = initGame(seats.length);
    g.seatMap = seats.map((_, i) => i); // 压缩后的座位 → 实际座位索引
    return g;
  },
  rejoinSync: (base, ws, seat) => {
    const g = base.room.game;
    base._send(ws, {
      t: 'game', action: 'sync', by: -1, game: g,
      movable: (g.state >= 4) ? movablePlanes(g, g.state - 4) : [],
    });
  },
  actions: {
    roll(base, ws, tag) {
      const r = base.room;
      if (r.started !== true) throw new Error('游戏未开始');
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战中');
      if (r.game.state !== seat) throw new Error('还没轮到你');
      r.game = rollDice(r.game, seat);
      if (r.game.sixTimes >= 3) r.game = penalty(r.game, seat); // 三连 6 惩罚（引擎自动）
      base.afterAction('roll', seat);
    },
    move(base, ws, tag, m) {
      const r = base.room;
      if (r.started !== true) throw new Error('游戏未开始');
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战中');
      const g = r.game;
      if (g.state !== 4 + seat) throw new Error('未到移动阶段');
      const movable = movablePlanes(g, seat);
      if (!movable.includes(m.plane)) throw new Error('该飞机无法移动');
      r.game = movePlane(g, seat, m.plane);
      base.afterAction('move', seat);
    },
    pass(base, ws, tag) {
      const r = base.room;
      if (r.started !== true) throw new Error('游戏未开始');
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战中');
      const g = r.game;
      if (g.state !== 4 + seat) throw new Error('未到移动阶段');
      if (movablePlanes(g, seat).length > 0) throw new Error('你有可移动的飞机');
      r.game = penalty(g, seat);
      base.afterAction('pass', seat);
    },
  },
};

export class RoomDO extends BaseRoomDO {
  constructor(state, env) { super(state, env, DEF); }

  // 终局判定与官方 bot 相同 —— winners >= 活跃人数-1
  afterAction(action, seat) {
    const r = this.room;
    autoEmptyTurns(this);
    const activePlayers = r.game.seatMap.length;
    if (r.game.winners.length >= activePlayers - 1) {
      this.finish(r.game.winners, { t: 'finished', winners: r.game.winners, game: r.game, room: this.roomView() });
      return;
    }
    this.saveRoom();
    this._broadcast({
      t: 'game', action, by: seat,
      game: r.game,
      movable: (r.game.state >= 4) ? movablePlanes(r.game, r.game.state - 4) : [],
    });
  }
}
