---
title: "23 VM: Build, Continued"
---

# 23 VM: Build, Continued

## Turning a process into a service

<!-- section: 23.service -->

Type `node server.mjs` and the API runs. But it stops when the session closes. Nobody restarts it when it dies. After a reboot, somebody has to type it again.

systemd takes that over. It is the program that starts first on Linux and looks after the other processes, and a file called a unit tells it what to run, as whom, how, and what to do when it dies.

<<< @/examples/23-ec2/deploy/notes.service

Let's read it from the top.

`RequiresMountsFor` and `AssertPathIsMountPoint` say: do not start unless the data volume is mounted. Without them, something scary can happen. If the API comes up after the volume preparation failed, the notes are written to the same path on the root volume. Everything looks fine, and it is all gone the day the instance is replaced.

`ConditionPathExists` says: if the application itself is not there yet, quietly skip the start. Before the first release, that is the normal state.

`User=notes` runs the process as a dedicated user, not as root. `ProtectSystem=strict` shows the whole file system to this process as read-only, and the data volume listed in `ReadWritePaths` is the only exception. If the API has a hole, that is the only place that can be overwritten.

`Restart=on-failure` restarts the process two seconds after an abnormal exit. Restarting a process that dies at every start forever is pointless, though, so `StartLimitBurst` gives up after five deaths within a minute. A service that was given up on stays in the `failed` state, which you can see.

`/usr/bin/node-24` in `ExecStart` is the executable with the version in its name, installed by the `nodejs24` package of Amazon Linux 2023. Plain `node` can be switched to point at another version, so it is not used.

Environment variables are not written into the unit. `EnvironmentFile` reads them from a separate file, and `HOST=127.0.0.1` in there confines the API to the instance. Even if somebody opens the security group, it cannot be reached from outside.

The meaning of these directives was checked in the man pages of systemd 252. The version that Amazon Linux 2023 ships was not looked at on an instance.

### Where do the logs go?

The chapter 04 application writes its logs to standard output as JSON. Under systemd, they collect in a facility called journald. Amazon Linux 2023 has no traditional `/var/log/messages`.

```bash
vp run ec2:logs
```

This task runs `journalctl --unit notes.service` through Run Command and brings back the last 50 lines.

The difference from Lambda is that these logs are on the instance's root volume. When the instance goes, the logs go. Exactly when you want to know why it died, there are no logs. Avoiding that means shipping the logs out. The CloudWatch agent can send journald entries to CloudWatch Logs, but from a private subnet it needs one more interface endpoint, `logs`, which adds USD 20.44 a month, and the role needs permissions for it. This chapter does not set it up. It is the kind of thing that is too much for a practice machine and required for a production one.

## Stopping politely

<!-- section: 23.shutdown -->

A service gets stopped. Every release restarts it, and the operating system reboots now and then. When that happens, systemd sends the process a signal called SIGTERM: a request to stop.

Left alone, Node.js exits on the spot. Requests that were being handled are cut off without a response. If a note was being saved, the caller cannot even tell whether it was saved.

<<< @/examples/23-ec2/src/shutdown.ts{shutdown}

When asked, refuse new connections, finish the requests in flight, wait for the writes to reach the disk, and then exit. That is a graceful shutdown.

```figure
caption: On SIGTERM the process refuses new connections, finishes the request in flight and its writes, and then exits
type: sequence
actor systemd: systemd
actor proc: notes process
actor client: client
step systemd -> proc: t0: systemctl restart, SIGTERM
step proc -> proc: t1: listening socket closed
step client -x proc: new connection: refused
step proc --> client: t2: 201 for the request before t0
step proc -> proc: t3: pending file writes flushed
step proc -> proc: t4: exit 0
step systemd -> proc: t5: starts the new process
note proc: listening again
step client -> proc: connections accepted
```

```figure
caption: Waiting has two limits, and the 20 seconds after which the process exits by itself come before systemd's 30 seconds
type: sequence
actor systemd: systemd
actor proc: notes process
actor client: client
step systemd -> proc: t0: SIGTERM
note proc: t2 has not happened after 20 s
step proc -x client: remaining connections closed
step proc -> proc: exit 1
note systemd: process still there after 30 s
step systemd -> proc: SIGKILL (TimeoutStopSec)
```

