#!/bin/bash
# Runs once, as root, on the first boot. Output: /var/log/cloud-init-output.log
set -euo pipefail

dnf install -y xfsprogs openssl tar gzip

if ! id -u 'yugabyte' >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir '/var/lib/yugabyte' --shell /sbin/nologin 'yugabyte'
fi
install -d -m 0755 '/etc/yugabyte'

# The kernel settings the documentation lists for a node on a virtual machine.
cat > '/etc/sysctl.d/90-yugabyte.conf' <<'AIH_EOF'
vm.swappiness=0
vm.max_map_count=262144
AIH_EOF
sysctl --system >/dev/null

cat > '/etc/systemd/system/yb-master.service' <<'AIH_EOF'
[Unit]
Description=YugabyteDB yb-master (AWS in Your Hands, chapter 66)
After=network-online.target chronyd.service
Wants=network-online.target
RequiresMountsFor=/var/lib/yugabyte
AssertPathIsMountPoint=/var/lib/yugabyte
ConditionPathExists=/var/lib/yugabyte/current/bin/yb-master
ConditionPathExists=/etc/yugabyte/master.conf
StartLimitIntervalSec=0

[Service]
Type=simple
User=yugabyte
Group=yugabyte
ExecStartPre=+/bin/sh -c 'echo always > /sys/kernel/mm/transparent_hugepage/enabled'
ExecStart=/var/lib/yugabyte/current/bin/yb-master --flagfile /etc/yugabyte/master.conf
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=60
LimitNOFILE=1048576
LimitNPROC=12000
LimitCORE=infinity

[Install]
WantedBy=multi-user.target
AIH_EOF
cat > '/etc/systemd/system/yb-tserver.service' <<'AIH_EOF'
[Unit]
Description=YugabyteDB yb-tserver (AWS in Your Hands, chapter 66)
After=network-online.target chronyd.service
Wants=network-online.target
RequiresMountsFor=/var/lib/yugabyte
AssertPathIsMountPoint=/var/lib/yugabyte
ConditionPathExists=/var/lib/yugabyte/current/bin/yb-tserver
ConditionPathExists=/etc/yugabyte/tserver.conf
StartLimitIntervalSec=0

[Service]
Type=simple
User=yugabyte
Group=yugabyte
ExecStartPre=+/bin/sh -c 'echo always > /sys/kernel/mm/transparent_hugepage/enabled'
ExecStart=/var/lib/yugabyte/current/bin/yb-tserver --flagfile /etc/yugabyte/tserver.conf
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=60
LimitNOFILE=1048576
LimitNPROC=12000
LimitCORE=infinity

[Install]
WantedBy=multi-user.target
AIH_EOF
cat > '/usr/local/sbin/yb-data-volume' <<'AIH_EOF'
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
AIH_EOF
cat > '/usr/local/sbin/yb-install' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

bucket="${1:-}"; version="${2:-}"; build="${3:-}"; digest="${4:-}"
# All four arrive from outside the machine. Nothing else is accepted.
if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "not a bucket name" >&2; exit 64
fi
if [[ ! "$version" =~ ^[0-9]{4}(\.[0-9]+){3}$ || ! "$build" =~ ^b[0-9]+$ ]]; then
  echo "not a release" >&2; exit 64
fi
if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
  echo "not a SHA-256" >&2; exit 64
fi

install -d -m 0755 -o 'yugabyte' -g 'yugabyte' '/var/lib/yugabyte/releases' '/var/lib/yugabyte/data'
aws s3 cp --region 'ap-northeast-1' --only-show-errors \
  "s3://$bucket/artifacts/$version/yugabyte-$version-$build-el8-aarch64.tar.gz" '/var/lib/yugabyte/releases/download.tar.gz'

# The digest comes from the repository, by way of the caller. It is not read from the bucket.
actual="$(sha256sum '/var/lib/yugabyte/releases/download.tar.gz' | cut -d" " -f1)"
if [ "$actual" != "$digest" ]; then
  echo "checksum mismatch: got $actual" >&2
  rm -f '/var/lib/yugabyte/releases/download.tar.gz'
  exit 1
fi
rm -rf /var/lib/yugabyte/releases/"$version".new
mkdir /var/lib/yugabyte/releases/"$version".new
tar -xzf '/var/lib/yugabyte/releases/download.tar.gz' -C /var/lib/yugabyte/releases/"$version".new --strip-components=1
rm -f '/var/lib/yugabyte/releases/download.tar.gz'
# The documentation has this run once after the archive is extracted on Linux.
/var/lib/yugabyte/releases/"$version".new/bin/post_install.sh
chown -R 'yugabyte:yugabyte' /var/lib/yugabyte/releases/"$version".new
rm -rf /var/lib/yugabyte/releases/"$version"
mv /var/lib/yugabyte/releases/"$version".new /var/lib/yugabyte/releases/"$version"

