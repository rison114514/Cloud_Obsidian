#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Cloud-Obsidian 远程安装脚本 v2
# 修复:
#   - Go 版本检测 + 自动升级到 1.22（apt 的 1.18 太旧）
#   - go mod tidy 生成 go.sum
#   - SCRIPT_DIR 指向项目根目录
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

APP_NAME="cloud-obsidian-server"
INSTALL_BIN="/usr/local/bin/${APP_NAME}"
DATA_DIR="/var/lib/cloud-obsidian"
# SCRIPT_DIR = project root (parent of deploy/)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PORT="${CLOUD_OBSIDIAN_PORT:-9090}"
MIN_GO_VERSION="1.21"
GO_TARGET_VERSION="1.22.10"
JWT_SECRET=$(openssl rand -hex 32)

# Chinese Go module proxy (proxy.golang.org blocked in China)
export GOPROXY="https://goproxy.cn,https://goproxy.io,direct"

echo "============================================"
echo " Cloud-Obsidian 服务端安装"
echo "============================================"
echo "  项目目录: ${SCRIPT_DIR}"
echo "  数据目录: ${DATA_DIR}"
echo "  服务端口: ${SERVER_PORT}"
echo "============================================"
echo ""

# ---- 1. Ensure correct Go version ----
log "[1/7] Checking Go version..."

NEED_GO_UPGRADE=false
if command -v go &>/dev/null; then
    GO_VER=$(go version | grep -oP 'go\K[0-9]+\.[0-9]+' | head -1)
    log "Found Go ${GO_VER}"
    # Compare versions: if current < MIN, upgrade
    if [ "$(printf '%s\n' "${MIN_GO_VERSION}" "${GO_VER}" | sort -V | head -1)" != "${MIN_GO_VERSION}" ]; then
        warn "Go ${GO_VER} < ${MIN_GO_VERSION}, need upgrade"
        NEED_GO_UPGRADE=true
    fi
else
    warn "Go not installed"
    NEED_GO_UPGRADE=true
fi

if $NEED_GO_UPGRADE; then
    log "Installing Go ${GO_TARGET_VERSION} from official binary..."
    GO_TAR="go${GO_TARGET_VERSION}.linux-amd64.tar.gz"
    GO_URL="https://go.dev/dl/${GO_TAR}"

    # Download
    curl -sLo "/tmp/${GO_TAR}" "${GO_URL}" || {
        warn "Download failed, trying apt fallback..."
        sudo apt-get update -qq && sudo apt-get install -y -qq golang-go
        log "Go installed via apt: $(go version)"
    }

    if [ -f "/tmp/${GO_TAR}" ]; then
        sudo rm -rf /usr/local/go
        sudo tar -C /usr/local -xzf "/tmp/${GO_TAR}"
        # Add to PATH for this session
        export PATH="/usr/local/go/bin:${PATH}"
        # Also add to profile for future logins
        if ! grep -q '/usr/local/go/bin' /etc/profile 2>/dev/null; then
            echo 'export PATH=/usr/local/go/bin:${PATH}' | sudo tee -a /etc/profile > /dev/null
        fi
        rm -f "/tmp/${GO_TAR}"
        log "Go installed: $(go version)"
    fi
fi

# ---- 2. Install system deps ----
log "[2/7] Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq sqlite3 libsqlite3-dev git screen curl gcc

# ---- 3. Download Go modules ----
log "[3/7] Downloading Go dependencies..."

cd "$SCRIPT_DIR"

if ! go mod tidy 2>&1; then
    err "go mod tidy failed — check network / GOPROXY"
fi
log "Dependencies resolved"

# ---- 4. Build Go binary ----
log "[4/7] Building ${APP_NAME}..."
go build -ldflags="-s -w" -o "${APP_NAME}" .
log "Build complete (binary: $(du -h ${APP_NAME} | cut -f1))"

# ---- 5. Install binary and data dir ----
log "[5/7] Installing binary and data..."
sudo cp "${APP_NAME}" "${INSTALL_BIN}"
sudo chmod +x "${INSTALL_BIN}"
log "Binary installed: ${INSTALL_BIN}"

sudo mkdir -p "${DATA_DIR}/vaults"
sudo chown -R ubuntu:ubuntu "${DATA_DIR}"
sudo chmod 755 "${DATA_DIR}"

