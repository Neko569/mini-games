/* game-client —— 共用对战连接模块：心跳保活 + 断线自动重连 + 状态通知
 * 平台对 WS 连接有时长/空闲限制：本模块用 25s 心跳保活，连接被掐断后
 * 无限次指数退避重连（1s→15s + 抖动），重连成功自动重发 join 恢复对局。
 * 服务端 hibernation auto-response 直接应答 ping，不唤醒 DO。
 */
export function gameClient({ path, profile, onMsg, onStatus }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const qs = `gid=${encodeURIComponent(profile.gid)}&name=${encodeURIComponent(profile.name)}` +
    (profile.avatar ? `&avatar=${encodeURIComponent(profile.avatar)}` : '');
  const url = `${proto}://${location.host}${path}?${qs}`;

  let ws = null;
  let hbTimer = null;      // 心跳发送
  let watchdog = null;     // 收消息看门狗
  let retry = 0;
  let closed = false;
  let everConnected = false;

  function stopTimers() { clearInterval(hbTimer); hbTimer = null; clearTimeout(watchdog); watchdog = null; }

  function resetWatchdog() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { try { ws.close(4001, 'watchdog'); } catch {} }, 90000);
  }

  function heartbeat() {
    clearInterval(hbTimer);
    hbTimer = setInterval(() => { try { ws.send('{"t":"ping"}'); } catch {} }, 25000);
  }

  function connect() {
    if (closed) return;
    let sock;
    try { sock = new WebSocket(url); } catch { return scheduleReconnect(); }
    ws = sock;
    sock.onopen = () => {
      const first = !everConnected;
      everConnected = true;
      retry = 0;
      heartbeat();
      resetWatchdog();
      if (onStatus) onStatus(first ? 'connected' : 'reconnected');
      send({ t: 'join' }); // 重连后自动恢复座位与局面（服务端按 gid 复活）
    };
    sock.onmessage = (ev) => {
      resetWatchdog();
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'pong') return; // 心跳应答，不上抛
      onMsg(m);
    };
    sock.onclose = (ev) => {
      stopTimers();
      if (closed) return;
      if (ev.code === 4000) { if (onStatus) onStatus('kicked'); return; } // 被同 gid 新连接挤占
      if (onStatus) onStatus('reconnecting');
      scheduleReconnect();
    };
    sock.onerror = () => { try { sock.close(); } catch {} };
  }

  function scheduleReconnect() {
    if (closed) return;
    const delay = Math.min(1000 * 2 ** Math.min(retry, 4), 15000) + Math.floor(Math.random() * 300);
    retry++;
    setTimeout(connect, delay);
  }

  function send(obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  function close() {
    closed = true;
    stopTimers();
    try { ws.close(1000, 'bye'); } catch {}
  }

  connect();
  return { send, close, get closed() { return closed; } };
}
