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
