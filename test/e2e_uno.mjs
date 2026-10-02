/* UNO E2E：状态未变则重发推进 + finished 事件处理 */
const W = 'ws://127.0.0.1:8787/ws/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(gid, name, room) {
  const ws = new WebSocket(W + 'uno/' + room + '?gid=' + gid + '&name=' + encodeURIComponent(name));
  const st = { seat: -2, hand: null, pub: null, errors: [], ws };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    try {
      if (m.t === 'welcome') st.seat = m.you.seat;
      if (m.t === 'hand') st.hand = m.cards;
      if (m.t === 'state') st.pub = m.pub;
      if (m.t === 'finished') st.pub = m.pub;
      if (m.t === 'error') st.errors.push(m.msg);
    } catch (e) { console.log('HANDLER-CRASH', gid, e.message); }
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join' }));
  return st;
}

{
  const { code } = await fetch('http://127.0.0.1:8787/api/new-room?game=uno').then(r => r.json());
  console.log('UNO room:', code);
  const a = client('ua', '阿红', code);
  const b = client('ub', '阿蓝', code);
  for (let i = 0; i < 50 && (a.seat < 0 || b.seat < 0 || !a.pub); i++) await sleep(100);
  a.ws.send(JSON.stringify({ t: 'start' }));
  for (let i = 0; i < 20 && !a.pub; i++) await sleep(100);
  console.log('hands:', a.hand.length, b.hand.length, '| top:', a.pub.top.c + a.pub.top.v);

  const pa = a.pub, pb = b.pub; // 引用，随后实时读字段
  const winner = () => (a.pub && a.pub.winner !== null ? a.pub.winner : (b.pub && b.pub.winner !== null ? b.pub.winner : null));
  let safety = 0, lastSig = '', stuck = 0;
  while (winner() === null && safety++ < 800) {
    await sleep(60);
    const sig = `${a.pub.turn}|${a.pub.top.c}${a.pub.top.v}|${a.hand.length},${b.hand.length}|${a.pub.color}${a.pub.pendingDraw}`;
    if (sig === lastSig) stuck++; else { stuck = 0; lastSig = sig; }
    if (stuck > 0 && stuck % 12 === 0) console.log('  [stuck]', sig, '| a.err:', a.errors.length, 'b.err:', b.errors.length);
    const me = a.pub.turn === 0 ? a : b;
    if (me.hand === null) continue;
    if (a.pub.pendingDraw > 0 && a.pub.turn === me.seat) {
      if (stuck > 0 && stuck % 4 === 0) me.ws.send(JSON.stringify({ t: 'draw' }));
      continue;
    }
    if (a.pub.turn !== me.seat) continue;
    const i = me.hand.findIndex(c => c.c === a.pub.color || c.v === a.pub.top.v || c.c === 'W');
    if (i >= 0) me.ws.send(JSON.stringify({ t: 'play', idx: i, color: 'R' }));
    else me.ws.send(JSON.stringify({ t: 'draw' }));
  }
  console.log('UNO winner:', winner(), '| a.err:', a.errors.length, '| b.err:', b.errors.length);
  if (winner() === null) process.exit(1);
  console.log('UNO-E2E-PASS');
}
process.exit(0);
