---
title: "67 Firecracker: Design and Build"
---

# 67 Firecracker: Design and Build

This page writes a small client that calls Firecracker's API from TypeScript. It covers only the calls needed to boot one microVM, and everything it sends is checked against the API specification the project publishes. The second half reads, from the sources, two subjects that did not become code: the jailer and snapshots.

## The API socket and the order of a boot

<!-- section: 67.api -->

A Firecracker process that has just started runs nothing. It serves HTTP on a Unix domain socket, takes configuration, and boots the guest only when it receives `InstanceStart`. The paper gives the reason for an API: the process can be started and configured ahead of time, so that when a microVM is needed only `InstanceStart` has to be sent, which shortens the wait. This is what lets Lambda keep a pool of booted microVMs.

```figure
caption: The four configuration calls can be sent only before the boot. InstanceStart succeeds once.
type: sequence
actor client: Client
actor fc: Firecracker
actor guest: Guest
step client -> fc: PUT /machine-config
step client -> fc: PUT /boot-source
step client -> fc: PUT /drives/rootfs
step client -> fc: PUT /network-interfaces/net1
note fc: Up to here, calls can be sent again
step client -> fc: PUT /actions InstanceStart
step fc -> guest: Load the kernel and boot
note fc: From here, the four are refused
step guest --> client: First HTTP answer
```

The API specification is `src/firecracker/swagger/firecracker.yaml` in the repository. The specification document (`SPECIFICATION.md`) promises that the API conforms to that file. So this chapter's code picks one release and checks itself against the file.

<<< @/examples/67-firecracker/src/spec.ts{pinned}

The pinned release is v1.17.0, published on September 10, 2026. The whole specification is 64 KB, and most of it describes operations this chapter does not use: the balloon, memory hotplug, MMDS and others. What is committed is a JSON file with the nine operations above and the definitions they refer to (`spec/firecracker-v1.17.0.subset.json`). This function cuts it out.

<<< @/examples/67-firecracker/src/spec.ts{extract}

`vp run firecracker:spec` downloads the specification from GitHub, checks that its SHA-256 equals `SPEC.sha256`, cuts out the subset, and compares it with the committed JSON. It reads a public file on GitHub and does not touch AWS.

The client is not generated from the specification. Its types and requests are written by hand, and tests check them against it. The tool for that is a small function that checks a value against a definition of the subset.

<<< @/examples/67-firecracker/src/spec.ts{conforms}

`conforms` reads seven keywords, `$ref`, `type`, `required`, `properties`, `enum`, `minimum` and `maximum`, which is not all of Swagger. A test pins that the definitions in the subset use no other keyword (apart from the descriptive `description`, `default`, `format` and `readOnly`). It is stricter than the specification in one way: a property the definition does not name is reported as an error, so that a misspelt field name cannot pass.

The tests establish the following. For every request this code can send, the method and path exist in the specification, the `operationId` is the same, the status awaited as success is among the specification's responses, and the body fits the definition. And each of the nine operations declared as used is sent at least once.

## Validating the configuration

<!-- section: 67.config -->

A microVM's configuration arrives from a file or the command line, so Valibot validates it.

<<< @/examples/67-firecracker/src/config.ts{schema}

Constraints that come from the specification are mixed here with ones this chapter added, so they are listed apart.

- One to 32 vCPUs is the specification's `minimum` and `maximum`. A test checks that the range the schema accepts is the specification's
- The defaults of one vCPU and 128 MiB are Firecracker's own values when nothing is sent, as the specification's description says
- The lower bound for memory, the characters allowed in an ID, and refusing a line break in a path are this chapter's decisions. The specification says only "string" for an ID. An ID becomes part of a URL path, and with the characters narrowed there is no escaping to think about
- The default boot arguments are the ones of Firecracker's quickstart. `console=ttyS0` enables the serial console. The FAQ says the console is disabled by default for boot time, and the production host setup document advises against enabling it in production. This chapter is practice, so it follows the quickstart

Turning a configuration into a list of requests is a pure function that sends nothing.

<<< @/examples/67-firecracker/src/requests.ts{configure}

<<< @/examples/67-firecracker/src/requests.ts{sequences}

A drive is nothing more than the path of a file on the host. The guest sees a virtio block device. For the network, the request names a TAP device already created on the host and the MAC address to show the guest. Creating the TAP device, giving it an address, and filtering the packets that leave are all work outside Firecracker.

## The client, and a lost answer

<!-- section: 67.client -->

The HTTP peer is a Unix domain socket. `http.request` of Node.js accepts a `socketPath`, so this needs no dependency.

<<< @/examples/67-firecracker/src/client.ts{transport}

An answer is handled in one of three ways. The status the specification names as success is success. Any other status means Firecracker refused, and becomes a `FirecrackerApiError` carrying the `fault_message`. No answer at all is a `NoAnswerError`. In that last case it is not known whether Firecracker acted on the request.

<<< @/examples/67-firecracker/src/client.ts{send}

The peer is a process on the same machine, and the problem still has the shape of a distributed one. The state belongs to the Firecracker process, and the client learns it only from answers. This chapter's invariant has two parts. **A microVM whose configuration was refused part-way does not start. The instruction to start takes effect once.**

The first is kept by sending the list in order and stopping at the first failure. `InstanceStart` is last, so it is not sent when something before it fails. A configuration call "creates or updates", in the specification's words, so the same content can be sent again, and after fixing the cause the list can be sent from its beginning.

