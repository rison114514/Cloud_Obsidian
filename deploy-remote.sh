#!/usr/bin/env bash
# ============================================================
# Cloud-Obsidian 通用远程部署脚本
# 用法: bash deploy-remote.sh <user@host> [port]
# 示例: bash deploy-remote.sh root@123.456.789.0
#       bash deploy-remote.sh ubuntu@my-server.com 9090
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---- Parse arguments ----
if [ $# -lt 1 ]; then
    echo "用法: bash deploy-remote.sh <user@host> [custom-port]"
    echo "示例: bash deploy-remote.sh root@123.456.789.0"
    echo "      bash deploy-remote.sh ubuntu@my-server.com 9090"
    exit 1
fi

SERVER_ADDR="$1"
SERVER_PORT="${2:-9090}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "============================================"
echo -e "  ${CYAN}Cloud-Obsidian 远程部署${NC}"
echo "============================================"
echo "  目标服务器: ${SERVER_ADDR}"
echo "  服务端口:   ${SERVER_PORT}"
echo "============================================"
echo ""

# ---- Pre-flight: check SSH connectivity ----
echo -e "${CYAN}[1/4]${NC} 检查 SSH 连接..."
if ! ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$SERVER_ADDR" "echo ok" &>/dev/null; then
    echo -e "${RED}[✗]${NC} 无法连接到 ${SERVER_ADDR}"
    echo "  请确认:"
    echo "  1. SSH 密钥已配置: ssh-copy-id ${SERVER_ADDR}"
    echo "  2. 服务器地址正确"
    exit 1
fi
echo -e "${GREEN}[✓]${NC} SSH 连接成功"

# ---- Upload server code ----
echo -e "${CYAN}[2/4]${NC} 上传服务端代码..."
ssh "$SERVER_ADDR" "rm -rf ~/cloud-obsidian-server" 2>/dev/null || true
scp -r -q -o StrictHostKeyChecking=accept-new "${PROJECT_DIR}/server" "${SERVER_ADDR}:~/cloud-obsidian-server"
echo -e "${GREEN}[✓]${NC} 代码上传完成"

# ---- Run remote install ----
echo -e "${CYAN}[3/4]${NC} 编译并部署（可能需要几分钟）..."
echo "  安装 Go、下载依赖、编译二进制..."

# Inject the custom port into the remote install script
ssh "$SERVER_ADDR" "bash ~/cloud-obsidian-server/deploy/remote-install.sh" 2>&1 | while IFS= read -r line; do
    # Strip ANSI for cleaner output, or keep them
    echo "  $line"
done

# ---- Verify ----
echo ""
echo -e "${CYAN}[4/4]${NC} 验证服务..."

HEALTH=$(ssh "$SERVER_ADDR" "curl -s http://localhost:${SERVER_PORT}/api/health" 2>/dev/null || echo "FAIL")

if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}[✓]${NC} 服务正常运行！"
else
    echo -e "${YELLOW}[!]${NC} 健康检查未通过，请登录服务器排查："
    echo "  ssh ${SERVER_ADDR}"
    echo "  cloud-obsidian-ctl status"
    echo "  cloud-obsidian-ctl log"
fi

# ---- Summary ----
SERVER_IP=$(echo "$SERVER_ADDR" | cut -d@ -f2)
echo ""
echo "============================================"
echo -e "  ${GREEN}部署完成！${NC}"
echo "============================================"
echo ""
echo "  服务地址: http://${SERVER_IP}:${SERVER_PORT}"
echo "  API 状态: http://${SERVER_IP}:${SERVER_PORT}/api/health"
echo ""
echo "  注册账号:"
echo "    curl -X POST http://${SERVER_IP}:${SERVER_PORT}/api/auth/register \\"
echo '      -H "Content-Type: application/json" \'
echo "      -d '{\"username\":\"yourname\",\"password\":\"yourpass\"}'"
echo ""
echo "  ⚠️  请确保服务器防火墙已放行 ${SERVER_PORT} 端口！"
echo "============================================"
