// 达芬奇密码引擎 — 26 张（黑白各 0-11 + 2 张万能J），2-4 人
// 手牌带稳定 uid；revealed=true 为明牌（所有人可见）
export const HAND_N = { 2: 4, 3: 4, 4: 3 };

export function buildDeck() {
  const d = [];
  for (const c of ['B', 'W']) for (let r = 0; r <= 11; r++) d.push({ c, r });
  d.push({ c: 'J', r: 'J' }, { c: 'J', r: 'J' });
  return d;
}

export function newGame(nSeats) {
  const deck = buildDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let uid = 0;
  const hands = Array.from({ length: nSeats }, () =>
    Array.from({ length: HAND_N[nSeats] }, () => {
      const card = deck.pop();
      return { uid: 'c' + (uid++), c: card.c, r: card.r, revealed: false, fresh: false };
    })
  );
  // 排序：按色（B黑 W白 J万能）与点数，仅供自己查看
  const ord = { B: 0, W: 1, J: 2 };
  for (const h of hands) h.sort((a, b) => ord[a.c] - ord[b.c] || (a.r - b.r) || 0);
  return {
    hands, deck, uidSeq: uid,
    turn: 0, dir: 1,
    drawnUid: null,          // 本回合刚摸的牌（猜错要翻它）
    mustGuess: false,        // 牌堆空时只能猜
    eliminated: new Array(nSeats).fill(false),
    winner: null,
    lastAction: null,
  };
}

export function aliveCount(game) {
  return game.hands.filter((h, i) => !game.eliminated[i]).length;
}
export function faceDownCount(game, seat) {
  return game.hands[seat].filter(c => !c.revealed).length;
}

/* 胜利判定：仅剩一人有暗牌 */
function checkWinner(game) {
  const alive = [];
  game.hands.forEach((h, i) => { if (faceDownCount(game, i) > 0 && !game.eliminated[i]) alive.push(i); });
  if (alive.length === 1) game.winner = alive[0];
}

const match = (card, c, r) =>
  card.r === 'J' ? r === 'J' : (card.c === c && card.r === r);

/* 摸牌 */
export function draw(game, seat) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  if (game.drawnUid) throw new Error('本回合已摸过牌');
  if (game.deck.length === 0) throw new Error('牌堆已空，直接猜牌');
  const card = game.deck.pop();
  if (!card.uid) card.uid = 'c' + (game.uidSeq++);
  card.fresh = true;
  game.hands[seat].push(card);
  game.drawnUid = card.uid;
  game.lastAction = { t: 'draw', seat };
  return card;
}

/* 弃一张暗牌（不公开内容），回合结束 */
export function discard(game, seat, uid) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  const hand = game.hands[seat];
  const card = hand.find(c => c.uid === uid);
  if (!card) throw new Error('没有这张牌');
  if (card.revealed) throw new Error('明牌不能弃');
  game.hands[seat] = hand.filter(c => c.uid !== uid);
  game.lastAction = { t: 'discard', seat, n: hand.length - 1 };
  if (faceDownCount(game, seat) === 0) game.eliminated[seat] = true;
  checkWinner(game);
  endTurn(game, seat);
  return game;
}

/* 猜牌：指定某对手的某张暗牌，报 色+点 */
export function guess(game, seat, targetSeat, uid, c, r) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  if (!game.drawnUid && game.deck.length > 0) throw new Error('必须先摸牌才能猜');
  if (targetSeat === seat) throw new Error('不能猜自己');
  if (game.eliminated[targetSeat]) throw new Error('该玩家已出局');
  const card = game.hands[targetSeat].find(k => k.uid === uid);
  if (!card) throw new Error('目标没有这张牌');
  if (card.revealed) throw new Error('那张已经是明牌了');
  const ok = match(card, c, r);
  game.lastAction = { t: 'guess', seat, targetSeat, c, r, ok };
  if (ok) {
    card.revealed = true;
    if (faceDownCount(game, targetSeat) === 0) game.eliminated[targetSeat] = true;
    checkWinner(game);
    if (game.winner === null) {
      // 猜中：继续行动（不换人）；本回合摸牌状态清除，需重新摸或再猜
      game.drawnUid = null;
    }
  } else {
    // 猜错：翻自己刚摸的牌
    if (game.drawnUid) {
      const fresh = game.hands[seat].find(k => k.uid === game.drawnUid);
      if (fresh) fresh.revealed = true;
    }
    endTurn(game, seat);
  }
  return game;
}

function endTurn(game, fromSeat) {
  // 摸牌状态清理
  const drawn = game.hands[fromSeat].find(k => k.uid === game.drawnUid);
  if (drawn) drawn.fresh = false;
  game.drawnUid = null;
  // 猜错翻牌后若暗牌清零 → 出局
  if (faceDownCount(game, fromSeat) === 0) game.eliminated[fromSeat] = true;
  checkWinner(game);
  if (game.winner !== null) return;
  // 跳过已出局玩家
  const n = game.hands.length;
  let t = game.turn;
  for (let i = 0; i < n; i++) {
    t = (t + 1) % n;
    if (!game.eliminated[t]) break;
  }
  game.turn = t;
}

export function canGuess(game, seat) { return game.turn === seat && game.winner === null; }
