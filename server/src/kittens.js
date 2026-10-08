// 爆炸猫引擎 — 2-5 人
// 卡牌：boom/defuse/skip/attack/favor/shuffle/seefuture/bottom/nope
export const WINDOW_MS = 3000;   // nope 否决窗口
export const GIVE_MS = 9000;     // favor 被索要方出牌时限

const ACTION_KINDS = new Set(['skip', 'attack', 'favor', 'shuffle', 'seefuture', 'bottom']);

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(nSeats) {
  const deck = [];
  const push = (k, n2) => { for (let i = 0; i < n2; i++) deck.push({ kind: k }); };
  push('skip', 4); push('attack', 4); push('favor', 4); push('shuffle', 4);
  push('seefuture', 5); push('bottom', 4); push('nope', 5); push('defuse', 6 - nSeats);
  shuffleArr(deck);
  let uid = 0;
  const hands = Array.from({ length: nSeats }, () => {
    const h = [{ kind: 'defuse', uid: 'k' + (uid++) }];
    for (let i = 0; i < 4; i++) { const c = deck.pop(); c.uid = 'k' + (uid++); h.push(c); }
    return h;
  });
  push('boom', nSeats - 1);
  shuffleArr(deck);
  deck.forEach(c => { if (!c.uid) c.uid = 'k' + (uid++); });
  return {
    hands, deck, discards: [],
    turn: 0, drawsLeft: 1, nextDraws: null,
    pending: null,   // {type,by,target,uid,expires}
    giving: null,    // {from,to,expires}
    alive: Array(nSeats).fill(true),
    winner: null, lastAction: null, seq: uid,
  };
}

export const kindCount = (g, s, k) => g.hands[s].filter(c => c.kind === k).length;

function discardCard(g, card) { g.discards.push({ kind: card.kind }); }
function aliveList(g) { return g.hands.map((_, i) => i).filter(i => g.alive[i]); }
function checkWinner(g) {
  const al = aliveList(g);
  if (al.length === 1) g.winner = al[0];
}

/* 出动作牌（进 nope 窗口） */
export function playAction(g, seat, uid, target) {
  if (g.winner !== null) throw new Error('对局已结束');
  if (g.turn !== seat) throw new Error('还没轮到你');
  if (g.pending) throw new Error('上一个动作还在否决窗口');
  if (g.giving) throw new Error('先处理索要');
  const card = g.hands[seat].find(c => c.uid === uid);
  if (!card) throw new Error('没有这张牌');
  if (!ACTION_KINDS.has(card.kind)) throw new Error('这张牌不能主动打出');
  if (card.kind === 'favor') {
    if (target === undefined || target === null || target === seat) throw new Error('指定一个其他玩家');
    if (!g.alive[target]) throw new Error('该玩家已出局');
    if (g.hands[target].length === 0) throw new Error('该玩家没有手牌可要'); // 防 give 超时分支产生 undefined 卡
  }
  g.hands[seat] = g.hands[seat].filter(c => c.uid !== uid);
  g.pending = { type: card.kind, by: seat, target: target ?? null, uid, expires: Date.now() + WINDOW_MS };
  g.lastAction = { t: 'act', seat, kind: card.kind, target: target ?? null };
  return g;
}

/* 窗口结束时结算 pending（alarm 调用）；返回生效与否 */
export function resolvePending(g) {
  const p = g.pending;
  if (!p) return false;
  g.pending = null;
  const by = p.by;
  switch (p.type) {
    case 'skip': endTurn(g, false); break;
    case 'attack':
      g.nextDraws = (g.nextDraws || 1) + 1;
      endTurn(g, false);
      break;
    case 'favor':
      g.giving = { from: p.target, to: by, expires: Date.now() + GIVE_MS };
      break;
    case 'shuffle': shuffleArr(g.deck); break;
    case 'seefuture': break; // DO 侧发送 peek
    case 'bottom': resolveCard(g, drawBottom(g), true); break;
  }
  return true;
}

