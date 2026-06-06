#!/bin/bash
# 每日持仓数据更新脚本 — 精简版
# 流程: 拉取repo → 更新股价 → push到GitHub → GitHub Actions/GitHub Pages 自动部署

REPO_DIR="/tmp/portfolio-update"
REPO_URL="git@github.com:ginocafekkk/portfolio-dashboard.git"
SSH_KEY="/home/admin/.ssh/portfolio_deploy"

set -e

echo "[$(date '+%Y-%m-%d %H:%M')] Starting portfolio update..."

# Clone latest repo
rm -rf "$REPO_DIR"
GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  git clone "$REPO_URL" "$REPO_DIR" --depth 1

cd "$REPO_DIR"

# Fetch prices
python3 scripts/fetch-prices.py

# Commit and push
git config user.name "Labuster Bot"
git config user.email "bot@labuster.portfolio"
git add data/portfolio.json
if ! git diff --cached --quiet; then
    git commit -m "📊 自动更新 $(date +'%Y-%m-%d %H:%M')"
    GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
      git push origin main
    echo "✅ Pushed price updates to GitHub → GitHub Pages 将自动更新"
else
    echo "ℹ️ 数据无变化，跳过推送"
fi

echo "✅ Portfolio update complete"
rm -rf "$REPO_DIR"
