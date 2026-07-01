# API & Data Model

All transport is **HTTPS** (device ↔ Supabase) and **Supabase Realtime** (website ↔ cloud).
There is no MQTT broker. The **JSON payload schemas below are authoritative** and identical
regardless of who reads them.

## 1. Device ↔ Cloud (HTTPS, Supabase Edge Functions)

Base: `{SUPABASE_URL}` from `config.h`. Auth: device sends its `DEVICE_ID` + an **HMAC** of the
body signed with its per-device key (SECURITY.md). TLS is automatic.

| Call | Method | Path | Purpose |
|------|--------|------|---------|
| Ingest telemetry | POST | `/functions/v1/ingest` | 1 Hz state snapshot (body = telemetry JSON) |
| Ingest event | POST | `/functions/v1/ingest` | discrete alert (body = event JSON) |
| Poll commands | GET | `/functions/v1/commands?device={id}&status=pending` | fetch queued commands |
| Ack command | POST | `/functions/v1/commands/ack` | report execution result |

The `ingest` function routes on a `kind` field (`"telemetry"` or `"event"`), upserts
`device_state`, appends a downsampled `telemetry_history` row, and/or inserts `events`.

### Telemetry payload (POST /ingest, kind="telemetry")
```json
{
  "kind": "telemetry",
  "id": "WCHAIR-001", "ts": 1730000000, "fw": "1.2.0", "up": 4213,
  "fix": 1, "lat": 24.860731, "lng": 67.001142, "spd": 4.2, "sats": 9, "hdop": 1.1,
  "pitch": 2.1, "roll": -1.4, "tilt": 2.5,
  "temp_motor": 41.3, "temp_batt": 33.8, "temp_amb": 31.0, "humidity": 64,
  "batt_v": 3.91, "batt_pct": 78, "occupied": 1, "rssi": -61,
  "power": 1, "locked": 0, "session_state": "ACTIVE", "time_left": 540,
  "speed_limit": 6, "over_speed": 0,
  "gf": { "on": 1, "in": 1, "dist": 84, "r": 300 }
}
```

### Event payload (POST /ingest, kind="event")
```json
{ "kind": "event", "id": "WCHAIR-001", "ts": 1730000050, "event": "FALL",
  "lat": 24.8607, "lng": 67.0011, "detail": { "tilt": 57 } }
```
`event` ∈ `BOOT, GEOFENCE_EXIT, GEOFENCE_ENTER, OVERSPEED, OVERTEMP, TILT_WARN, FALL,
TAMPER, EXPIRY_WARNING, SESSION_LOCKED, OTA_PROGRESS, OTA_DONE, OTA_FAIL`.

### Command (GET /commands returns an array)
```json
[ { "id": "b1c2...", "cmd": "UNLOCK", "req_id": "c-9f3a", "args": {} } ]
```
`cmd` ∈ `POWER_ON, POWER_OFF, LOCK, UNLOCK, SET_SPEED_LIMIT(args.kmh),
SET_GEOFENCE(args.lat,lng,radius), START_SESSION(args.session_id,duration_s),
END_SESSION, WARN_EXPIRY(args.seconds_left), OTA(args.url,version,sha256,sig), REBOOT, PING`.

### Ack (POST /commands/ack)
```json
{ "id": "b1c2...", "req_id": "c-9f3a", "ok": true, "state": "ACTIVE" }
```
The function sets that `commands` row `status='acked'` (or `'failed'`), stores `ack`, `acked_at`.

## 2. Website ↔ Cloud

- **Auth:** Supabase Auth (email/phone + password or OTP) → JWT with a `role` claim
  (`rider` / `operator`). All access governed by RLS (SECURITY.md).
- **Reads:** the Next.js app uses the Supabase client (PostgREST) or server actions:
  - available chairs + live status → `wheelchairs` joined with `device_state`
  - a chair's live detail → `device_state`
  - rider's rentals/payments → `rentals`, `payments` (RLS: own rows)
  - fleet + events + history (operator) → `wheelchairs`, `events`, `telemetry_history`
- **Rentals & payments** (Next.js route handlers / Supabase RPC):
  | Action | Where | Purpose |
  |--------|-------|---------|
  | create rental | RPC/route | insert `rentals`(reserved) + create payment intent |
  | payment intent | route | start the gateway adapter |
  | **payment webhook** | **Vercel `/api/payments/webhook`** | verify signature → mark `payments` PAID |
  | extend / end | RPC/route | extend (new payment) / end early |
- **Operator/fleet actions** insert into `commands` (RLS: operator only): power/lock/unlock, set
  geofence, set speed limit, trigger OTA.

## 3. Realtime (live to clients)
Subscribe with the Supabase Realtime client to row changes:
| Channel (table) | Used for |
|-----------------|----------|
| `device_state` | live map markers, speed, temps, lock/power, session state |
| `events` | safety/alert feed |
| `rentals` | session state + `time_left` for the rider |
| `commands` | operator sees command → ack transitions |
Example event delivered to the browser:
```json
{ "table": "device_state", "type": "UPDATE",
  "new": { "wheelchair_id": "WCHAIR-001", "lat": 24.8607, "lng": 67.0011, "speed": 4.2, "locked": false } }
```
No UI polling — Realtime pushes; target visual latency < 500 ms.

## 4. Data model (Postgres — matches `cloud/schema.sql`)

```mermaid
erDiagram
  PROFILES ||--o{ RENTALS : books
  WHEELCHAIRS ||--o{ RENTALS : rented_as
  RENTALS ||--o{ PAYMENTS : has
  WHEELCHAIRS ||--o{ EVENTS : emits
  WHEELCHAIRS ||--o{ TELEMETRY_HISTORY : reports
  WHEELCHAIRS ||--|| DEVICE_STATE : has
  WHEELCHAIRS ||--o{ COMMANDS : receives

  PROFILES { uuid id PK; text name; text phone; text role; ts created_at }
  WHEELCHAIRS { text id PK; text fw_version; text status; ts created_at }
  DEVICE_STATE { text wheelchair_id PK; ts ts; bool online; float lat; float lng; real speed; bool locked; bool power; text session_state; int time_left; int speed_limit; jsonb geofence }
  TELEMETRY_HISTORY { bigint id PK; text wheelchair_id FK; jsonb data; ts ts }
  EVENTS { bigint id PK; text wheelchair_id FK; text type; jsonb detail; float lat; float lng; ts ts }
  RENTALS { uuid id PK; text wheelchair_id FK; uuid user_id FK; text state; ts start_at; ts end_at; int duration_s; int speed_limit }
  PAYMENTS { uuid id PK; uuid rental_id FK; int amount; text currency; text provider; text provider_ref; text status; ts paid_at }
  COMMANDS { uuid id PK; text wheelchair_id FK; text cmd; jsonb args; text status; text req_id; jsonb ack; ts created_at; ts acked_at }
```

- **`device_state`** (one row/chair, upserted) is the live/hot table the UI subscribes to.
  It also holds the **desired** fields (`locked`, `speed_limit`, `geofence`) = the device shadow.
- **`telemetry_history`** is append-only + downsampled + retained (PRODUCTION.md §2).
- **`commands`** is the command queue (device polls; ack updates the row).
- Keep `payments.provider_ref` unique for **idempotent** webhooks; never store raw card data.