export function nope(g, seat, nopeUid) {
  if (!g.pending) throw new Error('当前没有可否决的动作');
  if (seat === g.pending.by) throw new Error('不能否决自己出的牌');
  const card = g.hands[seat].find(c => c.uid === nopeUid);
  if (!card || card.kind !== 'nope') throw new Error('手里没有 Nope');
  const target = g.pending;
  g.hands[seat] = g.hands[seat].filter(c => c.uid !== nopeUid);
  g.pending = null;
  discardCard(g, card);
  g.lastAction = { t: 'nope', seat, nopeTarget: target.type };
  return g;
}

/* favor 应答：给一张牌 */
export function give(g, seat, uid) {
  if (!g.giving || g.giving.from !== seat) throw new Error('现在轮不到你出牌');
  const card = g.hands[seat].find(c => c.uid === uid);
  if (!card) throw new Error('没有这张牌');
  const to = g.giving.to;
  g.hands[seat] = g.hands[seat].filter(c => c.uid !== uid);
  g.hands[to].push(card);
  g.giving = null;
  g.lastAction = { t: 'give', seat, to };
  return g;
}
/* favor 超时：随机给一张（手牌为空时只取消索要，不产生空卡） */
export function resolveGiveTimeout(g) {
  if (!g.giving) return false;
  const h = g.hands[g.giving.from];
  const card = h.length ? h[Math.floor(Math.random() * h.length)] : null;
  if (card) {
    g.hands[g.giving.from] = h.filter(c => c !== card);
    g.hands[g.giving.to].push(card);
  }
  g.giving = null;
  g.lastAction = { t: card ? 'giveAuto' : 'giveEmpty', seat: g.lastAction?.seat ?? null };
  return true;
}

function drawBottom(g) { return g.deck.shift(); }

/* 摸一张（顶部） */
export function draw(g, seat) {
  if (g.winner !== null) throw new Error('对局已结束');
  if (g.turn !== seat) throw new Error('还没轮到你');
  if (g.pending) throw new Error('等待否决窗口结束');
  if (g.giving) throw new Error('先处理索要');
  if (g.deck.length === 0) throw new Error('牌堆已空');
  if (g.drawsLeft <= 0) throw new Error('本回合无需再摸');
  resolveCard(g, g.deck.pop(), false);
  return g;
}

function resolveCard(g, card, fromBottom) {
  const seat = g.turn;
  if (card.kind === 'boom') {
    if (kindCount(g, seat, 'defuse') > 0) {
      // 自动拆弹：弃拆弹牌，boom 随机塞回牌堆，回合结束
      const def = g.hands[seat].find(c => c.kind === 'defuse');
      g.hands[seat] = g.hands[seat].filter(c => c !== def);
      discardCard(g, def);
      discardCard(g, card);
      const pos = Math.floor(Math.random() * (g.deck.length + 1));
      g.deck.splice(pos, 0, card);
      g.lastAction = { t: 'defuse', seat };
    } else {
      g.alive[seat] = false;
      discardCard(g, card);
      g.lastAction = { t: 'boom', seat };
    }
    endTurn(g, false);
    return;
  }
  card.fromBottom = fromBottom;
  g.hands[seat].push(card);
  g.drawsLeft--;
  if (g.drawsLeft <= 0) endTurn(g, false);
}

function endTurn(g, _noDraw) {
  if (g.winner !== null) return;
  g.drawsLeft = g.nextDraws || 1;
  g.nextDraws = null;
  checkWinner(g);
  if (g.winner !== null) return;
  const n = g.hands.length;
  let t = g.turn;
  for (let i = 0; i < n; i++) {
    t = (t + 1) % n;
    if (g.alive[t]) break;
  }
  g.turn = t;
}

/* peek 顶部 3 张（发给玩家本人的 kind 列表） */
export function peekTop(g) { return g.deck.slice(-3).map(c => c.kind).reverse(); }
export function canAct(g, seat) {
  return g.winner === null && g.alive[seat] && g.turn === seat && !g.pending && !g.giving;
}
