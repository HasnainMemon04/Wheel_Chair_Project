# Smart Rental Wheelchair — System Specification

> **Purpose:** a complete, build-ready engineering specification for an IoT smart rental
> wheelchair, written to be handed to **Claude Code** as the source of truth. All documents
> are consistent on one stack: **ESP32-S3 → Supabase → Vercel**. Read in the order in §5.

---

## 1. What we are building

A rentable, internet-connected electric wheelchair. A rider finds a chair on a **web / Android
app**, pays, and it **unlocks**. While rented it is tracked and monitored for safety. When the
session ends (or payment lapses) it warns the rider, comes to a safe stop, and **locks** until
paid again. Operators manage the fleet and push firmware updates remotely.

### Features in scope (this phase)

| # | Feature | One-line behavior |
|---|---------|-------------------|
| 1 | Remote Power ON/OFF | Operator/app toggles main power via a relay |
| 2 | Temperature Monitoring | Battery temp (DS18B20), over-temp → alarm + cutoff |
| 4 | GPS Tracking & Geofencing | Live location; alert + action on leaving the rental zone |
| 7 | Internet Connectivity | WiFi ↔ Supabase cloud over HTTPS |
| 9 | Gyroscope & Tilt Detection | MPU6500 detects dangerous tilt / fall → safe stop + alert |
| 10 | Tamper Detection | Vibration + motion while locked → alarm + notify |
| 12 | OTA Updates | Remote, versioned, signed firmware updates |
| 13 | Rental Session Control | Pay-to-unlock, timed session, warn-before-expiry, lock on expiry |

> Features 3 (full BMS), 5 (speed limiting), 6 (camera), 8 (IP67), 11 (downhill control) are **out of scope** this phase.

---

## 2. System at a glance

```mermaid
flowchart LR
  subgraph Device["Wheelchair Device (ESP32-S3)"]
    SENS[Sensors: GPS, MPU6050, DS18B20x2, DHT22, FSR, SW-420, SW-520D]
    ACT[Actuators: 2ch Relay, Buzzer]
    FW[Firmware / FreeRTOS]
    SENS --> FW --> ACT
  end
  subgraph Supabase["Supabase (managed cloud)"]
    ING[Edge Function /ingest]
    CMD[commands table]
    DB[(Postgres)]
    RT[Realtime]
    AUTH[Auth + RLS]
  end
  subgraph Vercel["Vercel"]
    WEB[Next.js Website + PWA]
    HOOK[/api/payments/webhook/]
  end
  GW[Payment Gateway]

  FW -- HTTPS POST telemetry/events --> ING --> DB
  FW -- HTTPS poll pending cmds + ack --> CMD
  DB --> RT
  WEB <-- Realtime WSS --- RT
  WEB <-- reads/RPC --- DB
  WEB --- AUTH
  GW --> HOOK --> DB
  WEB -- operator inserts cmd --> CMD
```

Three tiers: **Device** (firmware) → **Supabase** (cloud DB/Realtime/Auth/Edge) ← **Clients**
(Next.js web + PWA on Vercel). The device only talks to Supabase over HTTPS; the website only
talks to Supabase; clients never talk to a device directly. See **PRODUCTION.md** for the full
cloud rationale, scalability rules, and UI/UX standard.

---

## 3. Technology stack

| Layer | Choice | Why |
|-------|--------|-----|
| MCU / Firmware | **ESP32-S3-WROOM-1**, PlatformIO, Arduino core, FreeRTOS tasks | your BOM; WiFi + GPIO + OTA |
| Device ↔ Cloud | **HTTPS** to **Supabase Edge Functions** (`/ingest`, `/commands`) | no self-hosted broker; works from any WiFi |
| Cloud data plane | **Supabase** — Postgres + **Realtime** + Auth + Edge Functions | always-on; live data with nothing to run |
| Website / Android | **Next.js (App Router) on Vercel**, installable **PWA** | one codebase = website + Android app |
| Live to clients | **Supabase Realtime** (WebSocket) | live map + session timer, no polling |
| Rental timers | **Supabase scheduled function (pg_cron)** | fires warn/expiry, inserts commands |
| Payments | **Adapter**: MockGateway (dev) → JazzCash/Easypaisa/Stripe; webhook on Vercel | swappable; real gateways need a merchant account |
| OTA | **Signed HTTPS pull** (SHA-256 + signature) | remote field updates |
| Infra | **Supabase + Vercel** (fully managed) | scales without ops |

---

## 4. Repository layout

```
wheelchair-system/
├── docs/                      ← these specs (source of truth)
├── firmware/                  ← ESP32-S3, PlatformIO
│   ├── platformio.ini
│   ├── include/config.h       ← pins, WiFi, Supabase endpoints, IDs, thresholds
│   └── src/                   ← main.cpp + one module per subsystem
├── cloud/                     ← Supabase
│   ├── schema.sql             ← tables, realtime, RLS
│   └── functions/
│       ├── ingest/            ← Edge Function: telemetry/event intake
│       └── commands/          ← Edge Function: device poll + ack
└── webapp/                    ← Next.js PWA (rider + operator + landing)
    └── .env.example
```

---

## 5. Document index — read in this order

1. **PRODUCTION.md** — cloud architecture, scalability rules, UI/UX standard, performance budgets.
2. **ARCHITECTURE.md** — components, firmware task model, data flow.
3. **HARDWARE.md** — every component → feature, pin map, wiring, power, known gaps.
4. **FEATURES.md** — functional spec + **acceptance criteria** per feature.
5. **API.md** — HTTPS ingest/command contracts, JSON payloads, Realtime, data model.
6. **RENTAL.md** — rental **state machine**, payment flow, safety interlock priority.
7. **SECURITY.md** — threat model + controls (device auth, signing, OTA, RLS, secrets).

---

## 6. Build order for Claude Code (milestones)

Each milestone is independently testable and demoable end-to-end. Do them in order; stop after
each for review.

1. **M1 — Telemetry to cloud:** Supabase project + `cloud/schema.sql` + `/ingest` Edge Function;
   firmware reads all sensors → HTTPS upload; `device_state` upserts + `telemetry_history` appends
   (downsampled). Ship a device **simulator** for hardware-free testing.
2. **M2 — Live website:** Next.js on Vercel; fleet + rider map subscribing to `device_state`
   Realtime; design system + smooth interpolated markers.
3. **M3 — Commands & actuation:** `commands` table + device polling + ack; operator power/lock/
   unlock (relay) with optimistic UI.
4. **M4 — Rental state machine:** pg_cron timer, warn-before-expiry (buzzer + web banner), safe
   stop → lock on expiry; refuse motion while LOCKED.
5. **M5 — Payments:** MockGateway + Vercel webhook → mark paid → auto-unlock; idempotent on `provider_ref`.
6. **M6 — Safety interlocks:** tilt/fall, over-temp, tamper, geofence, over-speed → safe-state
   actions that override rental.
7. **M7 — Security hardening:** RLS policies, device-key + HMAC on `/ingest` and commands, JWT
   roles, signed commands, audit log.
8. **M8 — OTA:** versioned + signed firmware, remote update command, blocked during active motion.
9. **M9 — Polish & scale:** PWA/Android install polish, landing page, performance budgets,
   retention/downsampling, indexes.

> **Definition of done per milestone:** acceptance criteria in FEATURES.md pass, and the feature
> is demoable end-to-end (device/simulator → Supabase → website) at the UI/UX + performance bar.
