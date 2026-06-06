#!/bin/bash
# 每日持仓数据更新脚本 — 全量版（价格+新闻+指数+资产）
# 流程: 拉取repo → 全量更新 → push到GitHub → GitHub Pages 自动部署

REPO_DIR="/tmp/portfolio-update"
REPO_URL="git@github.com:ginocafekkk/portfolio-dashboard.git"
SSH_KEY="/home/admin/.ssh/portfolio_deploy"

set -e

echo "[$(date '+%Y-%m-%d %H:%M')] Starting portfolio update..."

rm -rf "$REPO_DIR"
GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  git clone "$REPO_URL" "$REPO_DIR" --depth 1

cd "$REPO_DIR"

# 全量更新：价格 + 新闻 + 指数 + 大类资产
python3 scripts/fetch-all.py

# Commit and push
git config user.name "Labuster Bot"
git config user.email "bot@labuster.portfolio"
git add data/portfolio.json
if ! git diff --cached --quiet; then
    git commit -m "📊 自动更新 $(date +'%Y-%m-%d %H:%M')"
    GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
      git push origin main
    echo "✅ Pushed to GitHub → Pages 自动更新"
else
    echo "ℹ️ 数据无变化，跳过推送"
fi

echo "✅ Portfolio update complete"
rm -rf "$REPO_DIR"