# rename(2) swaps the link in one step: `current` is never missing.
ln -sfn /var/lib/yugabyte/releases/"$version" '/var/lib/yugabyte/current.next'
mv -T '/var/lib/yugabyte/current.next' '/var/lib/yugabyte/current'
echo "installed yugabyte-$version; no service was restarted"
AIH_EOF
cat > '/usr/local/sbin/yb-configure' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

NODE="${1:-}"; ADDR_A="${2:-}"; ADDR_B="${3:-}"; ADDR_C="${4:-}"
for address in "$ADDR_A" "$ADDR_B" "$ADDR_C"; do
  if [[ ! "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "not an IPv4 address: $address" >&2; exit 64
  fi
done
# IMDSv2: a session token first, then what this instance is.
token="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 'http://169.254.169.254/latest/api/token')"
imds() { curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"; }
ZONE="$(imds placement/availability-zone)"
if [[ ! "$ZONE" =~ ^[a-z0-9-]+$ ]]; then
  echo "could not read the zone from instance metadata" >&2; exit 1
fi

case "$NODE" in
  a)
    cat > '/etc/yugabyte/master.conf' <<FLAGS
--master_addresses=${ADDR_A}:7100,${ADDR_B}:7100,${ADDR_C}:7100
--rpc_bind_addresses=${ADDR_A}:7100
--webserver_port=7000
--replication_factor=3
--fs_data_dirs=/var/lib/yugabyte/data
--placement_cloud=aws
--placement_region=ap-northeast-1
--placement_zone=${ZONE}
--webserver_interface=${ADDR_A}
--certs_dir=/etc/yugabyte/certs
--use_node_to_node_encryption=true
--use_client_to_server_encryption=true
--allow_insecure_connections=false
FLAGS
    cat > '/etc/yugabyte/tserver.conf' <<FLAGS
--tserver_master_addrs=${ADDR_A}:7100,${ADDR_B}:7100,${ADDR_C}:7100
--rpc_bind_addresses=${ADDR_A}:9100
--webserver_port=9000
--enable_ysql=true
--pgsql_proxy_bind_address=${ADDR_A}:5433
--pgsql_proxy_webserver_port=13000
--start_cql_proxy=false
--start_redis_proxy=false
--ysql_enable_auth=true
--fs_data_dirs=/var/lib/yugabyte/data
--placement_cloud=aws
--placement_region=ap-northeast-1
--placement_zone=${ZONE}
--webserver_interface=${ADDR_A}
--certs_dir=/etc/yugabyte/certs
--use_node_to_node_encryption=true
--use_client_to_server_encryption=true
--allow_insecure_connections=false
FLAGS
    ;;
  b)
    cat > '/etc/yugabyte/master.conf' <<FLAGS
--master_addresses=${ADDR_A}:7100,${ADDR_B}:7100,${ADDR_C}:7100
--rpc_bind_addresses=${ADDR_B}:7100
--webserver_port=7000
--replication_factor=3
--fs_data_dirs=/var/lib/yugabyte/data
--placement_cloud=aws
--placement_region=ap-northeast-1
--placement_zone=${ZONE}
--webserver_interface=${ADDR_B}
--certs_dir=/etc/yugabyte/certs
--use_node_to_node_encryption=true
--use_client_to_server_encryption=true
--allow_insecure_connections=false
FLAGS
    cat > '/etc/yugabyte/tserver.conf' <<FLAGS
--tserver_master_addrs=${ADDR_A}:7100,${ADDR_B}:7100,${ADDR_C}:7100
--rpc_bind_addresses=${ADDR_B}:9100
--webserver_port=9000
--enable_ysql=true
--pgsql_proxy_bind_address=${ADDR_B}:5433
--pgsql_proxy_webserver_port=13000
--start_cql_proxy=false
--start_redis_proxy=false
--ysql_enable_auth=true
--fs_data_dirs=/var/lib/yugabyte/data
--placement_cloud=aws
--placement_region=ap-northeast-1
--placement_zone=${ZONE}
--webserver_interface=${ADDR_B}
--certs_dir=/etc/yugabyte/certs
--use_node_to_node_encryption=true
--use_client_to_server_encryption=true
--allow_insecure_connections=false
FLAGS
    ;;
  c)
    cat > '/etc/yugabyte/master.conf' <<FLAGS
