# workerd, its configuration, and chapter 04's app as one bundle.
# Build it from this directory, after `vp run isolates:fetch` and `vp run isolates:bundle`.

# The prebuilt workerd asks for glibc 2.35 or newer. Debian 12 (bookworm) has it;
# Amazon Linux 2023, with glibc 2.34, does not.
FROM debian:bookworm-slim

# Checked against the pinned digest by `vp run isolates:fetch`, before it gets here.
COPY .workerd/linux-arm64/workerd /usr/local/bin/workerd

WORKDIR /app
# config.capnp embeds notes.mjs by its relative name, so the two stay side by side.
COPY dist/config.capnp dist/notes.mjs ./

# workerd needs no privilege to listen on 8080.
USER nobody

EXPOSE 8080

# Exec form, so that workerd is the process that receives SIGTERM.
CMD ["workerd", "serve", "config.capnp"]
