# The notes API as one file on a Node.js base image.
# Build it from this directory, after `vp run ecs:bundle` has written dist/server.mjs.

# The same major version as the Nix shell and as chapter 04's Lambda runtime.
FROM node:24-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app
# esbuild already put the app and its dependencies into this one file, so the
# image needs no node_modules, no package manager, and no build step of its own.
COPY --chown=node:node dist/server.mjs ./server.mjs

# The base image ships an unprivileged user named "node". The process needs nothing more.
USER node

# Documentation for whoever reads the image; the task definition is what maps the port.
EXPOSE 8080

# No HEALTHCHECK: ECS ignores the one in an image, and the load balancer checks
# /health over the same network path that real requests take.

# Exec form, so that node is the process that receives SIGTERM. In shell form
# the signal would go to /bin/sh, and node would be killed 30 seconds later.
CMD ["node", "server.mjs"]
