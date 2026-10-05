import { gameClient } from '/assets/game-client.js';
/* 炸飞机客户端 — 布阵 + 对轰（本地布阵校验与服务端同款规则） */
const $ = (s) => document.querySelector(s);
const W = 10;
const SHAPE = [[0,0],[0,1],[-2,2],[-1,2],[0,2],[1,2],[2,2],[-1,3],[0,3],[1,3],[0,4]];

const qs = new URLSearchParams(location.search);
const profile = JSON.parse(localStorage.getItem('fxq_profile') || '{}');
if (qs.get('name')) profile.name = qs.get('name');
if (!profile.gid) profile.gid = crypto.randomUUID();
profile.name = (profile.name || '').slice(0, 16) || '玩家';
localStorage.setItem('fxq_profile', JSON.stringify(profile));
const ROOM = (qs.get('room') || '').toLowerCase();

let ws = null, mySeat = -1, players = [], pub = null;
let placing = [], rot = 0;
let phase = 'placing';

function connect() {
  ws = gameClient({
    path: '/ws/planes/' + ROOM,
    profile,
    onMsg: handle,
    onStatus: (s) => {
      if (s === 'reconnecting') toast('连接断开，正在重连…', true);
      else if (s === 'reconnected') toast('已重新连接，对局已恢复');
      else if (s === 'full') toast('房间已满', true);
      else if (s === 'kicked') toast('账号在其他窗口连接', true);
    },
  });
}
const send = (o) => ws && ws.send(o);

function handle(m) {
  switch (m.t) {
    case 'welcome':
      mySeat = m.you.seat; players = m.room.players;
      enterGame(); renderAll();
      break;
    case 'players': players = m.players; break;
    case 'pub': pub = m.pub; phase = pub.phase; syncPlaceState(); renderAll(); break;
    case 'placed': chatSys(`${esc(name(m.seat))} 已完成布阵`); break;
    case 'fight': phase = 'fighting'; chatSys('交战开始！轮流轰炸敌方领空'); renderAll(); break;
    case 'result':
      if (m.by === mySeat) {
        const t = m.res === 'down' ? '击落一架飞机！' : m.res === 'hit' ? '命中！' : '空';
        toast(t); chatSys(`我方轰炸 (${m.x},${m.y})：${t}`);
      } else {
        chatSys(`${esc(name(m.by))} 轰炸我方 (${m.x},${m.y})`);
      }
      renderAll();
      break;
    case 'finished':
      pub = m.pub; phase = 'over';
      const nm = name(m.winner);
      chatSys(`${nm} 击落全部敌机！`);
      $('#banner').textContent = m.winner === mySeat ? '你赢了！全部敌机击落' : `${nm} 获胜`;
      renderAll();
      break;
    case 'chat': chatLine(m.name, m.text); break;
    case 'error': toast(m.msg, true); break;
  }
}
const name = (seat) => (players[seat] && players[seat].name) || `玩家${seat + 1}`;

function tryPlace(x, y) {
  if (placing.length >= 3) return toast('已经摆满 3 架', true);
  const pc = [];
  for (const [dx, dy] of SHAPE) {
    let rx = dx, ry = dy;
    for (let r = 0; r < rot; r++) { const t = rx; rx = -ry; ry = t; }
    const cx = x + rx, cy = y + ry;
    if (cx < 0 || cx >= W || cy < 0 || cy >= W) return toast('飞机超出边界', true);
    const key = cy * W + cx;
    if (placing.some(p => p.cells.includes(key))) return toast('飞机不能重叠', true);
    pc.push(key);
  }
  placing.push({ x, y, rot, cells: pc });
  renderAll();
}
function localValidate() {
  if (placing.length !== 3) return false;
  const all = placing.flatMap(p => p.cells);
  return new Set(all).size === all.length;
}

