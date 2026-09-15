#!/usr/bin/env bash
# =========================================================
#  提交并推送，触发 GitHub Actions 自动构建发布
#
#  用法：
#     ./scripts/publish.sh                        # 默认提交信息
#     ./scripts/publish.sh "post: 新建站日志"
#     ./scripts/publish.sh --dry                 # 只看看会提交什么，不真提交
# =========================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DRY=0
if [ "${1:-}" = "--dry" ]; then DRY=1; shift; fi
MSG="${1:-post: 更新文章}"

echo "=== 1. 先拉远端（你可能在 GitHub 网页上直接改过）==="
if git remote get-url origin >/dev/null 2>&1; then
  # rebase 而不是 merge：避免每次同步都多出一个合并提交
  git pull --rebase --autostash || {
    echo "✘ 拉取出错。多半是冲突，手动处理完再跑一次：git status"
    exit 1
  }
else
  echo "  还没有配 origin，跳过"
fi

echo
echo "=== 2. 待提交的改动 ==="
if [ -z "$(git status --porcelain)" ]; then
  echo "  （工作区干净，没有要提交的东西）"
  exit 0
fi
git status --short

if [ "$DRY" = "1" ]; then
  echo
  echo "（--dry 模式，未实际提交）"
  exit 0
fi

echo
echo "=== 3. 提交并推送 ==="
git add -A
git commit -m "$MSG"
git push

echo
echo "✔ 已推送。GitHub Actions 正在构建，约 40 秒后生效。"
echo "  看进度：仓库的 Actions 页面"
