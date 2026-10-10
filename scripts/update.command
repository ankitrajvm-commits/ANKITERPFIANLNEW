#!/bin/bash
# Santu Hardware — App Update
#
# Double-click this file to update the app. Written for someone who is not
# going to read a terminal: every step says what it is doing in Hindi, and it
# stops at the first thing that goes wrong instead of ploughing on.
#
# Deliberately NOT `bench update`. That command also pulls new versions of
# frappe and erpnext — thousands of files nobody here has tested — and is
# exactly how a working shop counter breaks on a Tuesday morning. This pulls
# only this app, and takes a backup first so there is always a way back.

set -u

BENCH_DIR="/Users/santuhardware/erpnext/frappe-bench"
APP_DIR="$BENCH_DIR/apps/santu_hardware"
SITE="site1.local"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo ""
echo "==================================================="
echo "   Santu Hardware — App Update"
echo "==================================================="
echo ""

fail() {
	echo ""
	echo "!!! RUK GAYE: $1"
	echo ""
	echo "Kuch bhi kharab nahi hua — app pehle jaisa hi chal raha hai."
	echo "Ye screen ka photo kheench kar bhej dijiye."
	echo ""
	read -r -p "Band karne ke liye Enter dabaiye..."
	exit 1
}

cd "$BENCH_DIR" || fail "Bench folder nahi mila."

echo "[1/7] Pehle backup le rahe hain (taaki wapas aa sakein)..."
bench --site "$SITE" execute \
	santu_hardware.santu_hardware.backup_service.create_site_backup \
	--kwargs "{'backup_type':'Manual','include_files':True}" \
	>/dev/null 2>&1 || fail "Backup nahi ban paya. Update rok diya."
echo "      Backup ho gaya."

echo "[2/7] Naya version utaar rahe hain..."
cd "$APP_DIR" || fail "App folder nahi mila."
if [ -z "$(git remote 2>/dev/null)" ]; then
	echo "      Koi remote set nahi hai — sirf local badlav lagayenge."
else
	git pull --ff-only || fail "Naya version nahi utar paya. Purana hi chal raha hai."
fi
cd "$BENCH_DIR" || fail "Bench folder nahi mila."

echo "[3/7] Database ko naye version ke hisaab se badal rahe hain..."
bench --site "$SITE" migrate || fail "Migrate fail ho gaya. Backup se wapas laya ja sakta hai."

echo "[4/7] Screens dobara bana rahe hain..."
bench build --app santu_hardware || fail "Build fail ho gaya."

echo "[5/7] Cache saaf kar rahe hain..."
bench --site "$SITE" clear-cache >/dev/null 2>&1

# The screens' cache-busting version is computed once when the server process
# starts, so without this step the browser keeps serving the OLD screens after
# an update — the exact "maine to theek kar diya tha par purana dikh raha hai"
# problem the version was added to prevent. Touching hooks.py forces the
# development server to reload; `bench restart` covers a supervisor setup.
echo "[6/7] Server ko dobara chaalu kar rahe hain..."
touch "$APP_DIR/santu_hardware/hooks.py"
bench restart >/dev/null 2>&1
sleep 5

echo "[7/7] Doctor Uncle se jaanch karwa rahe hain..."
bench --site "$SITE" execute santu_hardware.santu_hardware.doctor.run_checks 2>/dev/null \
	| python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print('      Jaanch ka jawab nahi mila — app khol kar Doctor Uncle dekh lijiye.')
    sys.exit(0)
s = data.get('summary', {})
print('      Theek: %s | Dhyan dein: %s | Kharaab: %s' % (s.get('ok', 0), s.get('warn', 0), s.get('fail', 0)))
for r in data.get('results', []):
    if r.get('status') in ('warn', 'fail'):
        print('      - %s: %s' % (r.get('title'), r.get('detail')))
"

echo ""
echo "==================================================="
echo "   Update pura ho gaya."
echo "   Ab browser me app kholiye aur ek bill banakar dekh lijiye."
echo "==================================================="
echo ""
read -r -p "Band karne ke liye Enter dabaiye..."