The second matters when an answer is lost. The API document says `InstanceStart` can be called successfully only once. Sending it again because no answer came would be refused although the guest is running, and the client would take that for a failed boot.

```figure
caption: When the answer to InstanceStart is lost, the client reads the state and does not send the start again.
type: sequence
actor client: Client
actor fc: Firecracker
step client -> fc: PUT /actions InstanceStart
note fc: Becomes Running
step fc --x client: The answer does not arrive
step client -> fc: GET /
step fc --> client: state: Running
```

<<< @/examples/67-firecracker/src/client.ts{start-once}

With no answer and a state that is not `Running`, the error stays an error. Whether sending again is safe is then for the caller to decide, from whether the state was `Not started`.

To check this behavior the tests have a server of their own (`test/support/fake-firecracker.ts`). It listens on a real Unix domain socket, so the HTTP part of the client really runs. It is not Firecracker, though. It is this book's model. It knows four rules, each matching one sentence of the specification or the documents: a body must have the fields its definition requires; the four configuration calls are pre-boot only; `InstanceStart` works once and needs a kernel and a root drive; a snapshot can be taken only in the `Paused` state. It boots no guest. With what status and message the real Firecracker refuses these was not checked.

The tests go after the invariant in a fixed order. They have the drive configuration refused and check that `InstanceStart` is never sent. They let `InstanceStart` take effect and drop its answer, then check that sending it again is refused, and that `startOnce` sends `InstanceStart` exactly once and returns `was-running`. On a socket where nobody answers, they check that the error stays an error.

## The jailer and rate limiters

<!-- section: 67.jailer -->

The next two sections have almost none of this chapter's code. They are the pillars of running Firecracker in production, so they are read from the sources.

KVM and the VMM make the microVM's boundary. Firecracker assumes one more wall outside it. If a flaw in the VMM let a guest take over the Firecracker process, the damage is small when that process can do little. There are two such walls.

One is seccomp. Before running any guest code, Firecracker installs system call filters on itself, per thread. The default filters let through only the minimal set of system calls and arguments Firecracker needs to work.

The other is the **jailer**, a separate program shipped with Firecracker. It is started as root and, by its document, works in this order. It closes open file descriptors and clears the environment. It creates a directory per microVM ID and copies the Firecracker binary into it. It sets resource limits and creates cgroups. It enters a new mount namespace and makes that directory the root with `pivot_root`. It creates `/dev/net/tun` and `/dev/kvm` inside. It joins a network namespace when one is given. Last, it drops privileges to the given uid and gid and `exec`s Firecracker. The reason for copying the binary is given too: the process then shares no memory with any other Firecracker process.

The production host setup document recommends starting Firecracker from the jailer, or under constraints at least as strict, and using a different uid and gid per microVM. The steps on the next page follow the quickstart: no jailer, and Firecracker started as root. That is a shortcut for running one piece of your own code to see it work, not a setup for running anyone else's.

The rate limiters are the `rxRateLimiter` and `txRateLimiter` of the configuration schema. Firecracker can give each network interface and each drive two token buckets, one for bandwidth (bytes) and one for the number of operations (packets, or I/O requests). A bucket is defined by its size, the time it takes to refill, and an extra amount usable once at boot. The limiters of a network interface can still be changed with `PATCH` after the boot.

The paper gives two reasons for putting rate limiting in the VMM: to leave room on storage and network for control traffic, and to keep a few busy microVMs from affecting the performance of the others. A guest cannot be trusted to limit itself, so the limit is applied where the device is emulated. The Lambda whitepaper, too, lists Firecracker configuration that limits block device and network device throughput among its isolation technologies. How a function's memory setting relates to these limits cannot be known from outside AWS.

## Snapshots and SnapStart

<!-- section: 67.snapshot -->

Firecracker can pause a running microVM and write its state to files. Two are written: a file with the guest's memory and a file with the state of the virtual hardware. Disk files are not included and are managed by the user. There are three API calls, and the list this chapter's client builds is the `snapshotSequence` of the earlier section: `PATCH /vm` to `Paused`, `PUT /snapshot/create` to write, and `PATCH /vm` back to `Resumed`.

Resuming happens in a new Firecracker process, with `PUT /snapshot/load` sent before other configuration. Firecracker does not read the whole memory file then. It maps the file with `MAP_PRIVATE`, loads pages as the guest touches them, and sends writes to separate memory. That is why resuming is fast, and in return the memory file must be kept for as long as the resumed microVM lives. Diff snapshots are in developer preview in v1.17.0.

What the document warns about most is uniqueness. Resuming more than once from one snapshot duplicates what should exist once inside the guest: random seeds, IDs, tokens meant for a single use. Through a device called VMGenID, Firecracker tells the guest kernel that it was resumed, and a guest on Linux 5.18 or later reseeds the kernel's random number generator. Values the application holds remain duplicated, and the document says the user has to recreate them. That network connections survive a resume is not guaranteed either.

On the relation to SnapStart, only what AWS writes can be said. The SnapStart page says what Lambda takes is "a Firecracker microVM snapshot", of the memory and disk state of the initialized execution environment. The cautions on that page are the same two as in the document above. A unique value created during initialization is the same across the execution environments that share the snapshot, so create it after initialization. A connection opened during initialization has to be checked and reopened after a resume.

Whether the snapshot Lambda takes uses the API or the file format read here cannot be confirmed from outside AWS. This chapter's code goes as far as building the list of snapshot calls and checking it against the specification. It did not take a snapshot.
