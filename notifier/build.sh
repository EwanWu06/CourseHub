#!/bin/sh
# Builds notifier/Course Hub.app from notifier.applescript: no Dock icon, ad-hoc signed.
set -e
cd "$(dirname "$0")"
rm -rf "Course Hub.app"
/usr/bin/osacompile -o "Course Hub.app" notifier.applescript
/usr/bin/plutil -replace LSUIElement -bool YES "Course Hub.app/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleIdentifier -string "local.coursehub.notifier" "Course Hub.app/Contents/Info.plist"
/usr/bin/codesign --force --deep --sign - "Course Hub.app" >/dev/null 2>&1
echo "built notifier/Course Hub.app"
