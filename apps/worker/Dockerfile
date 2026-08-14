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

# CGO off → a static binary that runs on a bare alpine. internal/store/sql/*.sql
# are //go:embed-ed into the binary, so no SQL files are copied at runtime.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

# ---------------------------------------------------------------------------
# runtime — alpine, NOT scratch
# ---------------------------------------------------------------------------
# The worker's whole job is outbound HTTPS (Roblox, rotunnel, YouTube). On
# scratch there is no CA bundle and every fetch fails x509 verification, which
# surfaces as "every job soft-fails" rather than as a startup error.
FROM alpine:3.21 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
  && adduser -D -H -u 10001 worker

COPY --from=builder /out/worker /worker

USER worker

# No EXPOSE and no healthcheck path: the worker serves no HTTP. It is a tick
# loop, not a service — health is read from job_runs rows and control from
# job_commands rows (packages/database/src/schema.ts). It exits on SIGTERM via
# signal.NotifyContext, which is what Railway sends on redeploy.
ENTRYPOINT ["/worker"]
