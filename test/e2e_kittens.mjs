const W = 'ws://127.0.0.1:8787/ws/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const WINDOW = 3200; // nope 窗口 + 余量

function client(gid, name, room) {
  const ws = new WebSocket(W + 'kittens/' + room + '?gid=' + gid + '&name=' + encodeURIComponent(name));
  const st = { seat: -2, hand: null, pub: null, winner: null, errors: [], peeks: [], ws };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    try {
      if (m.t === 'welcome') st.seat = m.you.seat;
      if (m.t === 'hand') st.hand = m.cards;
      if (m.t === 'state') st.pub = m.pub;
      if (m.t === 'finished') { st.pub = m.pub; st.winner = m.winner; }
      if (m.t === 'peek') st.peeks.push(m.cards);
      if (m.t === 'error') { st.errors.push(m.msg); if (st.errors.length <= 3) console.log('  [ERR]', gid, m.msg); }
    } catch (e) { console.log('CRASH', gid, e.message); }
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
}
const findCard = (st, kind) => (st.hand || []).find(c => c.kind === kind);

{
  const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=kittens').then(r => r.json());
  console.log('KITTENS room:', code);
  const a = client('ka', '炸猫人', code);
  const b = client('kb', '猫受害者', code);
  for (let i = 0; i < 50 && (a.seat < 0 || b.seat < 0); i++) await sleep(100);
  console.log('seats:', a.seat, b.seat);
  a.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(600);
  console.log('hands:', a.hand.length, b.hand.length, '| deck:', a.pub.deckLeft);
  const must = (a.hand.some(c => c.kind === 'defuse') && b.hand.some(c => c.kind === 'defuse'));
  console.log('开局保底拆弹:', must);
  if (!must) process.exit(1);

  // --- 场景1：a 出 shuffle（b 不 nope，等窗口结算） ---
  let card = findCard(a, 'shuffle');
  if (!card) { console.log('a 无 shuffle，改测 seefuture'); card = findCard(a, 'seefuture'); }
  if (card) {
    a.ws.send(JSON.stringify({ t: 'play', uid: card.uid }));
    await sleep(600);
    console.log('窗口期 pending:', a.pub.pending?.type);
    await sleep(WINDOW);
    console.log('结算后 pending:', a.pub.pending, '| a 手牌:', a.hand.length);
  }

  // --- 场景2：a 出 seefuture，b 尝试 nope（若 b 有 nope） ---
  card = findCard(a, 'seefuture');
  if (card) {
    a.ws.send(JSON.stringify({ t: 'play', uid: card.uid }));
    await sleep(400);
    const bNope = findCard(b, 'nope');
    if (bNope) {
      b.ws.send(JSON.stringify({ t: 'nope', uid: bNope.uid }));
      await sleep(400);
      console.log('NOPE 后 pending:', a.pub.pending, '| b 手牌:', b.hand.length);
    } else { console.log('b 无 nope，跳过否决场景'); await sleep(WINDOW); }
  }

  // --- 场景3：a 出 favor 要 b 的牌 ---
  card = findCard(a, 'favor');
  if (card) {
    a.ws.send(JSON.stringify({ t: 'play', uid: card.uid, target: 1 }));
    await sleep(600);
    console.log('favor pending:', a.pub.pending?.type, 'target:', a.pub.pending?.target);
    await sleep(WINDOW);
    console.log('giving:', JSON.stringify(a.pub.giving));
    if (a.pub.giving) {
      const giveCard = b.hand[0];
      b.ws.send(JSON.stringify({ t: 'give', uid: giveCard.uid }));
      await sleep(400);
      console.log('give 完成: a 手牌', a.hand.length, 'b 手牌', b.hand.length);
    }
  }

  // --- 场景4：自由对局至有人爆炸/获胜 ---
  let steps = 0;
  while (a.winner === null && steps++ < 300) {
    await sleep(300);
    for (const st of [a, b]) {
      if (st.winner !== null || !st.pub) continue;
      const me = st.seat;
      if (st.pub.winner !== null) continue;
      if (st.pub.giving && st.pub.giving.from === me) { st.ws.send(JSON.stringify({ t: 'give', uid: st.hand[0].uid })); continue; }
      if (st.pub.turn !== me || st.pub.pending || st.pub.giving) continue;
      const act = st.hand.find(c => ['skip', 'attack', 'favor', 'shuffle', 'seefuture'].includes(c.kind));
      if (act && Math.random() < 0.4) { st.ws.send(JSON.stringify({ t: 'play', uid: act.uid, target: 1 - me })); continue; }
      if (Math.random() < 0.8) st.ws.send(JSON.stringify({ t: 'draw' }));
    }
  }
  await sleep(500);
  console.log('KITTENS winner:', a.winner ?? a.pub?.winner, '| 自由局步数:', steps, '| a.peek:', a.peeks.length, '| a.err:', a.errors.length, '| b.err:', b.errors.length);
  if ((a.winner ?? a.pub?.winner) === null) process.exit(1);
  console.log('KITTENS-E2E-PASS');
}
process.exit(0);
