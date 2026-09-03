#!/bin/bash
# Hourly local backup safety-net, run by macOS launchd.
#
# Frappe's scheduler is the normal path. This independent process runs at
# :15 every hour and asks the same due-check to make a backup. If the normal
# scheduler already ran, the due-check is a no-op; if it stalled, this creates
# the missed full local backup without waiting until the next day.

set -u

BENCH_DIR="/Users/santuhardware/erpnext/frappe-bench"
SITE="site1.local"
LOG="$BENCH_DIR/logs/santu_backup_safety_net.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$BENCH_DIR" || exit 1
mkdir -p "$BENCH_DIR/logs"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] safety-net backup starting" >> "$LOG"
bench --site "$SITE" execute \
	santu_hardware.santu_hardware.tasks.run_auto_backup_check >> "$LOG" 2>&1
echo "[$(date '+%Y-%m-%d %H:%M:%S')] safety-net backup finished (exit $?)" >> "$LOG"
