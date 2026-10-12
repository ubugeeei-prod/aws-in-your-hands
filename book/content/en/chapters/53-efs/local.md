---
title: "53 EFS: Run It Locally"
---

# 53 EFS: Run It Locally

The repository from the [previous page](/en/chapters/53-efs/build.md) needs nothing more than a directory. This page runs it with two processes sharing one local directory, and goes through what the tests look at and what they do not. No AWS account is needed.

## Two processes and one directory

<!-- section: 53.local -->

The development server runs chapter 04's API over a directory.

<<< @/examples/53-efs/src/dev.ts{dev}

Open two terminals and start it in each, changing only the port. Without `NOTES_DIR`, both use `examples/53-efs/.data`.

```bash
vp run dev:efs
PORT=8788 vp run dev:efs
```

Write to one and read from the other.

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"written through 8787"}'
curl -s http://localhost:8788/notes
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8788/notes/..%2F..%2Fetc%2Fpasswd
```

The list on the second line contains the note created on the first. The third line prints 404. The notes are in `.data/notes/`, one file each, and `.data/incoming/` is empty. Do the same with chapter 23's repository and each process replaces the file with its own memory, so a note created through one disappears. The tests on the previous page reproduce that.

The tests and the synth:

```bash
vp run test:unit
vp run efs:infra:synth
```

What the tests look at, and what they do not:

| Where | What it looks at | What it does not |
| --- | --- | --- |
| `test/note-files.test.ts` | On a shared file system in memory: what a reader sees when the writer vanishes at each step of a write. ID checks, the limit, and two copies of chapter 04's API on top | A real file system |
| `test/two-writers.test.ts` | On the real local file system: writing in place, rename into place, notes lost by two copies of chapter 23's repository, append | NFS, and what two different machines see |
| `infra/test/efs-stack.test.ts` | The policy, security groups, role, mount settings, and resource types | AWS behaving as the template says |

Here is what a local file system and NFS have in common and where they differ. The machine this chapter was written on runs macOS, with APFS.

What they share is the API, and the fact that `rename` replaces a file in one operation. `open`, `write`, `fsync`, `rename`, `readdir`, and `unlink` are the same calls when the mount is EFS. The two writers in the tests live in one process, but to the kernel they are no different from files opened by two processes.

They differ in the following ways, none of which is reproduced locally.

- Locally, what is written is visible to everyone at once. On NFS each client has a cache, and another client's change may take time to appear. When a freshly renamed file or a directory listing becomes visible to another execution environment was not measured
- Locally, an append is one operation. On NFS it is not. The second append test is a model that imitates the difference on a local file
- Locally, an operation either succeeds or fails. On NFS it can succeed while the reply is lost. The case in `test/note-files.test.ts` where the writer is lost during sync reproduces the equivalent in memory
- Locally there is no throughput limit, and no charge per operation

The [next page](/en/chapters/53-efs/wrap.md) has the steps for deploying and checking. They are prepared, not the record of a run.
