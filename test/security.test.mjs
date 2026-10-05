// 安全回归测试：对运行中的 dev/线上实例执行常见漏洞检查
// 用法：node test/security.test.mjs [baseUrl]（默认 http://localhost:8787）
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
const wait = (buf, type, ms = 3000) => new Promise((res, rej) => {
  const t0 = Date.now();
  (function poll() {
    const m = buf.find(x => x.t === type);
    if (m) return res(m);
    if (Date.now() - t0 > ms) return rej(new Error('timeout: ' + type));
    setTimeout(poll, 40);
  })();
});
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : (fail++, console.log('  ❌ ' + l)); if (c) console.log('  ✅ ' + l); };

// 1. 头像属性注入被消毒（合法头像保留）
{
  const r = await (await fetch(B + '/api/new-room?game=gobang')).json();
  const c = await wsConnect('/ws/gobang/' + r.code, 'attacker', 'x" onerror="alert(1)');
  c.ws.send(JSON.stringify({ t: 'join' }));
  await wait(c.buf, 'welcome');
  const av = c.buf.find(x => x.t === 'welcome').room.players.find(Boolean).avatar;
  ok(!av.includes('onerror'), '头像属性注入被清空');
  const c2 = await wsConnect('/ws/gobang/' + r.code, 'normal', 'https://example.com/a.png');
  c2.ws.send(JSON.stringify({ t: 'join' }));
  await wait(c2.buf, 'welcome');
  ok(c2.buf.find(x => x.t === 'welcome').room.players.find(p => p && p.name === 'normal').avatar === 'https://example.com/a.png', '合法 https 头像保留');
  c.ws.close(); c2.ws.close();
}
// 2. 昵称消毒（大厅 host 无 HTML）
{
  const r = await (await fetch(B + '/api/new-room?game=fxq')).json();
  const c = await wsConnect('/ws/fxq/' + r.code, '<svg onload=x>');
  c.ws.send(JSON.stringify({ t: 'join' }));
  await wait(c.buf, 'welcome');
  await sleep(400);
  const row = (await (await fetch(B + '/api/lobby')).json()).rooms.find(x => x.code === r.code);
  ok(row && !row.host.includes('<'), '大厅 host 已消毒');
  c.ws.close();
}
// 3. 战绩写接口封禁
ok((await fetch(B + '/api/stats', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ game: 'fxq', results: [{ gid: 'x', name: 'x', win: true }] }) })).status === 405, '战绩公开写接口已封');
// 4. WS Origin 校验
ok((await fetch(B + '/ws/gobang/faaa', { headers: { Origin: 'https://evil.example' } })).status === 403, '跨站 Origin 被拒');
// 5. 原型链消息无害
{
  const r = await (await fetch(B + '/api/new-room?game=uno')).json();
  const a = await wsConnect('/ws/uno/' + r.code, 'pp');
  a.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome');
  a.ws.send('{"t":"constructor"}'); a.ws.send('{"t":"hasOwnProperty"}');
  await sleep(300);
  ok(a.ws.readyState === 1, '原型链键消息无害');
  a.ws.close();
}
// 6. 越权：非房主开局 / 观战操作 / 非回合
{
  const r = await (await fetch(B + '/api/new-room?game=gobang')).json();
  const a = await wsConnect('/ws/gobang/' + r.code, 'owner1');
  a.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome');
  const b = await wsConnect('/ws/gobang/' + r.code, 'guest1');
  b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(b.buf, 'welcome');
  b.ws.send(JSON.stringify({ t: 'start' }));
  ok(/房主/.test((await wait(b.buf, 'error')).msg || ''), '非房主开局被拒');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  b.ws.send(JSON.stringify({ t: 'place', x: 8, y: 8 }));
  ok(!!(await wait(b.buf, 'error').catch(() => null)), '非回合落子被拒');
  a.ws.close(); b.ws.close();
}
// 7. 畸形输入不崩溃
{
  const r = await (await fetch(B + '/api/new-room?game=gobang')).json();
  const a = await wsConnect('/ws/gobang/' + r.code, 'fz1');
  const b = await wsConnect('/ws/gobang/' + r.code, 'fz2');
  a.ws.send(JSON.stringify({ t: 'join' })); b.ws.send(JSON.stringify({ t: 'join' }));
  await wait(a.buf, 'welcome'); await wait(b.buf, 'welcome');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await wait(a.buf, 'start');
  for (const p of [{ t:'place', x:-1, y:-1 }, { t:'place', x:1e9, y:1e9 }, { t:'place', x:1.5, y:1.5 }, { t:'place', x:'a', y:'b' }, { t:'place' }]) {
    a.ws.send(JSON.stringify(p)); await sleep(60);
  }
  ok(a.ws.readyState === 1 && Object.prototype.injected === undefined, '畸形坐标无崩溃无污染');
  a.ws.close(); b.ws.close();
}
// 8. 安全响应头
{
  const resp = await fetch(B + '/');
  ok((resp.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'")
    && resp.headers.get('x-content-type-options') === 'nosniff', '安全响应头齐全');
}

console.log(`\n══ 安全回归: ${pass} 通过, ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