Waiting has a limit. A request that has not finished after 20 seconds is cut from this side. systemd sends SIGKILL at 30 seconds (the unit's `TimeoutStopSec`), and that cannot be resisted, so the process settles things itself before then. A test watches the order of these two numbers. Change only one and it fails.

Here is where it is put together.

<<< @/examples/23-ec2/src/server.ts{server}

`createApp` is imported from chapter 04 as it is. Not one line of the application changed. What changed is around it: a file instead of a `Map`, a process that stays instead of a function, and a place to receive signals.

The test opens a real socket to check this. It sends a request, holds it halfway through, and calls the shutdown. After seeing a new connection refused, it lets the held request go on. The first request gets its 201, then the writes are awaited, then the process ends with exit code 0. That order is pinned.

Between t1 and t5 in the diagram, nobody is listening. It is a few seconds, but a request that arrives then fails. With one machine, a restart is always an outage. Removing it takes a second process and a load balancer in front of both ([chapter 12](/en/chapters/12-containers.md)).

## Data goes on a separate volume

<!-- section: 23.data -->

In chapter 04 the notes were in a `Map`, and they vanished when the execution environment was replaced. This time there is one process, and it keeps running. So the notes go into a file.

<<< @/examples/23-ec2/src/file-notes.ts{repository}

It implements the `NoteRepository` interface from chapter 04 unchanged.

What it has to guarantee, in one sentence: **a note that was answered with 201 can be read after the process restarts and after the instance is replaced.**

What attacks that is a stop in the middle of a write. If the power goes after half the file was written, what is left does not parse as JSON. At the next start, not a single note can be read.

<<< @/examples/23-ec2/src/file-notes.ts{storage}

So the file is never overwritten directly. A new file is written beside it, confirmed to have reached the disk, and then renamed over the old one. A rename either happened or did not. A reader sees the old content or the new content, never a mixture.

The test cuts the power at each of the three steps in turn: the write, the rename, and the directory sync. Wherever it stops, the file that remains reads in full and agrees with what is in memory. When a damaged file is found, the process refuses to start instead of starting empty. Starting empty would overwrite the damaged file with an empty one at the next write.

Now the honest part. The reverse does not hold. If the directory sync fails after the rename, the caller gets a 500 and the note is saved anyway: "told it failed, and yet it is there". If the caller retries, there are two copies of the note. The chapter 04 API has nothing that prevents duplicates. Also, this class is correct for one process only. If two processes open the same file, whichever writes later erases the other's write. What guarantees that there is one is systemd, not the code.

Against a real disk, it is implemented like this.

<<< @/examples/23-ec2/src/node-files.ts{node-files}

### Which disk is that file on?

An instance's disks are EBS volumes: disks attached over the network, which can exist as resources of their own, apart from the instance.

An instance comes with one root volume. It holds the operating system, is created from the AMI, and is deleted along with the instance. Put the notes there and, as "Choosing an AMI" showed, one deploy can erase them.

So one more volume is created.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{data-volume}

The point is that it is a separate resource, not something written inside the instance's settings. When the instance is replaced, this volume is not deleted. By EC2's own default, too, a volume attached after launch stays when the instance is deleted.

Then when is it deleted? When the stack is destroyed. `dataOnDestroy` decides that, and the default is `delete`: this is for practice, so it goes with the stack and nothing is left behind. In production use `snapshot` (take a snapshot before deleting) or `retain` (keep the volume). Either way, what remains keeps costing money.

A volume belongs to one Availability Zone and attaches only to an instance in the same zone. The code passes the instance's zone to it. If you ever want to move the instance to another zone, the volume cannot follow. You take a snapshot and restore it in the new zone.

### Format an empty volume, once

A new volume is blank. It needs a file system, and it needs to be mounted.

<<< @/examples/23-ec2/deploy/notes-data-volume.sh

The most important part of this script is the `case`. `mkfs` erases what is on a volume. Run it against a volume with contents and every note is gone. And this script runs on the first boot of a new instance, which means it also runs when the instance was replaced and the old volume was attached again.

So it formats only when it has confirmed that there is no file system. Told there is one, it leaves the volume alone. When it cannot tell, it also leaves the volume alone, and stops with a failure.

The test really runs this script with bash. Only the commands that touch a disk (`blkid`, `mkfs.xfs`, `mount`, and so on) are replaced with stand-ins that record that they were called. It formats on a first instance, runs again on a second instance (a fresh fstab, the same volume), and confirms that `mkfs` was called exactly once.

There are smaller details too. The volume is attached after the instance starts, so the script waits up to five minutes for the device to appear. `/etc/fstab` gets the UUID, not the device name: on current instances, EBS volumes show up as NVMe devices whose names can swap between boots. `nofail` says that the operating system boots even without the volume. Without it, an instance whose volume was detached would not boot, and you could not even get in to fix it.
