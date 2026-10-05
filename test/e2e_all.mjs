// 全游戏功能回归 E2E：7 游戏建房/入座/开局/动作 + 心跳 + 断线重连 + 大厅上报
// 用法：node test/e2e_all.mjs [baseUrl]（默认 http://localhost:8787，建议 RATE_LIMIT_OFF=1 环境启动）
const B = process.argv[2] || 'http://localhost:8787';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function wsConnect(path, name, avatar) {
  return new Promise((res, rej) => {
    let u = B.replace('http', 'ws') + path + '?gid=' + name + '&name=' + encodeURIComponent(name);
    if (avatar) u += '&avatar=' + encodeURIComponent(avatar);
    const ws = new WebSocket(u);
    ws.onerror = () => {};
    const buf = [];
    ws.onmessage = e => buf.push(JSON.parse(e.data));
    ws.onopen = () => res({ ws, buf });
    ws.onerror = () => res({ ws, buf, err: true });
  });
}
const wait = (buf, type, ms = 4000) => new Promise((res, rej) => {
  const t0 = Date.now();
  (function poll() {
    const m = buf.find(x => x.t === type);
    if (m) return res(m);
    if (Date.now() - t0 > ms) return rej(new Error('timeout: ' + type));
    setTimeout(poll, 40);
  })();
});
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : (fail++, console.log('  FAIL ' + l)); if (c) console.log('  ok ' + l); };

// 心跳：ping → pong
{
  const r = await (await fetch(B + '/api/new-room?game=gobang')).json();
  const c = await wsConnect('/ws/gobang/' + r.code, 'hb');
  c.ws.send('{"t":"ping"}');
  const gotPong = await new Promise(res => {
    const to = setTimeout(() => res(false), 3000);
    c.ws.onmessage = e => { if (e.data === '{"t":"pong"}') { clearTimeout(to); res(true); } };
  });
  ok(gotPong, '心跳 ping → pong');
  c.ws.close();
}

// gobang：welcome 座位色 / 落子广播 / 断线重连复活 / 满员观战
{
  const r = await (await fetch(B + '/api/new-room?game=gobang')).json();
  const a = await wsConnect('/ws/gobang/' + r.code, 'ga');
  a.ws.send(JSON.stringify({ t: 'join' }));
  const w = await wait(a.buf, 'welcome');
  ok(w.you.seat === 0 && w.room.players[0].color === '#1a1a1a' && w.room.players[0].cn === '黑方', 'gobang welcome + 座位色');
  const b = await wsConnect('/ws/gobang/' + r.code, 'gb');
  b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(b.buf, 'welcome');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  ok(!!a.buf.find(x => x.t === 'start').game.board, 'gobang start 带 game');
  a.ws.send(JSON.stringify({ t: 'place', x: 7, y: 7 }));
  await wait(b.buf, 'game');
  ok(true, 'gobang 落子广播');
  a.ws.close();
  await sleep(400);
  const a2 = await wsConnect('/ws/gobang/' + r.code, 'ga');
  a2.ws.send(JSON.stringify({ t: 'join' }));
  const w2 = await wait(a2.buf, 'welcome');
  ok(w2.you.seat === 0 && w2.room.started === true, 'gobang 重连复活 + 局面恢复');
  const s = await wsConnect('/ws/gobang/' + r.code, 'spec');
  s.ws.send(JSON.stringify({ t: 'join' }));
  ok((await wait(s.buf, 'welcome')).you.seat === -1, '满员转观战');
  a2.ws.close(); b.ws.close(); s.ws.close();
}

// uno：开局发牌 / 摸牌响应
{
  const r = await (await fetch(B + '/api/new-room?game=uno')).json();
  const a = await wsConnect('/ws/uno/' + r.code, 'ua');
  const b = await wsConnect('/ws/uno/' + r.code, 'ub');
  a.ws.send(JSON.stringify({ t: 'join' })); b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome'); await wait(b.buf, 'welcome');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  const h = await wait(b.buf, 'hand');
  ok(Array.isArray(h.cards) && h.cards.length >= 6, 'uno 开局发手牌');
  await wait(b.buf, 'state');
  b.ws.send(JSON.stringify({ t: 'draw' }));
  await Promise.race([wait(b.buf, 'drawn'), wait(b.buf, 'error')]);
  ok(true, 'uno 摸牌有响应');
  a.ws.close(); b.ws.close();
}

// davinci：开局发牌
{
  const r = await (await fetch(B + '/api/new-room?game=davinci')).json();
  const a = await wsConnect('/ws/davinci/' + r.code, 'da');
  const b = await wsConnect('/ws/davinci/' + r.code, 'db');
  a.ws.send(JSON.stringify({ t: 'join' })); b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome'); await wait(b.buf, 'welcome');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  const h = await wait(b.buf, 'hand');
  ok(Array.isArray(h.cards) && h.cards.length >= 4, 'davinci 开局发手牌');
  await wait(b.buf, 'state');
  a.ws.close(); b.ws.close();
}

