---
title: "07 File Upload: Run It Locally"
---

# 07 File Upload: Run It Locally

## Running it locally

<!-- section: 07.local -->

Copy `examples/07-uploads/.env.example` to `.env` in the same place.

<<< @/examples/07-uploads/.env.example

Use two terminals.

```bash
vp run dev:uploads:api
vp run dev:uploads:web
```

Open <http://localhost:5173>, sign in, create a note, and open it. Choose a file under "Images" and the image is attached. Sign in as `bob` in another browser and neither Alice's note nor her image is visible.

No Docker, no AWS credentials, no bucket.

### Standing in for S3

<<< @/examples/07-uploads/api/src/object-store.ts{port}

The app receives "a place that holds bytes" as this interface. In AWS it is S3. On your laptop it is an in-memory implementation.

<<< @/examples/07-uploads/api/src/local-store-http.ts{local-store}

<<< @/examples/07-uploads/api/src/dev.ts{dev}

The local implementation has an endpoint for the form inside the development server. Its permits carry a small policy signed with the development secret, and it refuses a different key, a different type, a file that is too large, and an expired permit.

This is not an emulation of S3. It is a stand-in that lets the app's ordering and authorization run. What it does not reproduce:

- The real evaluation of a POST policy: what S3 refuses, and with what response
- The bucket's CORS. Locally the development server returns its own CORS headers
- IAM: whether the execution role has enough permissions
- Lifecycle rules. Locally, a pending object stays forever
- URLs expiring early when credentials expire

An S3-compatible server in a container would get you a little closer to the real thing. That needs Docker, and the Docker daemon is not part of the Nix shell. This chapter provides no task for it. The daemon was not running where this was written, so it was not tried either.

### The screen

The SPA is built on chapter 06's `web/`. Sign-in, loading the configuration, and parsing routes are imported from chapter 06's files as they are. The only addition is the images panel under the note form.

<<< @/examples/07-uploads/web/src/check-file.ts{check-file}

When you choose a file, the browser checks the type and size as well. That is a courtesy, not a control. Send a file that would fail the check directly, and S3 refuses it (locally, the in-memory implementation does).
