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
