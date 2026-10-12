---
title: "07 File Upload: Run It Locally"
---

# 07 File Upload: Run It Locally

This page runs the attachment feature described up to [Design and Build](/en/chapters/07-uploads/build.md) on your machine, without S3.

## Running it locally

<!-- section: 07.local -->

Copy `examples/07-uploads/.env.example` to a file named `.env` in the same place.

<<< @/examples/07-uploads/.env.example

Use two terminals and run one of these tasks in each.

```bash
vp run dev:uploads:api
vp run dev:uploads:web
```

Open <http://localhost:5173>, sign in, create a note, and open it. Choosing a file under "Images" attaches the image. If you sign in as `bob` in another browser, you see neither Alice's notes nor her images.

You need no Docker, no AWS credentials, and no bucket.

### Standing in for S3

<<< @/examples/07-uploads/api/src/object-store.ts{port}

The app receives the place where bytes are stored as this interface. On AWS it is S3, and locally it is an in-memory implementation.

<<< @/examples/07-uploads/api/src/local-store-http.ts{local-store}

<<< @/examples/07-uploads/api/src/dev.ts{dev}

The local implementation has an endpoint inside the development server that receives the form. Its permits carry a small policy signed with the development secret, and it refuses a different key, a different type, a file that is too large, and an expired permit.

The development server doesn't hand the API a request whose path starts with `/local/`. `POST /local/token` is chapter 06's development sign-in, and the stand-in for the bucket receives everything else.

<<< @/examples/07-uploads/api/src/local-store-http.ts{read-form}

The form has an image in it, so how much is read has a limit. Chapter 04's `readJson` reads only JSON, so this chapter has a function of its own that counts the same way. The limit is 64 KiB above 5 MiB. A file that is only a little too large is read to the end and gets a 400 from the policy's size condition. Past the limit, the rest isn't read and the answer is 413. Both are what the local implementation does, not what S3 returns.

The local implementation is not a simulation of S3. It is a stand-in that lets the app's ordering and authorization run. It doesn't reproduce the following.

- The real evaluation of a POST policy. What S3 refuses, and with what response, isn't reproduced
- The bucket's CORS. Locally the development server returns its own CORS headers
- IAM. You can't tell whether the execution role has enough permissions
- Lifecycle rules. Locally, a pending object stays forever
- URLs expiring early when credentials expire

Running an S3-compatible server in a container would get a little closer to the real thing. That needs Docker, and the Docker daemon is not part of the Nix shell. This chapter provides no task for it. The daemon was not running where this was written, so it was not tried either.

### The screen

The SPA is built on chapter 06's `web/`. Sign-in, loading the configuration, and parsing routes are imported unchanged from chapter 06's files. The only addition is the images panel under the note form.

<<< @/examples/07-uploads/web/src/check-file.ts{check-file}

When you choose a file, the browser also checks its type and size. The check is there to tell the user early, and it is not a defense. If a file that fails the check is sent directly, S3 refuses it (locally, the in-memory implementation does).
