---
title: "67 Firecracker: Run It Locally"
---

# 67 Firecracker: Run It Locally

This page has two halves. The first runs on any machine: the tests, and printing the requests that would be sent. That is as far as this book actually ran anything. The second boots a microVM on a machine with Linux and KVM and runs the chapter 04 server inside it. It was not run.

## The tests, and printing what would be sent

<!-- section: 67.local -->

```bash
nix develop
vp install --frozen-lockfile
vp test run examples/67-firecracker
vp run firecracker:plan
```

`firecracker:plan` prints the requests of a boot, in order, as curl commands. It opens no socket and sends nothing. With no argument it uses the configuration of the steps in the second half.

```text
# Boot. Nothing below is sent by this command.
# putMachineConfiguration, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/machine-config' -H 'Content-Type: application/json' -d '{"vcpu_count":1,"mem_size_mib":256}'
# putGuestBootSource, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/boot-source' -H 'Content-Type: application/json' -d '{"kernel_image_path":"work/vmlinux","boot_args":"console=ttyS0 reboot=k panic=1"}'
# putGuestDriveByID, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/drives/rootfs' -H 'Content-Type: application/json' -d '{"drive_id":"rootfs","path_on_host":"work/rootfs.ext4","is_root_device":true,"is_read_only":false}'
# putGuestNetworkInterfaceByID, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/network-interfaces/net1' -H 'Content-Type: application/json' -d '{"iface_id":"net1","host_dev_name":"tap0","guest_mac":"06:00:AC:10:00:02"}'
# createSyncAction, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/actions' -H 'Content-Type: application/json' -d '{"action_type":"InstanceStart"}'
```

This output is from a run in this repository on October 13, 2026. They are the calls Firecracker's quickstart sends one at a time with curl. The difference is that this list is built from a validated configuration and its bodies are checked against the specification. For another configuration, pass a JSON file. With `--snapshot` the three calls that take a snapshot are printed as well.

<<< @/examples/67-firecracker/src/args.ts{args}

The tests cover what the previous page described: the check against the specification, validation of the configuration, the list of requests, the client over a Unix domain socket and the lost answer, how boot time is measured, and the assertions on the stack. Their peer is a server of this book's own, so the following is not reproduced.

- How the real Firecracker refuses a wrong configuration or order. Its statuses and messages were not checked
- The boot of a guest. No kernel, root file system or network appears in the tests
- How long a boot takes. The clock in the tests is made up and moves only as far as it is pushed

Running `vp run firecracker:boot` on macOS sends nothing, says that Linux and KVM are needed, and exits.

## The steps on a machine with Linux and KVM

<!-- section: 67.walkthrough -->

Nothing from here on was run. The steps join this chapter's code to the commands of the quickstart (`docs/getting-started.md`). If something fails, first check that the quickstart's own curl commands boot a guest.

What is needed, by the quickstart: Linux on x86_64 or aarch64, and a `/dev/kvm` that can be read and written. The quickstart has the commands to check.

```bash
lsmod | grep kvm
[ -r /dev/kvm ] && [ -w /dev/kvm ] && echo "OK" || echo "FAIL"
```

A Linux machine of your own is the simplest. How to get one on EC2 otherwise is on the [Deploy](/en/chapters/67-firecracker/deploy.md) page. The host kernels Firecracker tests are 5.10, 6.1 and 6.18. The steps also use `curl`, `tar`, `xz`, `squashfs-tools`, `e2fsprogs`, `ssh-keygen`, `iproute2`, `iptables` and `jq`.

First, pack this chapter's programs into a form that runs on a machine without a checkout. This works on macOS too, and was run.

```bash
vp run firecracker:kit:build
```

`dist/kit/` then holds the server that runs in the guest (`guest-server.mjs`), the same thing as `firecracker:plan` (`plan.mjs`), the program that boots and times (`boot.mjs`), and `deploy/`. What runs in the guest is the chapter 04 app, unchanged.

<<< @/examples/67-firecracker/src/guest-server.ts{guest}

The rest runs on the Linux machine, from the directory where `dist/kit/` was put. First, collect everything a boot needs in `work/`.

<<< @/examples/67-firecracker/deploy/prepare.sh

```bash
bash deploy/prepare.sh
```

Fetching the kernel and the root file system is as in the quickstart. They are what the Firecracker project builds and publishes for its own CI, and the root file system is Ubuntu. Three things were added: fetching the Firecracker binary at a pinned version with its checksum, fetching Node.js with its checksum checked likewise, and putting Node.js, `guest-server.mjs` and this unit into the root file system.

<<< @/examples/67-firecracker/deploy/notes.service

One point here is unconfirmed: whether the official Node.js binary runs as it is inside this Ubuntu image. The package list in the script that builds the image suggests it does, and the image itself was not inspected. If it does not, enter the guest by SSH and read `journalctl -u notes`.

Next, the host side of the network.

<<< @/examples/67-firecracker/deploy/tap.sh

```bash
sudo bash deploy/tap.sh up
```

The TAP device and the NAT are as in the quickstart. The last two lines of `up` were added from the production host setup document. When the host is an EC2 instance, a guest that reaches `169.254.169.254` lets the code inside it obtain the credentials of the instance's role. Firecracker filters no packets, so the host drops them.

Use two terminals. In the first, start Firecracker. It only listens on the socket, and nothing runs yet.

```bash
sudo rm -f /tmp/firecracker.socket
sudo work/firecracker --api-sock /tmp/firecracker.socket
```

In the second, send the boot list. Firecracker was started as root, so the side that opens the socket is root too.

```bash
sudo work/node/bin/node boot.mjs
```

`boot.mjs` sends the four configuration calls, sends `InstanceStart`, and then tries again and again, pausing 5 milliseconds in between, until the server in the guest answers at `http://172.16.0.2:8080/health`.

<<< @/examples/67-firecracker/src/boot.ts{boot}

It prints three durations: the configuration calls, the `InstanceStart` call, and the time from sending `InstanceStart` to the first answer. The third contains the boot of the guest kernel, systemd, the start of Node.js, the app's initialization, and the pause between tries. The 125 milliseconds of Firecracker's specification end when init starts, so the two cannot be compared, and the program says so each time it prints the durations. What can be seen here is the cold start that chapter 29 watched from outside Lambda, taken apart on your own machine, from the boot of the microVM to the first answer of your own code.

Once it runs, check from the host.

```bash
curl -s http://172.16.0.2:8080/health
ssh -i work/guest.id_rsa root@172.16.0.2
```

To stop, run `reboot` inside the guest. According to the FAQ, Firecracker does not support rebooting a guest, so `reboot` ends the process. Then put the host's network back.

```bash
sudo bash deploy/tap.sh down
sudo rm -f /tmp/firecracker.socket
```

To go one step further, `sudo work/node/bin/node boot.mjs --snapshot` takes a snapshot after the boot. Look at how the size of `work/snapshot.mem` relates to the configured memory.