const CS = 300 / W;
function cellFromEvent(e, cv) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) * (cv.width / r.width) / CS);
  const y = Math.floor((e.clientY - r.top) * (cv.height / r.height) / CS);
  return (x >= 0 && x < W && y >= 0 && y < W) ? { x, y } : null;
}
function drawGrid(cv, cb) {
  const c = cv.getContext('2d');
  c.fillStyle = '#0d1a2b'; c.fillRect(0, 0, 300, 300);
  c.strokeStyle = '#22354f'; c.lineWidth = 1;
  for (let i = 0; i <= W; i++) {
    c.beginPath(); c.moveTo(i * CS, 0); c.lineTo(i * CS, 300); c.stroke();
    c.beginPath(); c.moveTo(0, i * CS); c.lineTo(300, i * CS); c.stroke();
  }
  if (cb) cb(c);
}
function renderAll() {
  drawGrid($('#mine'), (c) => {
    for (const p of placing) {
      p.cells.forEach((key, idx) => {
        const x = key % W, y = Math.floor(key / W);
        c.fillStyle = idx === 0 ? '#43a047' : '#2e6b4f';
        c.fillRect(x * CS + 1, y * CS + 1, CS - 2, CS - 2);
      });
    }
    if (pub && pub.myBoard) {
      for (const p of pub.myBoard) {
        p.cells.forEach(key => {
          const x = key % W, y = Math.floor(key / W);
          c.fillStyle = p.down ? '#611' : '#2e6b4f';
          c.fillRect(x * CS + 1, y * CS + 1, CS - 2, CS - 2);
        });
        if (p.down) {
          const hx = p.head % W, hy = Math.floor(p.head / W);
          c.fillStyle = '#ffd54a'; c.fillRect(hx * CS + 1, hy * CS + 1, CS - 2, CS - 2);
        }
      }
    }
    if (pub && pub.enemyStrikes) for (const s of pub.enemyStrikes) {
      c.fillStyle = s.res === 'miss' ? '#445' : s.res === 'hit' ? '#e67e22' : '#ff5252';
      c.beginPath(); c.arc(s.x * CS + CS / 2, s.y * CS + CS / 2, 5, 0, 7); c.fill();
    }
  });
  drawGrid($('#enemy'), (c) => {
    if (pub && pub.myStrikes) for (const s of pub.myStrikes) {
      c.fillStyle = s.res === 'miss' ? '#445' : s.res === 'hit' ? '#e67e22' : '#ff5252';
      c.beginPath(); c.arc(s.x * CS + CS / 2, s.y * CS + CS / 2, 5, 0, 7); c.fill();
    }
    if (pub && pub.revealedEnemyHeads) for (const key of pub.revealedEnemyHeads) {
      const x = key % W, y = Math.floor(key / W);
      c.strokeStyle = '#ffd54a'; c.lineWidth = 2;
      c.strokeRect(x * CS + 2, y * CS + 2, CS - 4, CS - 4);
    }
  });
  const b = $('#banner');
  if (phase === 'placing') {
    const mine = pub && pub.myReady;
    b.textContent = placing.length < 3 ? `点击左侧网格放下机头（已放 ${placing.length}/3，方向按钮切换朝向）` :
      mine ? '已确认，等待对方布阵…' : '布阵完成，点击「确认布阵」';
  } else if (phase === 'fighting') {
    const mine = pub && pub.turn === mySeat;
    b.textContent = mine ? '轮到你轰炸！点击右侧敌方领空' : `等待 ${name(pub.turn)} 轰炸…`;
    b.classList.toggle('mine', !!mine);
  }
  $('#btn-confirm').classList.toggle('hidden', !(phase === 'placing' && placing.length === 3 && !pub?.myReady));
}
function syncPlaceState() {
  if (pub && (pub.phase !== 'placing' || pub.myReady)) placing = [];
}

function enterGame() {
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#room-code').textContent = ROOM.toUpperCase();
  $('#room-code').onclick = () => {
    navigator.clipboard?.writeText(`${location.origin}/planes?room=${ROOM}&name=${encodeURIComponent(profile.name)}`)
      .then(() => toast('邀请链接已复制'), () => {});
  };
  $('#btn-leave').onclick = () => { try { ws.close(1000); } catch {} location.href = '/'; };
  $('#btn-chat').onclick = () => { const v = $('#chat-input').value.trim(); if (v) { send({ t: 'chat', text: v.slice(0, 200) }); $('#chat-input').value = ''; } };
  $('#chat-input').onkeydown = (e) => { if (e.key === 'Enter') $('#btn-chat').click(); };
  $('#btn-reset').onclick = () => { placing = []; renderAll(); };
  $('#btn-confirm').onclick = () => { if (localValidate()) send({ t: 'place', planes: placing.map(p => ({ x: p.x, y: p.y, rot: p.rot })) }); else toast('布阵不完整', true); };
  document.querySelectorAll('.rot[data-r]').forEach(b => b.onclick = () => {
    rot = +b.dataset.r;
    document.querySelectorAll('.rot[data-r]').forEach(x => x.classList.toggle('sel', x === b));
  });
  $('#mine').addEventListener('click', (e) => {
    if (phase !== 'placing') return;
    if (pub && pub.myReady) return toast('已确认，等待对方', true);
    const c = cellFromEvent(e, $('#mine'));
    if (c) tryPlace(c.x, c.y);
  });
  $('#enemy').addEventListener('click', (e) => {
    if (phase !== 'fighting') return;
    if (pub && pub.turn !== mySeat) return;
    const c = cellFromEvent(e, $('#enemy'));
    if (c) send({ t: 'strike', x: c.x, y: c.y });
  });
}
function chatLine(n, t) {
  const d = document.createElement('div');
  d.innerHTML = `<b style="color:#4f8cff">${esc(n)}</b> ${esc(t)}`;
  push(d);
}
function chatSys(t) {
  const d = document.createElement('div');
  d.style.opacity = '.6'; d.textContent = t;
  push(d);
}
function push(d) {
  const log = $('#chat-log');
  log.appendChild(d);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', !!err); t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 2400);
}
window.__dbg = () => ({ mySeat, pub, phase, placing });

$('#btn-create').onclick = async () => {
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  const r = await fetch('/api/new-room?game=planes').then(r => r.json());
  location.href = '/planes?room=' + r.code;
};
$('#btn-join').onclick = () => {
  const code = $('#join-code').value.trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/.test(code)) { $('#lobby-msg').textContent = '房间号为 4 位字母数字'; return; }
  profile.name = $('#lobby-name').value.slice(0, 16) || '玩家';
  localStorage.setItem('fxq_profile', JSON.stringify(profile));
  location.href = '/planes?room=' + code;
};
$('#lobby-name').value = profile.name;

if (ROOM && /^[a-z0-9]{4}$/.test(ROOM)) connect();
else $('#lobby').classList.remove('hidden');
