#!/bin/bash
# Santu Hardware server start karta hai.
# Double-click karo is file pe (ya terminal me `bash start_server.command`).

cd "$(dirname "$0")/frappe-bench" || exit 1

echo "Purane atke hue processes saaf kar rahe hain..."
pkill -f "redis-server 127.0.0.1:11000" 2>/dev/null
pkill -f "redis-server 127.0.0.1:13000" 2>/dev/null
pkill -f "frappe.utils.bench_helper frappe worker" 2>/dev/null
pkill -f "frappe.utils.bench_helper frappe schedule" 2>/dev/null
pkill -f "frappe.utils.bench_helper frappe watch" 2>/dev/null
pkill -f "apps/frappe/socketio.js" 2>/dev/null
sleep 1

echo "Server start ho raha hai — ise band mat karo, app khud khul jayega."
bench start
