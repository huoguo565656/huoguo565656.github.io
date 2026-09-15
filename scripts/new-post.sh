#!/usr/bin/env bash
# =========================================================
#  新建一篇文章
#
#  用法：
#     ./scripts/new-post.sh "文章标题"
#     ./scripts/new-post.sh "论文复现：XXX" --kind research
#     ./scripts/new-post.sh "文章标题" --slug my-english-slug
#
#  ⚠️ 文件名直接决定网址。中文文件名会让 URL 变成一长串 %E4%B8%AD%E6%96%87
#     编码，既难看又难分享，所以中文标题建议同时用 --slug 给个英文名。
# =========================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'USAGE'
用法：
    ./scripts/new-post.sh "文章标题" [--kind default|research] [--slug english-slug]

选项：
    --kind <default|research>   模板：default 通用 / research 论文复现（默认 default）
    --slug <english-slug>       网址用的文件名。中文标题建议给一个，否则 URL 会被编码

例子：
    ./scripts/new-post.sh "启用 Git 大文件存储" --slug git-lfs-setup
    ./scripts/new-post.sh "论文复现：XXX" --kind research --slug repro-xxx
USAGE
}

TITLE=""; KIND="default"; SLUG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;;
    --slug) SLUG="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "✘ 未知选项：$1"; usage; exit 1 ;;
    *) TITLE="$1"; shift ;;
  esac
done

[ -n "$TITLE" ] || { usage; exit 1; }

if [ ! -f "archetypes/${KIND}.md" ]; then
  echo "✘ 没有 archetypes/${KIND}.md，可选：$(ls archetypes/ | sed 's/\.md$//' | tr '\n' ' ')"
  exit 1
fi

if [ -z "$SLUG" ]; then
  # 没给 slug 就直接用标题（中文会保留）
  SLUG="$(printf '%s' "$TITLE" | tr ' ' '-' | tr -d '/\\:*?"<>|')"
  if printf '%s' "$SLUG" | LC_ALL=C grep -q '[^ -~]'; then
    echo "⚠️  文件名含非 ASCII 字符，网址会变成百分号编码。"
    echo "    想要干净的 URL，请加：--slug 你的英文名"
    echo
  fi
fi

REL="posts/${SLUG}.md"

if [ -e "content/${REL}" ]; then
  echo "✘ 已存在：content/${REL}"
  exit 1
fi

hugo new content "${REL}" --kind "${KIND}"

echo
echo "✔ 已创建 content/${REL}"
echo "  网址将是：/posts/${SLUG}/"
echo
echo "  下一步："
echo "    1) 写内容（frontmatter 里 draft 默认 true，写完改成 false）"
echo "    2) 记得填 summary —— 不填的话列表页会截取首段，容易把小标题混进去"
echo "    3) ./scripts/publish.sh \"post: ${TITLE}\""
