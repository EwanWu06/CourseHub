#!/bin/sh
# Stops Course Hub and removes the LaunchAgent, the coursehub link and the Claude Code skill link.
# Your data (data/: logins, database, backups) is kept; delete the folder yourself if you want it gone.
LABEL=local.coursehub.server
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
[ -L "$HOME/.local/bin/coursehub" ] && rm -f "$HOME/.local/bin/coursehub"
[ -L "$HOME/.claude/skills/course-hub" ] && rm -f "$HOME/.claude/skills/course-hub"
echo "已停止并移除自动启动。数据还在 $(cd "$(dirname "$0")/.." && pwd)/data"
