#!/usr/bin/env bash
# ============================================================
# Cloud-Obsidian 部署脚本（个人服务器）
# 用法: cp .env.example .env  → 编辑填入真实信息 → bash deploy.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

# Load credentials from .env
if [ ! -f ".env" ]; then
    echo "错误: 缺少 .env 文件"
    echo "  cp .env.example .env"
    echo "  编辑 .env 填入服务器信息"
    exit 1
fi
source .env

# Export for deploy.exp
export SERVER_HOST SERVER_USER SERVER_PASS

expect deploy.exp 2>&1 | tee deploy.log
