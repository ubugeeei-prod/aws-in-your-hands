# The image one agent task starts from. Build it from this directory, after
# `vp run sandbox:bundle` has written dist/entry.mjs and dist/settings.json.

FROM node:24-bookworm-slim

# git for the repository; bubblewrap, socat and ripgrep are what Claude Code's Bash sandbox needs on Linux.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates bubblewrap socat ripgrep \
  && rm -rf /var/lib/apt/lists/*

# An exact version: the image is the known state every task starts from.
RUN npm install -g @anthropic-ai/claude-code@2.1.287

ENV NODE_ENV=production \
  DISABLE_AUTOUPDATER=1

COPY dist/entry.mjs /opt/sandbox/entry.mjs
# Owned by root, on a root file system the task mounts read-only: the agent cannot change its own rules.
COPY dist/settings.json /etc/claude-code/managed-settings.json

# The task definition mounts an empty volume on each of these; the rest of the file system is
# read-only. ECS copies a VOLUME path's owner to the volume, which would otherwise belong to root.
RUN mkdir -p /workspace && chown node:node /workspace /home/node && chmod 1777 /tmp
VOLUME ["/workspace", "/home/node", "/tmp"]
USER node
WORKDIR /workspace

ENTRYPOINT ["node", "/opt/sandbox/entry.mjs"]
