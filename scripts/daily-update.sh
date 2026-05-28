#!/bin/bash
# 每日持仓数据更新脚本 — 在 VPS 本地运行
# 1. 拉取最新 repo
# 2. 运行 fetch-prices.py
# 3. 如果有数据变化，push 回 GitHub → 触发 Cloudflare Pages 自动部署

REPO_DIR="/tmp/portfolio-update"
REPO_URL="git@github.com:ginocafekkk/portfolio-dashboard.git"
SSH_KEY="/home/admin/.ssh/portfolio_deploy"

set -e

# Create temp dir
rm -rf "$REPO_DIR"
GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  git clone "$REPO_URL" "$REPO_DIR" --depth 1

cd "$REPO_DIR"

# Fetch prices
python3 scripts/fetch-prices.py

# Check for changes
if git diff --quiet data/portfolio.json; then
    echo "ℹ️ No price changes, skipping push"
    exit 0
fi

# Commit and push
git config user.name "Labuster Bot"
git config user.email "bot@labuster.portfolio"
git add data/portfolio.json
git commit -m "📊 自动更新 $(date +'%Y-%m-%d %H:%M')"
GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  git push origin main

echo "✅ Updated and pushed successfully"

# Cleanup
rm -rf "$REPO_DIR"
