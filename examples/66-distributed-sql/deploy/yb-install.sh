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
