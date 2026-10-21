#!/usr/bin/env bash
# เปิดเว็บแอร์สำหรับทดลองใน GitHub Codespaces — devcontainer.json เรียกทุกครั้งที่เปิด Codespace
#
# - ฐานข้อมูลทดลองอยู่ที่ data/demo/aircon.db (อยู่ใต้ data/ จึงไม่ขึ้น git) เริ่มจากว่าง
#   เปิดเว็บครั้งแรกจะให้ตั้งบัญชีผู้ดูแลคนแรก
# - PUBLIC_URL = ที่อยู่ของ Codespace ลิงก์ซ่อมที่ส่งให้ช่างนอกจะได้ชี้ไปที่เดียวกัน
# - พอร์ตยังเป็น Private ตามค่าเริ่มต้นของ GitHub ถ้าจะให้คนนอกเปิด ให้ตั้งเองที่แท็บ Ports
cd "$(dirname "$0")/.." || exit 1

export DATA_DIR=data/demo
mkdir -p "$DATA_DIR"
# ไฟล์ว่าง = ฐานข้อมูล SQLite ว่าง เว็บสร้างตารางให้เองตอนเปิด
[ -f "$DATA_DIR/aircon.db" ] || : > "$DATA_DIR/aircon.db"

if [ -n "$CODESPACE_NAME" ]; then
  export PUBLIC_URL="https://${CODESPACE_NAME}-8787.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

# เปิดซ้ำ (attach ใหม่) ไม่ต้องรันซ้ำ ถ้าเว็บยังทำงานอยู่
if ! curl -s -o /dev/null http://localhost:8787/; then
  nohup node platform/node.js > /tmp/aircon.log 2>&1 &
  for _ in $(seq 1 30); do curl -s -o /dev/null http://localhost:8787/ && break; sleep 1; done
fi

echo ""
echo "  เว็บแอร์ (ทดลอง) รันแล้ว: ${PUBLIC_URL:-http://localhost:8787}"
echo "  ให้คนนอกเปิดได้: แท็บ Ports → คลิกขวาแถว 8787 → Port Visibility → Public"
echo "  log ของเว็บ: /tmp/aircon.log"
echo ""
