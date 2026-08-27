#!/bin/zsh
cd "$(dirname "$0")" || exit 1
echo "=============================================="
echo " STEP 1 - find the Inkbird probe"
echo "=============================================="
echo
echo "If macOS asks 'Terminal would like to use Bluetooth', click OK."
echo
./.venv/bin/python -u scan.py
echo
echo "Done. You can close this window."
