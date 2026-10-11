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
