// UNO 引擎 — 标准 108 张，2-6 人
export const COLORS = ['R', 'Y', 'G', 'B'];
export const CNAME = { R: '红', Y: '黄', G: '绿', B: '蓝', W: '' };

export function buildDeck() {
  const d = [];
  for (const c of COLORS) {
    d.push({ c, v: '0' });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2']) {
      d.push({ c, v }); d.push({ c, v });
    }
    d.push({ c: 'W', v: 'wild' }); d.push({ c: 'W', v: 'wd4' });
  }
  return d;
}

export function newGame(nSeats) {
  let deck = buildDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands = Array.from({ length: nSeats }, () => []);
  for (let r = 0; r < 7; r++) for (let s = 0; s < nSeats; s++) hands[s].push(deck.pop());
  // 首张翻到数字牌为止
  let top = deck.pop();
  while (typeof top.v !== 'string' || isNaN(top.v)) { deck.unshift(top); top = deck.pop(); }
  return {
    deck, discard: [top], hands,
    color: top.c,               // 当前有效颜色
    turn: 0, dir: 1, pendingDraw: 0,
    winner: null, lastPlay: null,
  };
}

const canPlay = (card, color, topV) =>
  card.c === 'W' || card.c === color || card.v === topV;

/* 出牌。wild/wd4 必须给 chosenColor */
export function play(game, seat, idx, chosenColor) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  if (game.pendingDraw > 0) throw new Error('必须先摸罚牌');
  const hand = game.hands[seat];
  if (idx < 0 || idx >= hand.length) throw new Error('没有这张牌');
  const card = hand[idx];
  if (!canPlay(card, game.color, game.discard[game.discard.length - 1].v)) throw new Error('这张牌不匹配');
  if ((card.v === 'wild' || card.v === 'wd4') && !CNAME[chosenColor]) throw new Error('万能牌要选颜色');

  hand.splice(idx, 1);
  game.discard.push(card);
  game.lastPlay = { seat, card };

  const n = game.hands.length;
  const next = (t) => (t + game.dir + n) % n;
  if (card.c === 'W') game.color = chosenColor;
  else game.color = card.c;

  if (hand.length === 1) game.lastPlay.uno = true;
  if (hand.length === 0) { game.winner = seat; return game; }

  switch (card.v) {
    case 'skip': game.turn = next(next(game.turn)); break;
    case 'rev':
      game.dir = -game.dir;
      if (n === 2) game.turn = next(game.turn); // 两人局当禁手
      else game.turn = next(game.turn);
      break;
    case 'd2': game.pendingDraw += 2; game.turn = next(game.turn); break;
    case 'wd4': game.pendingDraw += 4; game.turn = next(game.turn); break;
    default: game.turn = next(game.turn);
  }
  return game;
}

/* 摸牌：有罚牌先吃罚（吃完整堆，然后轮转）；否则摸 1 张，能出可以立即出 */
export function drawCards(game, seat, wantPlayIdx = null) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  const drawn = [];
  const need = game.pendingDraw > 0 ? game.pendingDraw : 1;
  for (let i = 0; i < need; i++) {
    if (game.deck.length === 0) reshuffle(game);
    const c = game.deck.pop();
    game.hands[seat].push(c);
    drawn.push(c);
  }
  const wasPenalty = game.pendingDraw > 0;
  game.pendingDraw = 0;
  const n = game.hands.length;
  game.turn = (game.turn + game.dir + n) % n;
  // 非罚摸 1 时，若摸到的牌可出，允许本回合立即打出（wantPlayIdx 为手牌新索引）
  if (!wasPenalty && wantPlayIdx !== null) {
    const card = game.hands[seat][wantPlayIdx];
    if (card && canPlay(card, game.color, game.discard[game.discard.length - 1].v)) {
      return { drawn, canPlayIdx: wantPlayIdx };
    }
  }
  return { drawn, canPlayIdx: null };
}

function reshuffle(game) {
  const top = game.discard.pop();
  game.deck = game.discard.filter(c => c.v !== 'wild' && c.v !== 'wd4').map(c => c);
  for (const c of game.deck) if (c.c === 'W') c.c = 'W';
  for (let i = game.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [game.deck[i], game.deck[j]] = [game.deck[j], game.deck[i]];
  }
  game.discard = [top];
  if (game.deck.length === 0) throw new Error('牌堆耗尽');
}

export function mustDraw(game) { return game.pendingDraw > 0; }
