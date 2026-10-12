# Chapter 12's notes API and this chapter's job, as two files on one base image.
# Build it from this directory, after `vp run fargate:bundle` has written dist/.

# The same base image as chapter 12, so that the service behaves the same there and here.
FROM node:24-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app
COPY --chown=node:node dist/server.mjs dist/job.mjs ./

USER node

EXPOSE 8080

# The service runs this. The job's task definition replaces it with ["node", "job.mjs"].
CMD ["node", "server.mjs"]
