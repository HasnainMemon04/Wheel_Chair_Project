# Production & Cloud Architecture

> This document is the **canonical cloud architecture, scalability, and UI/UX standard**.
> Every other doc (README, ARCHITECTURE, API, SECURITY, FEATURES) is consistent with it.
> All data contracts (payload JSON, features, rental state machine, security rules) still apply.

## 0. Product bar
This is a **production-grade prototype** intended to become a product used by **millions**.
Every decision optimizes for: **scalability, sub-second live data, a beautiful/fast/responsive
UI, and clean presentation.** Prototype-quality shortcuts are only acceptable where a hardware
gap forces it (HARDWARE.md §5), and must be clearly marked `// TODO(prod):`.

## 1. Cloud architecture (Vercel + Supabase)

```mermaid
flowchart LR
  subgraph Device["ESP32-S3 (fleet)"]
    FW[Firmware]
  end
  subgraph Supabase["Supabase (managed cloud)"]
    ING[Edge Function /ingest\nvalidate + HMAC + rate-limit]
    DB[(Postgres)]
    RT[Realtime]
    AUTH[Auth / JWT + RLS]
    CMDQ[commands table]
  end
  subgraph Vercel["Vercel"]
    WEB[Next.js Website + PWA]
    HOOK[Serverless: /api/payments/webhook]
  end
  GW[Payment Gateway]

  FW -- HTTPS POST telemetry/events --> ING --> DB
  FW -- HTTPS POST ack executed cmds --> CMDQ
  DB --> RT
  WEB <-- Realtime subscribe (WSS) --- RT
  WEB <-- REST/RPC --- DB
  WEB --- AUTH
  GW --> HOOK --> DB
  WEB -- operator issues cmd --> DB --> CMDQ
```

**Why this shape:**
- **Vercel** hosts the website + serverless routes (payment webhook). It is *not* where the
  broker or realtime server lives — serverless can't hold device sockets.
- **Supabase** is the always-on cloud: Postgres + Realtime + Auth + Edge Functions. The ESP32
  uploads here; the website reads/subscribes here. This is what makes the data "live and fast"
  without you running any server.
- Devices **never** talk to Vercel; the website **never** talks to devices. Same trust
  boundaries as SECURITY.md, just with managed infra.

### Data paths
- **Telemetry/events up:** ESP32 → `POST` Supabase **Edge Function `/ingest`** (auth by device
  key + HMAC, validates the API.md JSON, rate-limits) → writes DB. Do **not** let devices write
  tables directly.
- **Live to website:** Supabase **Realtime** pushes row changes over WebSocket → the site
  updates in < 500 ms with no polling.
- **Commands down:** operator/web writes a row to `commands` -> the next firmware `POST /ingest`
  response piggybacks pending commands, and the device writes an `ack`. The Python simulator still
  uses `GET /commands?pending`.
- **Payments:** gateway → Vercel `/api/payments/webhook` (verify signature) → mark paid → insert
  UNLOCK command. Never unlock from the client.

## 2. Scalability rules (this is what makes "millions" work)

1. **Split hot vs. cold data.**
   - `device_state`: **one row per wheelchair**, upserted on each telemetry (latest snapshot).
     The live map/dashboard subscribes to this small table → cheap realtime at scale.
   - `telemetry_history`: append-only, **downsampled** (e.g. store 1-in-N or 1/10 s), with a
     **retention policy** (e.g. 30–90 days) and time-based partitioning. Never subscribe the UI
     to raw history.
2. **Indexes:** `device_state(id)`, `events(wheelchair_id, ts desc)`, `rentals(user_id, state)`,
   `commands(wheelchair_id, status)`. Add before load-testing, not after.
3. **Ingestion cost control:** Edge Function batches writes, rejects malformed/oversized bodies,
   and rate-limits per device. Consider a queue if fleet > ~10k devices.
4. **Connection limits:** use Supabase connection pooling (pgBouncer) for serverless; the site
   shares a small pool. Realtime scales independently of Postgres connections.
5. **Read scaling:** cache fleet-list/aggregates at the edge (Vercel edge cache / ISR) with short
   TTL; live views use Realtime, static views use cached queries.
6. **Cost/telemetry:** at 1 Hz × N devices, raw history is the dominant cost — downsampling +
   retention is mandatory, not optional.

## 3. UI/UX standard (the website must feel premium)

- **Framework:** Next.js (App Router) on Vercel. Live views are client components using the
  Supabase Realtime client; static/SEO views use server components + cached queries.
- **Design system:** Tailwind CSS + **shadcn/ui**, one token set (color/space/radius/type),
  dark-first with a light theme, consistent iconography (lucide).
- **Motion & feel:** Framer Motion for transitions; **skeleton loaders** (never spinners on
  first paint); **optimistic UI** on actions (lock/unlock reflects instantly, reconciles on ack).
- **Map (the hero):** MapLibre GL (vector tiles) or Leaflet; **marker clustering** for fleets;
  **interpolate marker movement** between telemetry ticks so motion is smooth at 60 fps, not
  jumpy; live geofence overlay; breach states in color.
- **Live data:** driven by Realtime push (no UI polling). A visible "live" pulse + "updated Xs
  ago". Target visual latency < 500 ms from device upload.
- **Responsive + PWA:** mobile-first (this doubles as the Android app — installable PWA,
  offline shell, add-to-home-screen, push-ready). Fully responsive down to small phones.
- **Accessibility:** WCAG AA — keyboard nav, focus states, contrast, reduced-motion support.
- **Presentation surfaces:** (a) **Rider** view — nearby chairs, rent/pay, live session +
  timer + map; (b) **Operator** dashboard — fleet map, health, events, commands, OTA, geofence;
  (c) **Public/landing** — clean marketing page for the "product" pitch.

### Performance budgets (enforce)
| Metric | Target |
|--------|--------|
| LCP (landing, mobile) | < 2.0 s |
| Realtime visual latency | < 500 ms |
| Map interaction | 60 fps, no jank |
| Route JS (initial) | code-split; keep small |
| Lighthouse (perf/a11y/best-practices) | ≥ 90 |

## 4. Best-algorithm expectations
- **Firmware:** non-blocking FreeRTOS tasks (ARCHITECTURE.md §3); GPS speed smoothing (median +
  light filter); IMU tilt via complementary/Madgwick fusion (not raw accel); debounced tamper;
  haversine geofence; exponential-backoff reconnect; batched uploads.
- **Backend/data:** upsert-latest + downsampled history; idempotent webhook handling; indexed
  queries; realtime deltas not full refetches.
- **Frontend:** virtualized lists, marker clustering + movement interpolation, memoized
  selectors, debounced map queries, edge caching.

## 5. Deployment
- **Website:** Vercel project from `webapp/`. Env vars in `webapp/.env.example`.
- **Cloud:** one Supabase project. Apply `cloud/schema.sql`. Deploy the `/ingest` Edge Function.
  Enable Realtime on `device_state`, `events`, `rentals`, `commands`. Configure RLS
  (rider sees own data; operator sees fleet; device key limited to ingest + its own commands).
- **Secrets:** service-role key only in Vercel server env; device keys provisioned at flash time;
  nothing secret committed (SECURITY.md §9).
