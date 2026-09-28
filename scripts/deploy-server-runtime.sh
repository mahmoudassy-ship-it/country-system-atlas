#!/bin/sh
set -eu

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TARGET_DIR=/srv/system-atlas

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this deployment helper as root." >&2
  exit 1
fi

id system-atlas >/dev/null 2>&1
install -d -m 0750 -o system-atlas -g system-atlas "$TARGET_DIR"
rsync -a --delete \
  --exclude='.git/' \
  --exclude='data/' \
  --exclude='public/data/' \
  --exclude='dist/' \
  --exclude='node_modules/' \
  "$SOURCE_DIR/" "$TARGET_DIR/"
chown -R system-atlas:system-atlas "$TARGET_DIR"
cd "$TARGET_DIR"
sudo -u system-atlas npm ci
chown -R system-atlas:system-atlas "$TARGET_DIR"
systemctl restart system-atlas.service
