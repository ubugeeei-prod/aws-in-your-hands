---
title: "23 VM: Build, Continued"
---

# 23 VM: Build, Continued

The [previous page](/en/chapters/23-ec2/build.md) built the instance up to its first boot. This page builds the notes API that runs on it. You hand the process to systemd, decide how it ends when it is told to stop, and write the notes to a file on a separate volume.

## Turning a process into a systemd service

<!-- section: 23.service -->

Typing `node server.mjs` starts the API, but it stops when the session closes. Nobody restarts it when it dies, and after the operating system reboots somebody has to type the command again.

systemd takes over that work. It is the program that starts first on Linux and manages the other processes. A file called a unit tells it what to run, as which user, how, and what to do when the process dies.

<<< @/examples/23-ec2/deploy/notes.service

The explanation follows the file from the top.

`RequiresMountsFor` and `AssertPathIsMountPoint` tell systemd not to start the service unless the data volume is mounted. Without them, the API could come up after the volume preparation failed, and the notes would be written to the same path on the root volume. Everything would appear to work, and every note would be lost on the day the instance is replaced.

`ConditionPathExists` makes systemd skip the start without an error when the application itself is not there yet. Before the first release, a missing application is the normal state.

`User=notes` runs the process as a dedicated user, not as root. `ProtectSystem=strict` presents the whole file system to this process as read-only, and the data volume listed in `ReadWritePaths` is the only exception. If the API has a hole, the data volume is the only place that can be overwritten.

`Restart=on-failure` restarts the process two seconds after an abnormal exit. Restarting a process that dies at every start is pointless, though, so `StartLimitBurst` makes systemd stop restarting after five failures within a minute. A service that systemd stopped restarting stays in the `failed` state, which you can see when you look at its status.

`/usr/bin/node-24` in `ExecStart` is the executable with the version in its name, installed by the `nodejs24` package of Amazon Linux 2023. The unit does not use plain `node`, because that name can be switched to point at another version.

Environment variables are not written into the unit. `EnvironmentFile` reads them from a separate file, and `HOST=127.0.0.1` in that file makes the API listen only inside the instance. Even if somebody opens the security group, the API cannot be reached from outside.

The meaning of these directives was checked in the man pages of systemd 252. The systemd version that Amazon Linux 2023 ships was not checked on an instance.

### Where the logs go

The chapter 04 application writes its logs to standard output as JSON. Under systemd, those logs are collected by journald. Amazon Linux 2023 does not have the traditional `/var/log/messages`.

```bash
vp run ec2:logs
```

This task runs `journalctl --unit notes.service` through Run Command and fetches the last 50 lines.

Unlike with Lambda, these logs are on the instance's root volume, so they are lost when the instance is. The logs are missing in exactly the cases where you most want to know why the instance went down. To avoid that, send the logs off the instance. The CloudWatch agent can send journald entries to CloudWatch Logs, but from a private subnet it needs one more interface endpoint, `logs`, which adds USD 20.44 a month, and the role needs permissions for it. This chapter leaves it out because it is too much for a practice machine. A production machine needs it.

## Shutting down

<!-- section: 23.shutdown -->

A service is sometimes stopped from outside. Every release restarts it, and the operating system reboots now and then. When that happens, systemd sends the process a signal called SIGTERM, which asks it to stop.

If the process does nothing about it, Node.js exits on the spot. Requests that were being handled are cut off without a response, and if a note was being saved, the caller cannot tell whether it was saved.

<<< @/examples/23-ec2/src/shutdown.ts{shutdown}

On SIGTERM, the process refuses new connections, finishes the requests in flight, waits for the writes to reach the disk, and then exits. This is called a graceful shutdown.

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

