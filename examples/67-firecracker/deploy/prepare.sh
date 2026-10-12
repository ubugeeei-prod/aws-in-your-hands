#!/usr/bin/env bash
# Fills work/ with everything a boot needs: the Firecracker binary, a guest kernel, a root
# file system with Node.js and the notes API in it, and an SSH key for the guest.
#
# Never run by this book: it was written on macOS, where there is no KVM. The kernel and rootfs
# steps follow docs/getting-started.md of Firecracker v1.17.0 (Apache-2.0); the rest is ours.
#
#   bash deploy/prepare.sh            from the directory that holds guest-server.mjs and deploy/
set -euo pipefail

ARCH="$(uname -m)"
FC_VERSION="v1.17.0"
NODE_VERSION="v24.21.0"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$PWD/work}"
mkdir -p "$WORK"
cd "$WORK"

release="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}"
asset="firecracker-${FC_VERSION}-${ARCH}.tgz"
curl -fsSL -o "$asset" "${release}/${asset}"
curl -fsSL -o "${asset}.sha256.txt" "${release}/${asset}.sha256.txt"
# The checksum file names the asset, so sha256sum finds it by itself.
sha256sum -c "${asset}.sha256.txt"
tar -xzf "$asset"
cp "release-${FC_VERSION}-${ARCH}/firecracker-${FC_VERSION}-${ARCH}" firecracker

# Checksums read from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt on 2026-10-13.
case "$ARCH" in
  x86_64) node_arch="x64"; node_sha="fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6" ;;
  aarch64) node_arch="arm64"; node_sha="6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2" ;;
  *) echo "no Node.js build chosen for $ARCH" >&2; exit 1 ;;
esac
node_tar="node-${NODE_VERSION}-linux-${node_arch}.tar.xz"
curl -fsSL -o "$node_tar" "https://nodejs.org/dist/${NODE_VERSION}/${node_tar}"
echo "${node_sha}  ${node_tar}" | sha256sum -c -
# One copy for the host, to run boot.mjs. The guest gets its own below.
mkdir -p node
tar -xJf "$node_tar" -C node --strip-components=1

# From the quickstart: the newest kernel and Ubuntu rootfs that Firecracker's own CI published.
S3="https://s3.amazonaws.com/spec.ccfc.min"
CI_ARTIFACTS_PREFIX=$(curl -fsSL "$S3?list-type=2&prefix=firecracker-ci/&delimiter=/" \
    | grep -oP "(?<=<Prefix>)firecracker-ci/[0-9]{8}-[^/]+/(?=</Prefix>)" \
    | sort \
    | tail -1)
latest_kernel_key=$(curl -fsSL "$S3?list-type=2&prefix=${CI_ARTIFACTS_PREFIX}${ARCH}/vmlinux-" \
    | grep -oP "(?<=<Key>)(${CI_ARTIFACTS_PREFIX}${ARCH}/vmlinux-[0-9]+\.[0-9]+\.[0-9]{1,3})(?=</Key>)" \
    | sort -V \
    | tail -1)
latest_ubuntu_key=$(curl -fsSL "$S3?list-type=2&prefix=${CI_ARTIFACTS_PREFIX}${ARCH}/ubuntu-" \
    | grep -oP "(?<=<Key>)(${CI_ARTIFACTS_PREFIX}${ARCH}/ubuntu-[0-9]+\.[0-9]+\.squashfs)(?=</Key>)" \
    | sort -V \
    | tail -1)
curl -fsSL -o vmlinux "$S3/${latest_kernel_key}"
curl -fsSL -o rootfs.squashfs "$S3/${latest_ubuntu_key}"
echo "kernel: ${latest_kernel_key}"
echo "rootfs: ${latest_ubuntu_key}"

sudo rm -rf squashfs-root
sudo unsquashfs rootfs.squashfs
# The CI rootfs has no key in it. This one is made here and never leaves work/.
rm -f guest.id_rsa guest.id_rsa.pub
ssh-keygen -q -f guest.id_rsa -N ""
sudo mkdir -p squashfs-root/root/.ssh
sudo cp guest.id_rsa.pub squashfs-root/root/.ssh/authorized_keys

# Ours: Node.js, the bundled notes API, and a unit that starts it at boot.
sudo mkdir -p squashfs-root/opt/node squashfs-root/opt/notes
sudo tar -xJf "$node_tar" -C squashfs-root/opt/node --strip-components=1
sudo cp "$HERE/guest-server.mjs" squashfs-root/opt/notes/server.mjs
sudo cp "$HERE/deploy/notes.service" squashfs-root/etc/systemd/system/notes.service
sudo mkdir -p squashfs-root/etc/systemd/system/multi-user.target.wants
sudo ln -sf /etc/systemd/system/notes.service \
  squashfs-root/etc/systemd/system/multi-user.target.wants/notes.service

sudo chown -R root:root squashfs-root
rm -f rootfs.ext4
# Sparse: 2 GiB is the size the guest sees, not what the file takes on the host.
truncate -s 2G rootfs.ext4
sudo mkfs.ext4 -q -d squashfs-root -F rootfs.ext4

echo
echo "ready in $WORK: firecracker, vmlinux, rootfs.ext4, guest.id_rsa, node/"
