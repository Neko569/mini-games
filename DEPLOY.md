# FXQ 飞行棋 · 部署说明

> 目标：把游戏平台部署到 Cloudflare 免费版（绑你的自定义域名），并让 ZeroTalk 油猴脚本联动起来。
> 已含游戏：✈️ 飞行棋、⚫ 五子棋、🃏 UNO（2-6 人）、🛩️ 炸飞机、🔐 达芬奇密码（2-4 人）。主入口 `/` 为游戏厅（建房/加入按房间号首字母 f/g/u/p 自动路由）。
> 全程零费用（CF Workers/DO/Pages 免费额度内），预计 15 分钟。

---

## 前置条件

| 需要 | 说明 |
|---|---|
| Cloudflare 账号 | 注册 https://dash.cloudflare.com（免费版即可） |
| 一个域名 | NS 必须托管到 Cloudflare（即域名在 CF 上 DNS 解析）。已域名在别家？把注册商的 NS 改成 CF 分配的两个即可 |
| Node.js ≥ 18 | 本地跑 wrangler 用 |
| （可选）GitHub 仓库 | 开启 push 自动部署 |

## 一、部署 Worker

```bash
cd fxq-cf
npm install                          # 安装 wrangler

# 方式 A：浏览器登录（最简单）
npx wrangler login
# 方式 B：API Token（适合 CI / 无浏览器环境）
#   dash.cloudflare.com → My Profile → API Tokens → Create Token
#   模板选 "Edit Cloudflare Workers"，导出环境变量：
#   export CLOUDFLARE_API_TOKEN=你的token

# 填你的域名：编辑 wrangler.toml，把最后两行解开注释：
#   routes = [
#     { pattern = "game.你的域名.com/*", zone_name = "你的域名.com" }
#   ]

npx wrangler deploy
```

部署成功会输出 `https://game.你的域名.com`。

### 域名 DNS 检查
- `wrangler deploy` 绑定 routes 时，CF 会自动为该子域创建 DNS 记录；若没有，手动加一条：
  `game.你的域名.com → A 记录 → 192.0.2.1（占位）→ 开橙色云（Proxied）`
- 路由走 Worker 后这条记录的实际值不重要，橙色云必须开。

### 验证
```bash
curl https://game.你的域名.com/api/new-room
# → {"code":"xx42"}  即成功
```
浏览器打开 `https://game.你的域名.com`，能建房能加入即部署完成。

## 二、油猴脚本接入 ZeroTalk

1. Via/浏览器安装 Tampermonkey（Via 用自带脚本管理器）
2. 新建脚本，粘贴 `userscript/zerotalk-fxq-v3.user.js` 全部内容
3. **改第 18 行**：
   ```js
   const GAME_ORIGIN = 'https://game.你的域名.com';   // ← 换成你的域名
   ```
4. 保存。打开 https://app.zerotalk.cn 进入零语大厅：
   - 右下角出现 **✈️ 紫色悬浮球** = 脚本生效
   - 点它 → 自动建房 + 大厅发 `/fxq 房间号` 邀请 + 弹出游戏小窗（自动带你的 ZeroTalk 昵称和头像）
   - 对方（也装了脚本）看到聊天卡片 → 点「加入对局」
   - 房主点「开始游戏」→ 对局开跑

### 身份透传原理（改脚本时别动）
- 昵称：`/auth/check` 接口取
- 头像：你发消息时 WS 回显帧里的 `avatar_url`（uid 匹配），DOM 兜底
- 小窗 URL 形如 `?room=xx42&name=昵称&avatar=头像URL`，游戏端存 localStorage

## 三、GitHub 托管 + 自动部署（可选）

```bash
cd fxq-cf
git remote add origin git@github.com:你的用户名/fxq-cf.git
git push -u origin main          # 仓库已本地 init 好并提交过
```
GitHub 仓库 → Settings → Secrets and variables → Actions → 新建 Secret：
- 名字：`CLOUDFLARE_API_TOKEN`，值：你的 token

之后 push 到 main 自动触发 `.github/workflows/deploy.yml` 部署。

## 四、本地开发 / 排障

```bash
cd fxq-cf && npx wrangler dev     # http://localhost:8787
```
- 前端改动无需重启（静态资源）；改 `src/*.js` 会自动热重载
- 双开浏览器隐私窗口即可本地双人对战

### 常见问题

| 症状 | 原因/解法 |
|---|---|
| 访问 game.xxx 报 522/523 | DNS 记录没开橙色云（Proxied） |
| 油猴卡片点开后 404 | 油猴里 `GAME_ORIGIN` 与部署域名不一致 |
| `wrangler deploy` 报 zone not found | 域名 NS 没托管到 CF，或 zone_name 写错 |
| 大陆访问慢 | CF 免费版正常现象（200-300ms），能玩；`*.workers.dev` 在大陆被污染，**必须用自定义域名** |
| 油猴悬浮球点了没反应 | 先确认进入了聊天房间（要 WS 连接）；再看 `GAME_ORIGIN` 是否改对 |
| 游戏内别人看不到你消息/名字 | 同一浏览器多标签用同一 gid 会互踢（设计如此，参考 hullqin） |
| 当天游戏突然全部报错 | 免费额度耗尽（10 万请求/天，WS 消息也计数），次日 00:00 UTC 自动恢复 |

### 额度参考
- 10 万 DO 请求/天 ≈ **60-100 局活跃对局/天**（含心跳）
- 想更省：把前端心跳间隔从 30s 调大（`public/app.js` 无心跳，DO 侧由 WS 消息驱动，正常无需动）

## 五、目录结构

```
fxq-cf/
├── wrangler.toml            # 部署配置（改这里绑域名）
├── src/
│   ├── index.js             # Worker：路由/静态资源/CORS
│   ├── room.js              # Durable Object：房间逻辑（入座/开局/回合/广播）
│   └── engine.js            # 飞行棋规则引擎（官方前端模块移植）
├── public/                  # 前端（无构建，直接改直接生效）
│   ├── index.html / style.css / app.js
│   └── engine.js            # 同款规则引擎（浏览器侧复用）
└── .github/workflows/       # CI 自动部署
userscript/
└── zerotalk-fxq-v3.user.js  # ZeroTalk 油猴脚本
```
