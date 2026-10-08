#!/usr/bin/env bash
# fxq VPS 一键部署（Ubuntu 22.04/24.04，x86/ARM 通用）
# 用法：在仓库根目录执行  bash server/deploy/install.sh <你的域名>
#   前置：域名 A/AAAA 记录已指向本机；以 root 执行
set -euo pipefail
DOMAIN="${1:?用法: bash server/deploy/install.sh game.example.com}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"   # 仓库根（含 public/）
APP=/opt/fxq-node

echo "▶ 1/6 安装 Node 22 与 Caddy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
apt-get install -y -qq nodejs
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudflare.com/cloudflare-main.gpg' | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflare-main any main' | tee /etc/apt/sources.list.d/caddy.list >/dev/null
apt-get update -qq && apt-get install -y -qq caddy

echo "▶ 2/6 创建服务用户 fxq"
id -u fxq &>/dev/null || useradd -r -s /usr/sbin/nologin fxq

echo "▶ 3/6 安装程序到 $APP"
mkdir -p "$APP"
rsync -a --exclude node_modules --exclude deploy --exclude src/stats.json "$REPO/server/" "$APP/"
mkdir -p "$APP/public" "$APP/src"
rsync -a --delete "$REPO/public/" "$APP/public/"
cd "$APP" && npm ci --omit=dev --silent
chown -R fxq:fxq "$APP"

echo "▶ 4/6 安装 systemd 服务"
install -m 644 "$REPO/server/deploy/fxq-node.service" /etc/systemd/system/fxq-node.service
systemctl daemon-reload
systemctl enable --now fxq-node

echo "▶ 5/6 配置 Caddy（$DOMAIN，自动 HTTPS）"
sed "s/game.example.com/$DOMAIN/" "$REPO/server/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy

echo "▶ 6/6 防火墙放行 80/443"
command -v ufw >/dev/null && ufw allow 80,443/tcp || true

sleep 2
systemctl is-active fxq-node && echo "✅ fxq-node 运行中（本机 127.0.0.1:8787）"
systemctl is-active caddy || echo "⚠ caddy 未启动 —— 检查域名 DNS 是否已指向本机"
echo "—— 服务日志（最近 5 行）——"
journalctl -u fxq-node -n 5 --no-pager || true
echo "✅ 完成后访问: https://$DOMAIN"
