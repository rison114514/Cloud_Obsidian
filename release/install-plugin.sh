#!/usr/bin/env bash
# ============================================================
# Cloud-Obsidian 插件安装脚本
# 用法: bash install-plugin.sh [vault路径]
#      若不指定路径，自动搜索 ~/Documents 下的 Obsidian vault
# ============================================================
set -euo pipefail

PLUGIN_NAME="cloud-obsidian-sync"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_PATH="${1:-}"

echo "============================================"
echo " Cloud-Obsidian 插件安装"
echo "============================================"

# Auto-detect vault if not specified
if [ -z "$VAULT_PATH" ]; then
    echo "搜索 Obsidian vault..."
    VAULTS=$(find ~/Documents -name ".obsidian" -type d -maxdepth 3 2>/dev/null)
    VAULT_COUNT=$(echo "$VAULTS" | grep -c ".obsidian" 2>/dev/null || echo 0)

    if [ "$VAULT_COUNT" -eq 0 ]; then
        echo "未找到 Obsidian vault，请手动指定路径："
        echo "  bash install-plugin.sh /path/to/your/vault"
        exit 1
    elif [ "$VAULT_COUNT" -eq 1 ]; then
        VAULT_PATH=$(dirname "$VAULTS")
        echo "找到 vault: $VAULT_PATH"
    else
        echo "找到多个 vault，请选择一个："
        i=1
        for v in $VAULTS; do
            echo "  $i) $(dirname "$v")"
            i=$((i+1))
        done
        read -p "输入序号: " choice
        VAULT_PATH=$(dirname "$(echo "$VAULTS" | sed -n "${choice}p")")
    fi
fi

# Validate
if [ ! -d "$VAULT_PATH" ]; then
    echo "错误: 目录不存在: $VAULT_PATH"
    exit 1
fi

if [ ! -d "$VAULT_PATH/.obsidian" ]; then
    echo "错误: 这不是 Obsidian vault（缺少 .obsidian 目录）"
    exit 1
fi

# Install
DEST="$VAULT_PATH/.obsidian/plugins/$PLUGIN_NAME"
mkdir -p "$DEST"
cp "$SCRIPT_DIR/plugin/main.js" \
   "$SCRIPT_DIR/plugin/manifest.json" \
   "$SCRIPT_DIR/plugin/styles.css" \
   "$DEST/"

echo ""
echo "✅ 插件已安装到: $DEST"
echo ""
echo "下一步:"
echo "  1. 打开 Obsidian → Settings → Community Plugins"
echo "  2. 启用 'Cloud Obsidian Sync'"
echo "  3. 点击左侧 ribbon 云朵图标登录"
