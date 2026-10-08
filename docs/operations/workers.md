# Workers, deployment and health checks

## What runs in the background

| Worker | Cadence | What it does | Where its position lives |
|---|---|---|---|
| Day / backfill sync | Slow tick (5 min). Each country uses its own interval (Norway 30 min, Finland 6 h, Ireland 6 h, France daily …). | Fetches the registration-day window, ingests it and rebuilds snapshots | `registrysyncs`, `countries.lastSuccessAt` |
| Live change feeds | Fast tick (30 s). Each source uses its own interval (Norway / NL 60 s, Estonia 300 s). | Norway update feed, KVK signals, RIK change list → new companies, refreshes, source removals | `checkpoints` (`feed:<provider>`) |
| Companies House stream | Persistent | Streams company events with timepoint resume, 416 gap recovery and 429 back-off | `checkpoints` (`stream:companies-house`) |
| Contact research | Fast tick, concurrency 2 | Durable `jobs` queue: registry → website → paid providers → verification; retries 1/3/7/14/30 days | `jobs` (lease, attempts, runAt, DEAD = dead-letter) |
| Research backfill | Slow tick | Queues never-researched companies from the last 90 days, newest first | `companies.research` |
| Publication checks | Slow tick (hourly per source) | Records the source's own latest publication time (e.g. CRO dataset modification) | `countries.latestPublicationAt` |
| Migrations | First slow tick | Idempotent schema migrations | `systemsettings.__migrations` |

## Single instance (default)

`npm run build && npm start` starts all workers inside the Node.js server process (`src/instrumentation.ts`).

- **Restart behaviour:** every position is in MongoDB, so a restart resumes where it stopped.
  - Feeds resume from their checkpoints.
  - The stream resumes from its last committed timepoint.
  - Jobs whose lease expired (5 minutes) are retried.
  - Sync runs left RUNNING are marked interrupted after 10 minutes.
- **Deploys:** a normal restart is safe.
  - The stream reconnects with at least 1 minute between attempts (Companies House rule).
  - A timepoint older than the stream's window triggers REST gap recovery.

## Multiple instances / serverless

Set `REGISTRY_SCHEDULER=off` and `UK_STREAM_WORKER=off` on the web instances, then do one of the following:

- **Option A (recommended):** run one extra worker instance with `REGISTRY_SCHEDULER=on`. It is the same build; route no traffic to it.
- **Option B:** call the cron endpoints with `Authorization: Bearer $CRON_SECRET`:
  - `GET /api/registry/cron` every 5 minutes (slow tick).
  - `GET /api/jobs/cron` every 30–60 seconds (fast tick).

  The Companies House stream needs a long-lived process, so use option A if you want it.

Live updates reach browsers through the existing SSE endpoint (`/api/realtime`, `intel` channel; internal users with company access only). The in-memory realtime provider only fans out within one process. With multiple web instances, implement the Redis `RealtimeProvider` (see `src/lib/realtime`), so worker events reach every instance.

## Health checks

| Check | How |
|---|---|
| Workers alive | **Research ops** page → Workers (last fast / slow tick), or `GET /api/research/status` → `scheduler` |
| Feed position and delay | Data Sources → "Measured feed delay"; `checkpoints` collection |
| Stream | Research ops → Companies House stream (connected, reconnects, last error) |
| Job backlog / dead letters | Research ops → Workers (`research · dead: n`) |
| Provider errors | Data Sources → state "Provider error" with the last successful sync |
| Budget | Research ops → Budget |

## Failure isolation

- A failing registry never removes or replaces stored companies. The country shows **Provider error** with the last successful sync time.
- A failing contact provider never affects registry ingestion. The company shows **Provider unavailable** and is retried later.
- Quota or budget exhaustion shows **Budget paused**, not "no contact found".
- A genuine zero (no registrations that day) is distinguishable from "not synced" (no snapshot), missing credentials and provider errors.
