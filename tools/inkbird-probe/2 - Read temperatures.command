#!/bin/zsh
cd "$(dirname "$0")" || exit 1
echo "=============================================="
echo " STEP 2 - live temperature readings"
echo "=============================================="
echo
echo "Make sure the Inkbird app on your phone is CLOSED."
echo "Press Ctrl-C to stop."
echo
./.venv/bin/python -u read.py
echo
echo "Done. You can close this window."
