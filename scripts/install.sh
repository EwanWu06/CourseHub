#!/bin/sh
# Installs Course Hub on this Mac: builds the web app and the notifier, starts the server now and at every
# login (restarted after a crash), puts `coursehub` on PATH and the Claude Code skill in place.
#   ./scripts/install.sh [--no-open]
set -e
# the real folder, never a symlinked path to it (a link on the Desktop would put ~/Desktop into the LaunchAgent)
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
LABEL=local.coursehub.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "找不到 node（需要 Node 24 以上）"; exit 1; }
NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")"
case "$("$NODE" -p 'process.versions.node.split(".")[0]')" in 2[4-9]|[3-9][0-9]) ;; *) echo "需要 Node 24 以上，现在是 $("$NODE" -v)"; exit 1 ;; esac

cd "$ROOT"
echo "▸ 依赖"; [ -d node_modules ] || npm ci
echo "▸ 网页"; npm run --silent build:web >/dev/null
echo "▸ 通知小程序"; ./notifier/build.sh
mkdir -p data/logs "$HOME/Library/LaunchAgents" "$HOME/.local/bin" "$HOME/.claude/skills"

echo "▸ 开机自动启动（${LABEL}）"
SAFE_PATH="$(dirname "$NODE"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
sed -e "s|__NODE__|$NODE|g" -e "s|__ROOT__|$ROOT|g" -e "s|__PATH__|$SAFE_PATH|g" launchd/$LABEL.plist.tmpl > "$PLIST"
/usr/bin/plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "▸ 命令行 coursehub"; ln -sf "$ROOT/bin/coursehub" "$HOME/.local/bin/coursehub"
echo "▸ Claude Code 技能"; ln -sfn "$ROOT/skill/course-hub" "$HOME/.claude/skills/course-hub"

printf "▸ 等服务器启动"
i=0
until curl -s -m 2 http://127.0.0.1:4123/api/health | grep -q course-hub; do
  i=$((i + 1)); [ $i -gt 60 ] && { echo " 超时，看 data/logs/server.err.log"; exit 1; }
  printf "."; sleep 1
done
echo " 好了：http://127.0.0.1:4123"
[ "$1" = "--no-open" ] || open "http://127.0.0.1:4123/"
