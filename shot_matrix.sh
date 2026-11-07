#!/usr/bin/env bash
# Phase 1 verification: screenshot matrix (dev server must be running on :5173)
cd /d/NEXUS-AI || exit 1
CHROME="/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"

shot() {
  local name="$1" size="$2" route="$3"
  local udd
  udd=$(mktemp -d)
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --user-data-dir="$udd" --window-size="$size" \
    --virtual-time-budget=15000 \
    --screenshot="D:\NEXUS-AI\screenshots\\$name" \
    "http://localhost:5173/#$route" >/dev/null 2>&1
  rm -rf "$udd"
  echo "done: $name"
}

ROUTES="dashboard agents models memory knowledge tools learning internet activity settings"

for r in $ROUTES; do shot "1920x1080-$r.png" "1920,1080" "/$r"; done
shot "1920x1080-chat.png" "1920,1080" "/chat/c-refactor-auth"

for r in $ROUTES chat; do
  route="/$r"; [ "$r" = "chat" ] && route="/chat/c-refactor-auth"
  shot "1280x720-$r.png" "1280,720" "$route"
done

for r in dashboard chat models learning settings; do
  route="/$r"; [ "$r" = "chat" ] && route="/chat/c-refactor-auth"
  shot "1366x768-$r.png" "1366,768" "$route"
done

echo "TOTAL=$(ls screenshots/ | wc -l)"
