#!/bin/bash
# Changes karne ke baad ISE double-click karo.
#
# Kyun zaroori hai: browser bill/CSS/JS ko yaad rakh leta hai. App har file ko
# ek "version" ke saath bhejta hai, aur wo version server start hone par ek
# baar hi banta hai. Isliye chalu server ke beech me file badlo to browser
# purani copy hi dikhata rehta hai -- lagta hai change hua hi nahi.
#
# Ye script assets dobara banati hai aur server restart karti hai, jisse naya
# version ban jata hai aur browser fresh copy leta hai.

cd "$(dirname "$0")/frappe-bench" || exit 1

echo "Assets dobara ban rahe hain..."
bench build --app santu_hardware || { echo "Build fail hua."; read -r -p "Enter dabao..."; exit 1; }

echo "Purane processes saaf kar rahe hain..."
pkill -f "honcho start" 2>/dev/null
pkill -f "redis-server 127.0.0.1:11000" 2>/dev/null
pkill -f "redis-server 127.0.0.1:13000" 2>/dev/null
pkill -f "frappe.utils.bench_helper frappe worker" 2>/dev/null
pkill -f "frappe.utils.bench_helper frappe schedule" 2>/dev/null
pkill -f "frappe.utils.bench_helper frappe watch" 2>/dev/null
pkill -f "apps/frappe/socketio.js" 2>/dev/null
sleep 3

echo "Server start ho raha hai — ise band mat karo."
echo "Browser me page reload karo (Cmd+Shift+R), changes dikh jayenge."
bench start
