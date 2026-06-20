#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Cloud-Obsidian 一键部署脚本
# 在 Ubuntu 服务器上执行: bash install.sh
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ---------- Configuration ----------
APP_NAME="cloud-obsidian-server"
INSTALL_BIN="/usr/local/bin/${APP_NAME}"
DATA_DIR="/var/lib/cloud-obsidian"
SERVICE_FILE="/etc/systemd/system/cloud-obsidian.service"
NGINX_CONF="/etc/nginx/sites-available/cloud-obsidian"
NGINX_ENABLED="/etc/nginx/sites-enabled/cloud-obsidian"
JWT_SECRET=$(openssl rand -hex 32)

# ---------- Pre-flight checks ----------
if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root (use sudo)."
fi

log "Starting Cloud-Obsidian deployment..."

# ---------- Install Go if needed ----------
if ! command -v go &>/dev/null; then
    warn "Go not found, installing..."
    apt-get update -qq && apt-get install -y -qq golang-go
    log "Go installed: $(go version)"
else
    log "Go found: $(go version)"
fi

# ---------- Install system dependencies ----------
log "Installing system dependencies..."
apt-get install -y -qq nginx sqlite3 git

# ---------- Build the server ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SRC="$(dirname "$SCRIPT_DIR")"  # server/ directory

log "Building ${APP_NAME}..."
cd "$SERVER_SRC"
go build -o "${APP_NAME}" .
cp "${APP_NAME}" "${INSTALL_BIN}"
chmod +x "${INSTALL_BIN}"
log "Binary installed to ${INSTALL_BIN}"

# ---------- Create data directories ----------
log "Setting up data directory at ${DATA_DIR}..."
mkdir -p "${DATA_DIR}/vaults"
chown -R www-data:www-data "${DATA_DIR}"
chmod 750 "${DATA_DIR}"

# ---------- Install systemd service ----------
log "Installing systemd service..."
cp "${SCRIPT_DIR}/cloud-obsidian.service" "${SERVICE_FILE}"
# Inject the generated JWT secret.
sed -i "s/change-me-to-a-random-string/${JWT_SECRET}/" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable cloud-obsidian
systemctl restart cloud-obsidian
log "Service started"

# ---------- Configure Nginx ----------
log "Configuring Nginx..."
cp "${SCRIPT_DIR}/nginx.conf" "${NGINX_CONF}"
if [[ ! -L "${NGINX_ENABLED}" ]]; then
    ln -s "${NGINX_CONF}" "${NGINX_ENABLED}"
fi
# Remove default site if present.
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
log "Nginx configured and reloaded"

# ---------- Configure firewall ----------
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    log "Configuring firewall..."
    ufw allow 80/tcp
    ufw allow 443/tcp
    log "Firewall ports 80/443 opened"
fi

# ---------- Summary ----------
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "============================================"
echo -e "  ${GREEN}Cloud-Obsidian 部署完成！${NC}"
echo "============================================"
echo ""
echo "  服务地址:   http://${SERVER_IP}"
echo "  API 状态:   http://${SERVER_IP}/api/health"
echo "  数据目录:   ${DATA_DIR}"
echo "  JWT Secret: ${JWT_SECRET}"
echo ""
echo "  管理命令:"
echo "    systemctl status cloud-obsidian"
echo "    systemctl restart cloud-obsidian"
echo "    journalctl -u cloud-obsidian -f"
echo ""
echo "  查看 Git 历史:"
echo "    cd ${DATA_DIR}/vaults/<username>"
echo "    git log --oneline"
echo ""
echo "  ⚠️  请保存 JWT Secret，后续客户端配置需一致。"
echo "============================================"
