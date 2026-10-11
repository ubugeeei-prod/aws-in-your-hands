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
