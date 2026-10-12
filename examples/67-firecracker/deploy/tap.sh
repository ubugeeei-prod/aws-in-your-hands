#!/usr/bin/env bash
# The host side of the guest's network, as the quickstart of Firecracker v1.17.0 sets it up:
# one TAP device, 172.16.0.1/30 on the host, and NAT for what the guest sends out.
# Never run by this book (no KVM on the machine it was written on).
#
#   sudo bash deploy/tap.sh up
#   sudo bash deploy/tap.sh down
set -euo pipefail

TAP_DEV="tap0"
TAP_IP="172.16.0.1"
MASK_SHORT="/30"
HOST_IFACE=$(ip -j route list default | jq -r '.[0].dev')

case "${1:-}" in
  up)
    ip link del "$TAP_DEV" 2> /dev/null || true
    ip tuntap add dev "$TAP_DEV" mode tap
    ip addr add "${TAP_IP}${MASK_SHORT}" dev "$TAP_DEV"
    ip link set dev "$TAP_DEV" up
    sh -c "echo 1 > /proc/sys/net/ipv4/ip_forward"
    iptables -P FORWARD ACCEPT
    iptables -t nat -D POSTROUTING -o "$HOST_IFACE" -j MASQUERADE 2> /dev/null || true
    iptables -t nat -A POSTROUTING -o "$HOST_IFACE" -j MASQUERADE
    # From the production host document: the guest must not reach the host's instance metadata,
    # which on EC2 hands out the credentials of the instance role.
    iptables -D FORWARD -i tap+ -d 169.254.169.254 -j DROP 2> /dev/null || true
    iptables -I FORWARD -i tap+ -d 169.254.169.254 -j DROP
    ;;
  down)
    ip link del "$TAP_DEV" 2> /dev/null || true
    iptables -t nat -D POSTROUTING -o "$HOST_IFACE" -j MASQUERADE 2> /dev/null || true
    iptables -D FORWARD -i tap+ -d 169.254.169.254 -j DROP 2> /dev/null || true
    ;;
  *)
    echo "usage: tap.sh up|down" >&2
    exit 64
    ;;
esac
