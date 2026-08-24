# monkye-worker — Railway (specs/10-deployment.md §3)
#
# Build context is the REPO ROOT (Railway's Root Directory stays / for both
# services), even though apps/worker is a self-contained Go module:
#   docker build -f apps/worker/Dockerfile .

# ---------------------------------------------------------------------------
# builder
# ---------------------------------------------------------------------------
FROM golang:1.26-alpine AS builder
WORKDIR /src

# go.mod/go.sum first: module downloads cache until a dependency changes.
COPY apps/worker/go.mod apps/worker/go.sum ./
RUN go mod download

COPY apps/worker/ ./

# CGO off → static binaries that run on bare alpine. internal/store/sql/*.sql
# are //go:embed-ed into the binary, so no SQL files are copied at runtime.
#
# One image, many entrypoints: /worker keeps the persistent tick loop working
# (kept only during the cron migration; retired once cron parity is proven);
# /snapshot, /discover, … are the per-job cron entrypoints. Each Railway cron
# service points at this same image and sets startCommand to the binary it
# runs, so the image lifecycle stays single-source.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/worker        ./cmd/worker \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/snapshot      ./cmd/snapshot \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/discover      ./cmd/discover \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/events        ./cmd/events \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/enrich        ./cmd/enrich \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/demand        ./cmd/demand \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/icon_backfill ./cmd/icon_backfill \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/trend_drift   ./cmd/trend_drift

# ---------------------------------------------------------------------------
# runtime — alpine, NOT scratch
# ---------------------------------------------------------------------------
# The worker's whole job is outbound HTTPS (Roblox, rotunnel, YouTube). On
# scratch there is no CA bundle and every fetch fails x509 verification, which
# surfaces as "every job soft-fails" rather than as a startup error.
FROM alpine:3.21 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
  && adduser -D -H -u 10001 worker

COPY --from=builder /out/worker        /worker
COPY --from=builder /out/snapshot      /snapshot
COPY --from=builder /out/discover      /discover
COPY --from=builder /out/events        /events
COPY --from=builder /out/enrich        /enrich
COPY --from=builder /out/demand        /demand
COPY --from=builder /out/icon_backfill /icon_backfill
COPY --from=builder /out/trend_drift   /trend_drift

USER worker

# No EXPOSE and no healthcheck path: the worker serves no HTTP. Persistent
# loop reads job_runs / job_commands; cron entrypoints exit on completion.
# All variants respect SIGTERM through signal.NotifyContext, which is what
# Railway sends when a deploy replaces the pod or a cron slot runs long.
#
# Default entrypoint remains /worker so an existing service without a start
# command override keeps its old behavior. Each cron service SHOULD override
# with the specific binary path (see apps/worker/cron/*.railway.toml).
ENTRYPOINT ["/worker"]
