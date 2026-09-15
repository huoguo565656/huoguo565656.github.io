#!/usr/bin/env bash
# =========================================================
#  本地预览（需要本机装了 hugo，版本 >= 0.146）
#
#  用法：
#     ./scripts/preview.sh          # 默认 1313 端口
#     ./scripts/preview.sh 8888     # 换端口
#
#  会带上草稿（-D），方便边写边看。
# =========================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${1:-1313}"

if ! command -v hugo >/dev/null 2>&1; then
  cat <<'EOF'
✘ 本机没装 hugo。

装一个（任选）：
  Windows:  winget install Hugo.Hugo.Extended
  macOS:    brew install hugo
  Linux:    sudo snap install hugo

或者不装也行 —— 直接改完推送，看线上效果：
  ./scripts/publish.sh "post: xxx"
EOF
  exit 1
fi

echo "预览地址： http://localhost:${PORT}/"
echo "（Ctrl+C 停止）"
hugo server -D --disableFastRender \
  --bind 0.0.0.0 --port "${PORT}" \
  --baseURL "http://localhost:${PORT}/"
