#!/bin/bash
# Runs once, as root, on the first boot. Output: /var/log/cloud-init-output.log
set -euo pipefail

dnf install -y xfsprogs

if ! id -u 'celld' >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir '/var/lib/celld' --shell /sbin/nologin 'celld'
fi
install -d -m 0755 '/opt/celld' '/opt/celld/releases' '/etc/celld'

cat > '/etc/systemd/system/celld.service' <<'AIH_EOF'
[Unit]
Description=celld node (AWS in Your Hands, chapter 24)
After=network-online.target
Wants=network-online.target
RequiresMountsFor=/var/lib/celld
AssertPathIsMountPoint=/var/lib/celld
ConditionPathExists=/opt/celld/current/celld
ConditionPathExists=/etc/celld/celld.env
StartLimitIntervalSec=0

[Service]
Type=simple
User=celld
Group=celld
EnvironmentFile=/etc/celld/celld.env
ExecStart=/opt/celld/current/celld
Restart=always
RestartSec=15
KillSignal=SIGTERM
TimeoutStopSec=60
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/celld

[Install]
WantedBy=multi-user.target
AIH_EOF
cat > '/usr/local/sbin/celld-data-volume' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

DEVICE='/dev/sdf'
MOUNT='/var/lib/celld'
FSTAB='/etc/fstab'
OWNER='celld'

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
cat > '/usr/local/sbin/celld-install' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

bucket="${1:-}"
version="${2:-}"
digest="${3:-}"
# All three arrive from outside the machine. Nothing else is accepted.
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "not a bucket name" >&2; exit 64
fi
if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "not a release tag" >&2; exit 64
fi
if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
  echo "not a SHA-256" >&2; exit 64
fi

target='/opt/celld/releases'/"$version"
install -d -m 0755 "$target"
aws s3 cp --region 'ap-northeast-1' --only-show-errors \
  "s3://$bucket/artifacts/$version/celld-aarch64-unknown-linux-gnu.gz" "$target/celld.gz.download"

# The digest is pinned in the repository, not read from the bucket.
actual="$(sha256sum "$target/celld.gz.download" | cut -d" " -f1)"
if [ "$actual" != "$digest" ]; then
  echo "checksum mismatch: got $actual" >&2
  rm -f "$target/celld.gz.download"
  exit 1
fi
gzip -dc "$target/celld.gz.download" > "$target/celld.new"
chmod 0755 "$target/celld.new"
mv "$target/celld.new" "$target/celld"
rm -f "$target/celld.gz.download"

# IMDSv2: a session token first, then the address this instance has inside the VPC.
token="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 'http://169.254.169.254/latest/api/token')"
address="$(curl -fsS -H "X-aws-ec2-metadata-token: $token" 'http://169.254.169.254/latest/meta-data/local-ipv4')"
if [[ ! "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "could not read the private address from instance metadata" >&2; exit 1
fi

install -d -m 0750 -o 'celld' -g 'celld' '/var/lib/celld/state'
cat > '/etc/celld/celld.env.next' <<CELLD_ENV
CELLD_BUCKET=s3://$bucket/fleet
AWS_REGION=ap-northeast-1
CELLD_ADDR=127.0.0.1:8080
CELLD_INTERNAL_ADDR=$address:8081
CELLD_ADVERTISE=$address:8081
CELLD_WATCH=/var/lib/celld/state
CELLD_ENV
mv '/etc/celld/celld.env.next' '/etc/celld/celld.env'

# rename(2) swaps the link in one step: `current` is never missing.
ln -sfn "$target" '/opt/celld/current.next'
mv -T '/opt/celld/current.next' '/opt/celld/current'
echo "installed $version at $address; celld.service was not restarted"
AIH_EOF
chmod 0755 '/usr/local/sbin/celld-data-volume' '/usr/local/sbin/celld-install'

systemctl daemon-reload
systemctl enable 'celld.service'
# Last, because it waits for the volume attachment.
'/usr/local/sbin/celld-data-volume'
echo "user data finished"
