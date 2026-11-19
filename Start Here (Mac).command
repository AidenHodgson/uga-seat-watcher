#!/bin/bash
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Seat Watcher needs Node.js. Opening the download page now."
  echo "Install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  echo
  read -r -p "Press Enter to close."
  exit 1
fi
node setup.mjs
echo
read -r -p "Press Enter to close."
