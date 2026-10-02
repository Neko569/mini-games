const W = 'ws://127.0.0.1:8787/ws/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(gid, name, room) {
  const ws = new WebSocket(W + 'davinci/' + room + '?gid=' + gid + '&name=' + encodeURIComponent(name));
  const st = { seat: -2, hand: null, pub: null, winner: null, errors: [], ws };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    try {
      if (m.t === 'welcome') st.seat = m.you.seat;
      if (m.t === 'hand') st.hand = m.cards;
      if (m.t === 'state') st.pub = m.pub;
      if (m.t === 'finished') { st.pub = m.pub; st.winner = m.winner; }
      if (m.t === 'error') { st.errors.push(m.msg); }
    } catch (e) { console.log('CRASH', gid, e.message); }
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
}

{
  const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=davinci').then(r => r.json());
  console.log('DAVINCI room:', code);
  const a = client('da', '福尔摩斯', code);
  const b = client('db', '莫里亚蒂', code);
  for (let i = 0; i < 50 && (a.seat < 0 || b.seat < 0); i++) await sleep(100);
  console.log('seats:', a.seat, b.seat);
  a.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(600);
  console.log('hands:', a.hand.length, b.hand.length, '| deck:', a.pub.deckLeft);

  // a 全知（测试内共享 b 的手牌）：先摸再精准猜 b 暗牌
  let s2 = 0;
  while (a.winner === null && s2++ < 100) {
    await sleep(80);
    if (s2 <= 12 && a.pub) console.log('  it' + s2, 'turn=' + a.pub.turn, 'drawnBy=' + a.pub.drawnBy, 'deck=' + a.pub.deckLeft, 'myhand=' + a.hand.length);
    if (!a.pub || a.pub.winner !== null) break;
    if (a.pub.turn !== 0) {
      // b 也行动：摸+精准猜 a（制造压力）
      if (a.pub.turn === 1 && b.pub) {
        if (b.pub.drawnBy !== 1) { b.ws.send(JSON.stringify({ t: 'draw' })); continue; }
        const target = a.hand.find(c => !c.revealed);
        if (target) b.ws.send(JSON.stringify({ t: 'guess', seat: 0, uid: target.uid, c: target.c, r: target.r }));
      }
      continue;
    }
    if (a.pub.drawnBy !== 0) { a.ws.send(JSON.stringify({ t: 'draw' })); continue; }
    const target = b.hand.find(c => !c.revealed);
    if (!target) { console.log('b 无暗牌'); break; }
    a.ws.send(JSON.stringify({ t: 'guess', seat: 1, uid: target.uid, c: target.c, r: target.r }));
  }
  await sleep(400);
  console.log('DAVINCI winner:', a.winner ?? a.pub?.winner, '| steps:', s2);
  const cnt = {};
  a.errors.forEach(e => cnt[e] = (cnt[e] || 0) + 1);
  console.log('a.err 分布:', JSON.stringify(cnt));
  console.log('a.hand:', JSON.stringify((a.hand || []).map(c => c.c + c.r + (c.revealed ? '*' : ''))));
  console.log('b.hand:', JSON.stringify((b.hand || []).map(c => c.c + c.r + (c.revealed ? '*' : ''))));
  const cb = {}; b.errors.forEach(e => cb[e] = (cb[e] || 0) + 1);
  console.log('b.err 分布:', JSON.stringify(cb));
  console.log('最终 pub:', JSON.stringify(a.pub && { turn: a.pub.turn, players: a.pub.players.map(p => ({ fd: p.faceDown, el: p.eliminated })) }));
  if ((a.winner ?? a.pub?.winner) !== 0) process.exit(1);
  console.log('DAVINCI-E2E-PASS');
}
process.exit(0);
