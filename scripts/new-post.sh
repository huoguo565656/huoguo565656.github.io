#!/usr/bin/env bash
# =========================================================
#  新建一篇文章
#
#  用法：
#     ./scripts/new-post.sh "文章标题"                # 通用模板
#     ./scripts/new-post.sh "论文复现：XXX" research  # 论文复现模板
# =========================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TITLE="${1:-}"
KIND="${2:-default}"

if [ -z "$TITLE" ]; then
  cat <<'USAGE'
用法：
    ./scripts/new-post.sh "文章标题" [default|research]

  default   通用技术笔记模板
  research  论文复现模板（带环境/结果对比/卡点等固定小节）
USAGE
  exit 1
fi

if [ ! -f "archetypes/${KIND}.md" ]; then
  echo "✘ 没有 archetypes/${KIND}.md，可选：$(ls archetypes/ | sed 's/\.md$//' | tr '\n' ' ')"
  exit 1
fi

DATE="$(date +%Y-%m-%d)"
# 文件名里的空格换连字符，去掉文件系统不友好的字符
SLUG="$(printf '%s' "$TITLE" | tr ' ' '-' | tr -d '/\\:*?"<>|')"
REL="posts/${DATE}-${SLUG}.md"

if [ -e "content/${REL}" ]; then
  echo "✘ 已存在：content/${REL}"
  exit 1
fi

hugo new content "${REL}" --kind "${KIND}"

echo
echo "✔ 已创建 content/${REL}"
echo "  1) 写内容（frontmatter 里默认 draft: true，写完改成 false）"
echo "  2) ./scripts/publish.sh \"post: ${TITLE}\""