--master_addresses=${ADDR_A}:7100,${ADDR_B}:7100,${ADDR_C}:7100
--rpc_bind_addresses=${ADDR_C}:7100
--webserver_port=7000
--replication_factor=3
--fs_data_dirs=/var/lib/yugabyte/data
--placement_cloud=aws
--placement_region=ap-northeast-1
--placement_zone=${ZONE}
--webserver_interface=${ADDR_C}
--certs_dir=/etc/yugabyte/certs
--use_node_to_node_encryption=true
--use_client_to_server_encryption=true
--allow_insecure_connections=false
FLAGS
    cat > '/etc/yugabyte/tserver.conf' <<FLAGS
--tserver_master_addrs=${ADDR_A}:7100,${ADDR_B}:7100,${ADDR_C}:7100
--rpc_bind_addresses=${ADDR_C}:9100
--webserver_port=9000
--enable_ysql=true
--pgsql_proxy_bind_address=${ADDR_C}:5433
--pgsql_proxy_webserver_port=13000
--start_cql_proxy=false
--start_redis_proxy=false
--ysql_enable_auth=true
--fs_data_dirs=/var/lib/yugabyte/data
--placement_cloud=aws
--placement_region=ap-northeast-1
--placement_zone=${ZONE}
--webserver_interface=${ADDR_C}
--certs_dir=/etc/yugabyte/certs
--use_node_to_node_encryption=true
--use_client_to_server_encryption=true
--allow_insecure_connections=false
FLAGS
    ;;
  *) echo "not a node name: $NODE" >&2; exit 64 ;;
esac
chown 'yugabyte:yugabyte' '/etc/yugabyte/master.conf' '/etc/yugabyte/tserver.conf'
echo "configured node $NODE in $ZONE; no service was restarted"
AIH_EOF
cat > '/usr/local/sbin/yb-csr' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

# IMDSv2: a session token first, then what this instance is.
token="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 'http://169.254.169.254/latest/api/token')"
imds() { curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"; }
address="$(imds local-ipv4)"
if [[ ! "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "could not read the private address from instance metadata" >&2; exit 1
fi
install -d -m 0700 -o 'yugabyte' -g 'yugabyte' '/etc/yugabyte/certs'
umask 077
openssl req -new -newkey rsa:2048 -nodes -sha256 -subj "/O=AWS in Your Hands/CN=$address" \
  -keyout '/etc/yugabyte/certs/node.'"$address"'.key' -out '/etc/yugabyte/certs/node.csr' 2>/dev/null
chown 'yugabyte:yugabyte' '/etc/yugabyte/certs/node.'"$address"'.key'
cat '/etc/yugabyte/certs/node.csr'
AIH_EOF
cat > '/usr/local/sbin/yb-certificate' <<'AIH_EOF'
#!/bin/bash
set -euo pipefail

certificate="${1:-}"; ca="${2:-}"
for value in "$certificate" "$ca"; do
  if [[ ! "$value" =~ ^[A-Za-z0-9+/=]+$ ]]; then
    echo "not base64" >&2; exit 64
  fi
done
# IMDSv2: a session token first, then what this instance is.
token="$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 'http://169.254.169.254/latest/api/token')"
imds() { curl -fsS -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"; }
address="$(imds local-ipv4)"
key='/etc/yugabyte/certs/node.'"$address"'.key'
crt='/etc/yugabyte/certs/node.'"$address"'.crt'
echo "$certificate" | base64 -d > "$crt.new"
echo "$ca" | base64 -d > '/etc/yugabyte/certs/ca.crt.new'
# A certificate for another key, or from another CA, must not replace a working one.
openssl verify -CAfile '/etc/yugabyte/certs/ca.crt.new' "$crt.new" >/dev/null
if [ "$(openssl x509 -in "$crt.new" -noout -pubkey | sha256sum)" != "$(openssl pkey -in "$key" -pubout | sha256sum)" ]; then
  echo "the certificate does not belong to this node's key" >&2; exit 1
fi
mv "$crt.new" "$crt"
mv '/etc/yugabyte/certs/ca.crt.new' '/etc/yugabyte/certs/ca.crt'
chown 'yugabyte:yugabyte' "$crt" '/etc/yugabyte/certs/ca.crt'
echo "certificate for $address installed; expires $(openssl x509 -in "$crt" -noout -enddate | cut -d= -f2)"
AIH_EOF
chmod 0755 '/usr/local/sbin/yb-data-volume' '/usr/local/sbin/yb-install' '/usr/local/sbin/yb-configure' '/usr/local/sbin/yb-csr' '/usr/local/sbin/yb-certificate'

systemctl daemon-reload
systemctl enable yb-master.service yb-tserver.service
# Last, because it waits for the volume attachment.
'/usr/local/sbin/yb-data-volume'
echo "user data finished"