# ---- 6. Stop old instance & start new one ----
log "[6/7] Starting service..."
# Kill any old process on our port
OLD_PID=$(lsof -ti:${SERVER_PORT} 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
fi
# Kill old screen session
screen -S cloud-obsidian -X quit 2>/dev/null || true

# Write management script
sudo tee /usr/local/bin/cloud-obsidian-ctl > /dev/null << CTLSCRIPT
#!/usr/bin/env bash
export PATH="/usr/local/go/bin:\${PATH}"
DATA_DIR="${DATA_DIR}"
SERVER_PORT="${SERVER_PORT}"
JWT_SECRET="${JWT_SECRET}"

case "\${1:-}" in
  start)
    screen -dmS cloud-obsidian bash -c "CLOUD_OBSIDIAN_PORT=\${SERVER_PORT} CLOUD_OBSIDIAN_DATA_DIR=\${DATA_DIR} CLOUD_OBSIDIAN_JWT_SECRET='\${JWT_SECRET}' ${INSTALL_BIN} 2>&1 | tee -a \${DATA_DIR}/server.log"
    sleep 2
    echo "Cloud-Obsidian started on port \${SERVER_PORT}"
    screen -ls | grep cloud-obsidian || echo "WARNING: screen session not found"
    ;;
  stop)
    screen -S cloud-obsidian -X quit 2>/dev/null && echo "Stopped" || echo "Not running"
    ;;
  status)
    if screen -ls 2>/dev/null | grep -q cloud-obsidian; then
      echo "Running on port \${SERVER_PORT}"
      curl -s "http://localhost:\${SERVER_PORT}/api/health" 2>/dev/null || echo "Process running but not responding"
    else
      echo "Not running"
    fi
    ;;
  restart)
    \$0 stop
    sleep 1
    \$0 start
    ;;
  log)
    tail -f "\${DATA_DIR}/server.log"
    ;;
  *)
    echo "Usage: cloud-obsidian-ctl {start|stop|restart|status|log}"
    exit 1
    ;;
esac
CTLSCRIPT
sudo chmod +x /usr/local/bin/cloud-obsidian-ctl

# Start the service
screen -dmS cloud-obsidian bash -c \
  "PATH=/usr/local/go/bin:\$PATH CLOUD_OBSIDIAN_PORT=${SERVER_PORT} CLOUD_OBSIDIAN_DATA_DIR=${DATA_DIR} CLOUD_OBSIDIAN_JWT_SECRET='${JWT_SECRET}' ${INSTALL_BIN} 2>&1 | tee -a ${DATA_DIR}/server.log"

sleep 3

# ---- 7. Setup crontab @reboot ----
CRON_LINE='@reboot sleep 10 && PATH=/usr/local/go/bin:/usr/bin:/bin /usr/local/bin/cloud-obsidian-ctl start'
if ! crontab -l 2>/dev/null | grep -q "cloud-obsidian-ctl"; then
    (crontab -l 2>/dev/null || true; echo "$CRON_LINE") | crontab -
    log "[7/7] Added @reboot cron job"
else
    log "[7/7] @reboot cron already exists"
fi

# ---- Verify ----
echo ""
echo "============================================"
echo -e "  ${GREEN}Cloud-Obsidian 安装完成！${NC}"
echo "============================================"
echo ""
echo "  端口:       ${SERVER_PORT}"
echo "  数据目录:   ${DATA_DIR}"
echo "  JWT Secret: ${JWT_SECRET}"
echo ""
echo "  管理命令:"
echo "    cloud-obsidian-ctl status   # 查看状态"
echo "    cloud-obsidian-ctl restart  # 重启服务"
echo "    cloud-obsidian-ctl log      # 查看日志"
echo "============================================"

# Final health check
sleep 1
if curl -s "http://localhost:${SERVER_PORT}/api/health" | grep -q '"status":"ok"'; then
    log "✅ 健康检查通过！服务正常运行"
else
    warn "健康检查失败，查看日志:"
    echo ""
    echo "  screen -r cloud-obsidian     # 查看运行输出"
    echo "  cat ${DATA_DIR}/server.log   # 查看日志文件"
    echo ""
    # Show last few lines of log
    tail -20 "${DATA_DIR}/server.log" 2>/dev/null || true
fi
