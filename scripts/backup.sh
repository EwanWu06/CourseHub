#!/bin/sh
# Copies Course Hub (code, git history, database, daily backups, notes) into another folder — e.g. an external drive.
# The running server stays here: macOS keeps background services out of Desktop and external drives.
#   ./scripts/backup.sh [目标文件夹] [--with-logins]
# Default target: ~/Desktop/CourseHub. Logins (data/auth, data/browser-profile) are left out unless --with-logins:
# anyone holding the drive could use them to get into your Canvas. node_modules is left out (npm ci rebuilds it).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Desktop/CourseHub"
LOGINS=0
for arg in "$@"; do
  case "$arg" in --with-logins) LOGINS=1 ;; *) DEST="$arg" ;; esac
done
DEST="${DEST%/}"
[ "$(cd "$DEST" 2>/dev/null && pwd -P)" = "$(cd "$ROOT" && pwd -P)" ] && { echo "目标就是正在运行的这份，不能备份到自己"; exit 1; }
# --delete only inside a folder that is already a Course Hub copy (or empty / new)
if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST")" ] && ! grep -q '"name": "course-hub"' "$DEST/package.json" 2>/dev/null; then
  echo "「${DEST}」里已经有别的东西，不是 Course Hub 的备份，没动它"; exit 1
fi
mkdir -p "$DEST/data"

EXCLUDES="--exclude=/node_modules/ --exclude=/web/dist/ --exclude=/data/tmp/ --exclude=/data/ai-work/ --exclude=/data/coursehub.sqlite*"
[ $LOGINS = 1 ] || EXCLUDES="$EXCLUDES --exclude=/data/auth/ --exclude=/data/browser-profile/"
echo "▸ 文件"
# shellcheck disable=SC2086
rsync -a --delete --delete-excluded $EXCLUDES "$ROOT/" "$DEST/"

echo "▸ 数据库（在线备份，服务不用停）"
rm -f "$DEST/data/coursehub.sqlite.tmp"
sqlite3 "$ROOT/data/coursehub.sqlite" ".backup '$(printf %s "$DEST/data/coursehub.sqlite.tmp" | sed "s/'/''/g")'"
[ "$(sqlite3 "$DEST/data/coursehub.sqlite.tmp" 'PRAGMA integrity_check;')" = ok ] || { echo "备份的数据库检查没通过"; exit 1; }
rm -f "$DEST/data/coursehub.sqlite.tmp-wal" "$DEST/data/coursehub.sqlite.tmp-shm" "$DEST/data/coursehub.sqlite-wal" "$DEST/data/coursehub.sqlite-shm"
mv "$DEST/data/coursehub.sqlite.tmp" "$DEST/data/coursehub.sqlite"

[ $LOGINS = 1 ] && note="含登录信息" || note="不含登录信息；在那份上运行要重新登录学校"
echo "好了：${DEST}（$(du -sh "$DEST" | cut -f1)，${note}）"
