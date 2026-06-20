#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Cloud-Obsidian 插件构建 + 安装脚本（本地 macOS）
# 用法: cd cloud-obsidian && bash build-plugin.sh [vault路径]
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="${PROJECT_DIR}/plugin"
VAULT_PATH="${1:-}"

echo "============================================"
echo " Cloud-Obsidian 插件构建"
echo "============================================"
echo ""

# Step 1: Install dependencies
echo "[1/3] Installing npm dependencies..."
cd "$PLUGIN_DIR"

if [ ! -d "node_modules" ]; then
    npm install 2>&1 | tail -3
else
    log "node_modules already exists, skipping npm install"
fi

# Step 2: Build
echo "[2/3] Building plugin..."
npx tsc --noEmit --skipLibCheck 2>&1 || warn "TypeScript check had warnings (non-fatal)"
node esbuild.config.mjs production

# Check output
if [ -f "main.js" ] && [ -f "manifest.json" ] && [ -f "styles.css" ]; then
    log "Build successful: main.js + manifest.json + styles.css"
else
    err "Build failed — missing output files"
fi

# Step 3: Install to Obsidian vault
if [ -n "$VAULT_PATH" ]; then
    PLUGIN_DEST="${VAULT_PATH}/.obsidian/plugins/cloud-obsidian-sync"
    echo "[3/3] Installing to ${PLUGIN_DEST}..."
    mkdir -p "$PLUGIN_DEST"
    cp main.js manifest.json styles.css "$PLUGIN_DEST/"
    log "Plugin installed to vault"
    echo ""
    echo "  现在打开 Obsidian → Settings → Community Plugins"
    echo "  找到 'Cloud Obsidian Sync' → 启用"
    echo "  然后点击左侧 ribbon 图标（云朵箭头）打开登录"
else
    warn "未指定 vault 路径，跳过安装"
    echo ""
    echo "  ⚠️ 手动安装步骤:"
    echo ""
    echo "  1. 打开 Obsidian → 随便打开/创建一个 vault"
    echo "  2. 找到该 vault 在磁盘上的位置"
    echo "  3. 复制以下 3 个文件到 .obsidian/plugins/cloud-obsidian-sync/:"
    echo "     cp ${PLUGIN_DIR}/main.js <vault>/.obsidian/plugins/cloud-obsidian-sync/"
    echo "     cp ${PLUGIN_DIR}/manifest.json <vault>/.obsidian/plugins/cloud-obsidian-sync/"
    echo "     cp ${PLUGIN_DIR}/styles.css <vault>/.obsidian/plugins/cloud-obsidian-sync/"
    echo ""
    echo "  或重新运行并指定 vault 路径:"
    echo "     bash build-plugin.sh /path/to/your/vault"
fi

echo ""
echo "============================================"
echo -e "  ${GREEN}插件构建完成！${NC}"
echo "============================================"
