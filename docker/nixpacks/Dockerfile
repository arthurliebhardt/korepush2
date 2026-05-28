# syntax=docker/dockerfile:1.7
# Image whose only job is to provide a pinned `nixpacks` binary so a build Job
# can generate a Dockerfile from a repo. Multi-arch via TARGETARCH.
FROM debian:bookworm-slim

ARG NIXPACKS_VERSION=1.41.0
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Map Docker's TARGETARCH (amd64|arm64) to nixpacks' rust target triple.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) target="x86_64-unknown-linux-musl" ;; \
      arm64) target="aarch64-unknown-linux-musl" ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-${target}.tar.gz"; \
    curl -fsSL "$url" -o /tmp/nixpacks.tar.gz; \
    tar -xzf /tmp/nixpacks.tar.gz -C /usr/local/bin nixpacks; \
    rm /tmp/nixpacks.tar.gz; \
    /usr/local/bin/nixpacks --version

# Build Jobs run as uid 1000 (pod securityContext); no USER needed here since
# the binary is on PATH and world-executable.
ENTRYPOINT []
