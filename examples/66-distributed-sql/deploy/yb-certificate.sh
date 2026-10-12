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