The first figure shows the case where the request in flight finishes in time, and the second shows the case where it does not. The wait has a limit, and the process itself cuts off any request that has not finished after 20 seconds. systemd sends SIGKILL after 30 seconds (the unit's `TimeoutStopSec`), which the process cannot refuse, so the process exits by itself before that. A test checks which of these two numbers is larger, and it fails if you change only one of them.

The server is assembled here.

<<< @/examples/23-ec2/src/server.ts{server}

`createApp` is imported from chapter 04 unchanged, and not one line of the application was modified. What changed is everything around it. The notes moved from a `Map` to a file, the function that ran per call became a process that keeps running, and signal handling was added.

The test opens a real socket to check the order of events. It sends a request, holds it partway through, and calls the shutdown in that state. After seeing a new connection refused, it lets the held request continue. The test pins the sequence up to the end, in which the first request gets its 201, the writes are awaited, and the process ends with exit code 0.

Between t1 and t5 in the first figure, nothing is listening for connections. That lasts a few seconds, but a request that arrives in that time fails. With only one machine, every restart causes an outage. Removing the outage takes a second process and a load balancer in front of both ([chapter 12](/en/chapters/12-containers.md)).

## Data goes on a separate volume

<!-- section: 23.data -->

In chapter 04 the notes were in a `Map`, and they were lost when the execution environment was replaced. In this chapter there is one process and it keeps running, so the notes are written to a file.

<<< @/examples/23-ec2/src/file-notes.ts{repository}

This class implements the `NoteRepository` interface from chapter 04 unchanged.

The invariant to keep is one sentence. **A note that was answered with 201 can be read after the process restarts and after the instance is replaced.**

A stop in the middle of a write is what breaks it. If the power goes out after half the file was written, the file that remains does not parse as JSON, and at the next start not a single note can be read.

<<< @/examples/23-ec2/src/file-notes.ts{storage}

For that reason the file is never overwritten directly. The class writes a new file beside it, confirms that the new file has reached the disk, and then renames it over the old one. A rename has either happened or not happened. A reader sees the old content or the new content and never a mixture of the two.

The test cuts the power at each of the three steps in turn, which are the write, the rename, and the directory sync. Wherever it stops, the file that remains can be read in full and matches what is in memory. When the class finds a damaged file, it refuses to start instead of starting empty, because starting empty would overwrite the damaged file with an empty one at the next write.

The reverse does not hold. If the directory sync fails after the rename, the caller gets a 500 even though the note is saved. The caller was told the request failed, and the note exists. If the caller retries, the same note exists twice, because the chapter 04 API has nothing that prevents duplicates. In addition, this class is correct only when there is one process. If two processes open the same file, whichever writes later erases the other's write. systemd, not the code, is what guarantees that there is only one process.

The implementation against a real disk is as follows.

<<< @/examples/23-ec2/src/node-files.ts{node-files}

### Which disk the file is on

An instance's disks are EBS volumes. An EBS volume is a disk attached over the network, and it can exist as a resource separate from the instance.

An instance comes with one root volume. It holds the operating system, is created from the AMI, and is deleted along with the instance. If the notes were kept there, a single deploy could erase them, as the section [Choosing an AMI](/en/chapters/23-ec2/build.md) showed.

The stack therefore creates one more volume.

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{data-volume}

This volume is declared as an independent resource, not inside the instance's settings, so it is not deleted when the instance is replaced. By EC2's own default, too, a volume attached after launch remains when the instance is deleted.

The volume is deleted when the stack is destroyed. `dataOnDestroy` decides how, and the default is `delete`. The stack is for practice, so the volume goes with it and nothing is left behind. In production, use `snapshot`, which takes a snapshot before deleting, or `retain`, which keeps the volume. In both cases, what remains keeps costing money.

A volume belongs to one Availability Zone and can be attached only to an instance in the same zone. The code passes the instance's zone to the volume. If you move the instance to another zone, the volume cannot move as it is, so you take a snapshot and restore it in the new zone.

### Format an empty volume, once

A new volume is empty, so it needs a file system and it needs to be mounted.

<<< @/examples/23-ec2/deploy/notes-data-volume.sh

The most important part of this script is the `case`. `mkfs` erases what is on a volume, so running it against a volume with contents would destroy every note. This script runs on the first boot of a new instance, which means it also runs after the instance was replaced and the old volume was attached again.

The script therefore formats only when it has confirmed that there is no file system. When it finds one, it leaves the volume alone. When it cannot tell, it also leaves the volume alone and stops with a failure.

The test actually runs this script with bash. Only the commands that touch a disk (`blkid`, `mkfs.xfs`, `mount`, and so on) are replaced with stand-ins that record that they were called. The test formats on a first instance, runs the script again on a second instance (a new fstab, the same volume), and confirms that `mkfs` was called only once.

The script takes care of a few more things. The volume is attached after the instance starts, so the script waits up to five minutes for the device to appear. It writes the UUID, not the device name, into `/etc/fstab`, because on current instances EBS volumes appear as NVMe devices whose names can change between boots. `nofail` lets the operating system boot even without the volume. Without it, an instance whose volume was detached would not boot, and you could not get in to fix it.
