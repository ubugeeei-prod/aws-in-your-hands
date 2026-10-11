#!/bin/bash
# Runs once, as root, on the first boot. Output: /var/log/cloud-init-output.log
set -euo pipefail

dnf install -y 'nodejs24' xfsprogs

if ! id -u 'notes' >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir '/var/lib/notes' --shell /sbin/nologin 'notes'
fi
install -d -m 0755 '/opt/notes' '/opt/notes/releases' '/etc/notes'

cat > '/etc/notes/notes.env' <<'AIH_EOF'
ALLOWED_ORIGIN=http://localhost:5173
LOG_LEVEL=info
STAGE=ec2
HOST=127.0.0.1
PORT=8787
NOTES_FILE=/var/lib/notes/notes.json
AIH_EOF
cat > '/etc/systemd/system/notes.service' <<'AIH_EOF'
[Unit]
Description=Notes API (AWS in Your Hands, chapter 23)
After=network-online.target
Wants=network-online.target
RequiresMountsFor=/var/lib/notes
AssertPathIsMountPoint=/var/lib/notes
ConditionPathExists=/opt/notes/current/server.mjs
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=notes
Group=notes
EnvironmentFile=/etc/notes/notes.env
ExecStart=/usr/bin/node-24 /opt/notes/current/server.mjs
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/notes

[Install]
WantedBy=multi-user.target
AIH_EOF
cat > '/usr/local/sbin/notes-data-volume' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

DEVICE='/dev/sdf'
MOUNT='/var/lib/notes'
FSTAB='/etc/fstab'
OWNER='notes'

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
AIH_EOF
cat > '/usr/local/sbin/notes-release' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

bucket="${1:-}"
version="${2:-}"
# Both arrive from outside the machine. Nothing else is accepted.
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "not a bucket name" >&2; exit 64
fi
if [[ ! "$version" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$ ]]; then
  echo "not a release version" >&2; exit 64
fi

target='/opt/notes/releases'/"$version"
install -d -m 0755 "$target"
aws s3 cp --region 'ap-northeast-1' --only-show-errors \
  "s3://$bucket/releases/$version/server.mjs" "$target/server.mjs.download"

# The version ends with the first 16 hex digits of the file's SHA-256.
actual="$(sha256sum "$target/server.mjs.download" | cut -c1-16)"
if [ "$actual" != "${version##*-}" ]; then
  echo "checksum mismatch: got $actual" >&2
  rm -f "$target/server.mjs.download"
  exit 1
fi
mv "$target/server.mjs.download" "$target/server.mjs"

# rename(2) swaps the link in one step: `current` is never missing.
ln -sfn "$target" '/opt/notes/current.next'
mv -T '/opt/notes/current.next' '/opt/notes/current'
systemctl restart 'notes.service'

for _ in $(seq 1 20); do
  if curl -fsS 'http://127.0.0.1:8787/health' >/dev/null 2>&1; then
    echo "released $version"
    exit 0
  fi
  sleep 1
done
echo "the service did not answer /health after the release" >&2
systemctl --no-pager --lines=20 status 'notes.service' >&2 || true
exit 1
AIH_EOF
chmod 0755 '/usr/local/sbin/notes-data-volume' '/usr/local/sbin/notes-release'

systemctl daemon-reload
systemctl enable 'notes.service'
# Last, because it waits for the volume attachment.
'/usr/local/sbin/notes-data-volume'
echo "user data finished"
