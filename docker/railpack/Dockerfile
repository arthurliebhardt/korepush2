# syntax=docker/dockerfile:1.7
# Image whose only job is to provide a pinned `railpack` binary so a build Job
# can generate a railpack build plan from a repo. Multi-arch via TARGETARCH.
FROM debian:bookworm-slim

ARG RAILPACK_VERSION=0.23.0
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Map Docker's TARGETARCH (amd64|arm64) to railpack's release target triple.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) target="x86_64-unknown-linux-musl" ;; \
      arm64) target="arm64-unknown-linux-musl" ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-${target}.tar.gz"; \
    curl -fsSL "$url" -o /tmp/railpack.tar.gz; \
    tar -xzf /tmp/railpack.tar.gz -C /usr/local/bin railpack; \
    rm /tmp/railpack.tar.gz; \
    /usr/local/bin/railpack --version

# Build Jobs run as uid 1000 (pod securityContext); binary is on PATH and
# world-executable, so no USER needed.
ENTRYPOINT []
