// 爆炸猫房间插件（2-5 人，含 nope 窗口/索要闹钟）—— 公共逻辑在 room-base.js
import { newGame, draw, playAction, resolvePending, nope, give, resolveGiveTimeout, peekTop, WINDOW_MS, GIVE_MS } from './kittens.js';
import { BaseRoomDO } from './room-base.js';

function pushHands(base) {
  for (const ws of base.state.getWebSockets()) {
    const tag = base._tagOf(ws);
    const seat = tag ? base.seatOf(tag.gid) : -1;
    if (seat >= 0) base._send(ws, { t: 'hand', cards: base.room.game.hands[seat] });
  }
}

/* 公开视角：手牌数量、牌堆、当前动作窗口 */
function pubView(base) {
  const g = base.room.game;
  return {
    turn: g.turn,
    deckLeft: g.deck.length,
    drawsLeft: g.drawsLeft,
    pending: g.pending ? { type: g.pending.type, by: g.pending.by, target: g.pending.target, ttl: Math.max(0, g.pending.expires - Date.now()) } : null,
    giving: g.giving ? { from: g.giving.from, to: g.giving.to } : null,
    winner: g.winner,
    last: g.lastAction,
    discardTop: g.discards.length ? g.discards[g.discards.length - 1].kind : null,
    players: g.hands.map((_, i) => ({
      seat: i,
      handCount: g.hands[i].length,
      hasDefuse: g.hands[i].some(c => c.kind === 'defuse'),
      alive: g.alive[i],
    })),
  };
}

function sendPeek(base, seat) {
  if (!base.room.game) return;
  for (const ws of base.state.getWebSockets()) {
    const tag = base._tagOf(ws);
    if (tag && base.seatOf(tag.gid) === seat) base._send(ws, { t: 'peek', cards: peekTop(base.room.game) });
  }
}

const DEF = {
  game: 'kittens', max: 5,
  minPlayers: 2, minMsg: '至少需要 2 名玩家',
  fullMsg: '房间已满（爆炸猫 2-5 人）', fullClose: false,
  newGame: (seats) => newGame(seats.length),
  // nope 窗口 / 索要超时结算（基类 alarm 统一调度，游戏计时优先于死房间回收）
  alarm: async (base) => {
    const r = base.room;
    if (!r.game) return;
    const now = Date.now();
    if (r.game.pending) {
      if (r.game.pending.expires <= now + 5) {
        const p = r.game.pending;
        resolvePending(r.game);
        await base.saveRoom();
        pushHands(base);
        base._broadcast({ t: 'state', pub: pubView(base) });
        if (p.type === 'seefuture') sendPeek(base, p.by);
      } else {
        await base.state.storage.setAlarm(r.game.pending.expires);
      }
    } else if (r.game.giving) {
      if (r.game.giving.expires <= now + 5) {
        resolveGiveTimeout(r.game);
        await base.saveRoom();
        pushHands(base);
        base._broadcast({ t: 'state', pub: pubView(base) });
      } else {
        await base.state.storage.setAlarm(r.game.giving.expires);
      }
    }
    checkOver(base);
  },
  afterStart: (base) => { pushHands(base); base._broadcast({ t: 'state', pub: pubView(base) }); },
  rejoinSync: (base, ws, seat) => {
    base._send(ws, { t: 'hand', cards: base.room.game.hands[seat] });
    base._send(ws, { t: 'state', pub: pubView(base) });
  },
  actions: {
    play(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      playAction(r.game, seat, m.uid, m.target);
      base.saveRoom();
      base.state.storage.setAlarm(r.game.pending.expires).catch(() => {}); // nope 窗口闹钟
      base._broadcast({ t: 'state', pub: pubView(base) });
    },
    nope(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      nope(r.game, seat, m.uid);
      base.saveRoom();
      base.state.storage.deleteAlarm().catch(() => {});
      pushHands(base);
      base._broadcast({ t: 'state', pub: pubView(base) });
      base._broadcast({ t: 'chat', name: '系统', text: `💥 ${r.seats[seat]?.name || '玩家'} 否决了上一个动作！` });
    },
    give(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      give(r.game, seat, m.uid);
      base.saveRoom();
      base.state.storage.deleteAlarm().catch(() => {});
      pushHands(base);
      base._broadcast({ t: 'state', pub: pubView(base) });
    },
    draw(base, ws, tag) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      draw(r.game, seat);
      base.saveRoom();
      pushHands(base);
      base._broadcast({ t: 'state', pub: pubView(base) });
      checkOver(base);
    },
  },
};

function checkOver(base) {
  const r = base.room;
  if (r.game && r.game.winner !== null && r.started !== 'over') {
    base.finish([r.game.winner], { t: 'finished', winner: r.game.winner, pub: pubView(base), room: base.roomView() });
  }
}

export class KittensRoomDO extends BaseRoomDO {
  constructor(state, env) { super(state, env, DEF); }

}
