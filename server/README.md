# fxq Node 版服务端（VPS 部署）

与 CF 版协议逐字节兼容的 Node.js 单进程实现。`vps-node` 分支 = CF 版（`src/` + `public/`）不变 + 本目录新增服务端与部署套件。

## 目录

```
server/
├── server.js        # 入口：HTTP + WS + 静态资源 + 限速 + 优雅停机
├── src/             # 游戏逻辑（大厅/房间/战绩，运行时落盘 src/stats.json）
├── deploy/
│   ├── install.sh   # 一键部署（Ubuntu 22.04/24.04，x86/ARM）
│   ├── fxq-node.service
│   └── Caddyfile
├── package.json     # 运行时依赖仅 ws
└── package-lock.json
```

## 一键部署

前置：一台 VPS（Ubuntu 22.04/24.04，1C1G 起够用）、一个解析到本机的域名。

```bash
git clone -b vps-node https://github.com/Neko569/mini-games.git fxq
cd fxq
sudo bash server/deploy/install.sh game.example.com
# 完成后 https://game.example.com 即上线（HTTPS 证书 Caddy 全自动）
```

脚本做这些事：装 Node 22 + Caddy → 建 `fxq` 服务用户 → 程序装到 `/opt/fxq-node`（含 `public/`）→ systemd 开机自启 → Caddy 反代 127.0.0.1:8787 → 放行 80/443。

## 更新部署

```bash
cd fxq && git pull
sudo rsync -a --exclude node_modules --exclude deploy --exclude src/stats.json server/ /opt/fxq-node/
sudo rsync -a --delete public/ /opt/fxq-node/public/
sudo chown -R fxq:fxq /opt/fxq-node
sudo systemctl restart fxq-node   # 优雅停机：战绩先落盘，房间连接以 1001 礼貌断开
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | 监听端口 |
| `HOST` | 127.0.0.1 | **默认只绑回环**（走 Caddy）；直连公网设 `0.0.0.0` |
| `STATIC_DIR` | `../public`（仓库根） | 静态资源目录 |
| `TRUST_PROXY` | 1（回环时） | 设 `0` 禁止信任 `X-Forwarded-For`（限速退化为按反代 IP 计） |
| `RATE_LIMIT_OFF` | - | 设 `1` 关闭限速（仅压测用） |

## 运维速查

```bash
systemctl status fxq-node          # 状态
journalctl -u fxq-node -f          # 日志
curl -s localhost:8787/healthz     # 探活（返回房间数/uptime）
```

性能：2C/4G 可扛数千条 WS 长连接；战绩落盘 `src/stats.json`（上限 5 万条自动裁剪）。
