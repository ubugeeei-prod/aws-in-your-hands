#!/bin/bash
set -euo pipefail

DEVICE='/dev/sdf'
MOUNT='/var/lib/yugabyte'
FSTAB='/etc/fstab'
OWNER='yugabyte'

# The volume is attached after the instance has started. Wait up to five minutes for it.
for _ in $(seq 1 60); do
  if [ -e "$DEVICE" ]; then break; fi
  sleep 5
done
if [ ! -e "$DEVICE" ]; then
  echo "$DEVICE did not appear. Is the volume attached?" >&2
  exit 1
fi

# blkid exits 0 when it finds a file system and 2 when it finds none.
# Anything else is unknown, and an unknown volume is never formatted.
status=0
blkid "$DEVICE" >/dev/null 2>&1 || status=$?
case "$status" in
  0) echo "$DEVICE already holds a file system; keeping it" ;;
  2) mkfs.xfs "$DEVICE" ;;
  *) echo "blkid exited with $status; refusing to format $DEVICE" >&2; exit 1 ;;
esac

# By UUID: NVMe device names can change between boots.
uuid="$(blkid -o value -s UUID "$DEVICE")"
mkdir -p "$MOUNT"
if ! grep -q "^UUID=$uuid " "$FSTAB"; then
  # nofail: a missing data volume must not keep the instance from booting.
  echo "UUID=$uuid $MOUNT xfs defaults,nofail 0 2" >> "$FSTAB"
fi
if ! mountpoint -q "$MOUNT"; then
  mount "$MOUNT"
fi
chown "$OWNER:$OWNER" "$MOUNT"
chmod 0750 "$MOUNT"
