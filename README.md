# 🎮 游戏厅 — 自建对战平台（Cloudflare 免费版）

> 多游戏版：✈️ 飞行棋 + ⚫ 五子棋（新增），共用一套房间/身份/观战/断线重连基建。
> 主入口 `/` 游戏厅；`/fxq`、`/gobang` 为各游戏页；房间号首字母标识游戏（f/g）。

复刻 game.hullqin.cn 飞行棋体验：匿名房间、4 位房号、实时对战、观战、断线重连。
规则引擎移植自官方前端（逻辑 100% 一致），棋盘渲染使用官方坐标函数。

## 架构（全部 CF 免费额度）

```
Cloudflare Worker (路由 + 静态资源 + CORS/PNA)
  ├── Durable Object RoomDO       飞行棋房间（1 房间 = 1 DO）
  ├── Durable Object GobangRoomDO 五子棋房间
  └── public/          前端（无构建）
      ├── index.html   游戏厅主入口（游戏卡片 + 建房/加入）
      ├── fxq/         飞行棋（官方规则引擎）
      └── gobang/      五子棋（15 路无禁手，五连判定）
```

房间号 4 位，**首字母标识游戏**（f=飞行棋 g=五子棋），加入时按前缀自动路由到对应 DO。

免费额度：10 万请求/天（含 WS 消息）≈ 每日 60-100 局活跃对局。

## 部署

```bash
npm install                 # 装 wrangler
npx wrangler login          # 或用 CLOUDFLARE_API_TOKEN
# 编辑 wrangler.toml：解开 routes 注释，填你的域名
npx wrangler deploy
```

绑定域名后 DNS 的 NS 托管到 Cloudflare 即可（免费版支持自定义域名）。
GitHub CI：把 `CLOUDFLARE_API_TOKEN` 存进仓库 Secrets，push main 自动部署。

## ZeroTalk 联动（油猴）

`../fxq-bot/zerotalk-fxq-v3.user.js`：
- 聊天里的 `/fxq 房间号` 自动渲染对局卡片
- 悬浮球 ✈️ 一键建房 + 发邀请 + 开小窗
- 自动带入 ZeroTalk 昵称与头像（URL 参数透传）
- 装脚本前把 `GAME_ORIGIN` 改成你的域名

## 本地开发

```bash
npx wrangler dev            # http://localhost:8787
```

## 协议（JSON over WebSocket）

```
wss://host/ws/{房间号}?gid=&name=&avatar=
→ {t:'join'}                入座（同 gid 重连回原座位；他人同 gid 连接会踢掉旧连接 close 4000）
→ {t:'start'}               房主开局（≥2 人）
→ {t:'roll'}                掷骰（state==自己）
→ {t:'move', plane}         移动（state==4|自己 且 plane 在服务端 movable 白名单）
← {t:'welcome'|'players'|'start'|'game'|'finished'|'chat'|'error'}
```
游戏状态：`{state, lastDice, sixTimes, winners, planePositionList[16], …}`
`state` 0..n-1 = 轮到谁掷骰；4..4+n-1 = 轮到谁移动。三连 6 自动罚回。