// kittens：开局发牌
{
  const r = await (await fetch(B + '/api/new-room?game=kittens')).json();
  const a = await wsConnect('/ws/kittens/' + r.code, 'ka');
  const b = await wsConnect('/ws/kittens/' + r.code, 'kb');
  a.ws.send(JSON.stringify({ t: 'join' })); b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome'); await wait(b.buf, 'welcome');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  const h = await wait(b.buf, 'hand');
  ok(Array.isArray(h.cards) && h.cards.length >= 4, 'kittens 开局发手牌');
  await wait(b.buf, 'state');
  a.ws.close(); b.ws.close();
}

// planes：welcome ready / 私有布阵视图 / 布阵进入交战
{
  const r = await (await fetch(B + '/api/new-room?game=planes')).json();
  const a = await wsConnect('/ws/planes/' + r.code, 'pa');
  const b = await wsConnect('/ws/planes/' + r.code, 'pb');
  a.ws.send(JSON.stringify({ t: 'join' })); b.ws.send(JSON.stringify({ t: 'join' }));
  const w = await wait(a.buf, 'welcome');
  ok(w.room.game === null && Array.isArray(w.room.ready), 'planes welcome 带 ready');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  const st = await wait(b.buf, 'state');
  ok(st.you === 1 && st.game && 'phase' in st.game, 'planes 私有布阵视图');
  const P = [{ x: 2, y: 0, rot: 0 }, { x: 2, y: 5, rot: 0 }, { x: 7, y: 9, rot: 2 }];
  a.ws.send(JSON.stringify({ t: 'place', planes: P }));
  await wait(b.buf, 'placed', 3000).catch(() => null);
  b.ws.send(JSON.stringify({ t: 'place', planes: P }));
  // placed 广播含本人；第二次布阵后 phase 变 fighting —— 轮询等待该状态出现
  const fighting = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      const last = a.buf.filter(x => x.t === 'placed').pop();
      if (last && last.phase === 'fighting') return true;
      await sleep(50);
    }
    return false;
  })();
  ok(fighting, 'planes 双方布阵进入交战');
  a.ws.close(); b.ws.close();
}

// reversi：合法点 / 落子翻转
{
  const r = await (await fetch(B + '/api/new-room?game=reversi')).json();
  const a = await wsConnect('/ws/reversi/' + r.code, 'ra');
  const b = await wsConnect('/ws/reversi/' + r.code, 'rb');
  a.ws.send(JSON.stringify({ t: 'join' })); b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome'); await wait(b.buf, 'welcome');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  const st = await wait(b.buf, 'state');
  ok(st.pub && st.pub.legal.length === 4, 'reversi 开局 4 合法点');
  a.ws.send(JSON.stringify({ t: 'place', x: 3, y: 2 }));
  const mv = await wait(b.buf, 'move');
  ok(mv.flips === 1 && mv.pub, 'reversi 落子翻转广播');
  a.ws.close(); b.ws.close();
}

// fxq：seatMap / 掷骰 movable
{
  const r = await (await fetch(B + '/api/new-room?game=fxq')).json();
  const a = await wsConnect('/ws/fxq/' + r.code, 'fa');
  const b = await wsConnect('/ws/fxq/' + r.code, 'fb');
  a.ws.send(JSON.stringify({ t: 'join' })); b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome'); await wait(b.buf, 'welcome');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  ok(Array.isArray(a.buf.find(x => x.t === 'start').game.seatMap), 'fxq start 带 seatMap');
  a.ws.send(JSON.stringify({ t: 'roll' }));
  const g = await wait(b.buf, 'game');
  ok(Array.isArray(g.movable), 'fxq 掷骰广播带 movable');
  a.ws.close(); b.ws.close();
}

// 前端资源 + 大厅上报
{
  const gc = await (await fetch(B + '/assets/game-client.js')).text();
  ok(gc.includes('gameClient') && gc.includes('ping'), 'game-client.js 可访问');
  let all = true;
  const pageJs = { fxq: '/fxq/app.js', gobang: '/gobang/gobang.js', uno: '/uno/uno.js', planes: '/planes/planes.js', davinci: '/davinci/davinci.js', kittens: '/kittens/kittens.js', reversi: '/reversi/reversi.js' };
  for (const [g, f] of Object.entries(pageJs)) {
    const js = await (await fetch(B + f)).text();
    if (!js.includes('gameClient')) all = false;
  }
  ok(all, '7 页面均引用共用客户端');
  const r = await (await fetch(B + '/api/new-room?game=fxq')).json();
  const c = await wsConnect('/ws/fxq/' + r.code, 'lobbyt');
  c.ws.send(JSON.stringify({ t: 'join' }));
  await wait(c.buf, 'welcome');
  await sleep(400);
  const lobby = await (await fetch(B + '/api/lobby')).json();
  ok(lobby.rooms.some(x => x.code === r.code), '大厅上报正常');
  c.ws.close();
}

console.log(`\n══ e2e_all: ${pass} 通过, ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
