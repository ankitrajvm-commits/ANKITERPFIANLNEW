#!/bin/bash
# Safety-net backup, run by launchd — not by Frappe's scheduler.
#
# The scheduler is the normal path, but a scheduler that has quietly stopped
# looks exactly like one that is running: no error, no backup, nobody notices
# for weeks. launchd runs this from outside the bench, so the shop keeps
# getting a nightly backup even if the scheduler, the workers or the web
# process are all dead.
#
# Frappe skips this run if the scheduler already took a backup within the
# hour, so a healthy machine does not end up with two copies.

set -u

BENCH_DIR="/Users/santuhardware/erpnext/frappe-bench"
SITE="site1.local"
LOG="$BENCH_DIR/logs/santu_backup_safety_net.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$BENCH_DIR" || exit 1
mkdir -p "$BENCH_DIR/logs"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] safety-net backup starting" >> "$LOG"
bench --site "$SITE" execute \
	santu_hardware.santu_hardware.tasks.run_safety_net_backup >> "$LOG" 2>&1
echo "[$(date '+%Y-%m-%d %H:%M:%S')] safety-net backup finished (exit $?)" >> "$LOG"
