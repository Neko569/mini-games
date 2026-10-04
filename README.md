# mini-games 🎲

自建多人游戏平台，跑在 Cloudflare Workers + Durable Objects 上，零依赖原生 JS，7 个游戏：

| 游戏 | 人数 | 特色 |
|---|---|---|
| ✈️ 飞行棋 | 2-4 | 经典对战，掷骰起飞 |
| ⚫ 五子棋 | 2 | 15 路棋盘，断线重连 |
| 🃏 UNO | 2-6 | 经典 108 张，罚牌/万能牌 |
| 🛩️ 炸飞机 | 2 | 10×10 布阵对轰 |
| 🔐 达芬奇密码 | 2-4 | 猜牌推理 |
| 💥 爆炸猫 | 2-5 | 拆弹/否决/攻击 |
| ⚪ 黑白棋 | 2 | 8×8 奥赛罗 |

## 架构

- 每个游戏一个 **Durable Object** 房间（WebSocket hibernation + sqlite 持久化）
- 房间号首字母路由游戏类型（f/g/u/p/d/k/r）
- 全局 **StatsDO** 战绩统计（DO sqlite）
- 大厅 + 房间号邀请 + 匿名开局 + 断线重连 + 房间 10 分钟无活动自动回收
- 美术资源全部内联 SVG（`public/assets/icons.js`），无外部依赖

## 本地开发

```bash
npm install
wrangler dev        # http://localhost:8787
node test/kittens.test.mjs   # 引擎单测
node test/e2e_reversi.mjs    # E2E（需 dev server 运行中）
```

## 部署

```bash
wrangler deploy
```

或推送到 main 由 GitHub Actions 自动部署（需在仓库 Secrets 配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`）。
