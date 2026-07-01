# Security & Threat Model

This is a vehicle that locks/unlocks and takes payment, so security is a primary requirement.
Trust boundaries: **device ↔ Supabase Edge Functions**, **client ↔ Supabase/Vercel**,
**payment gateway ↔ Vercel webhook**.

## 1. Assets & adversaries
- **Assets:** physical control of the chair (lock/unlock/power), rider PII, payment status,
  firmware integrity, location data.
- **Adversaries:** a rider trying to ride without paying; an attacker forging commands to unlock
  chairs; someone tampering with a locked chair; a malicious/rogue firmware image; a leaked key.

## 2. Threats → controls

| # | Threat | Control |
|---|--------|---------|
| T1 | Forged "unlock" command | Commands are inserted only by an authenticated **operator** (RLS: operator role) or by server logic after a verified payment. The device fetches commands over TLS and **verifies an HMAC** (per-device key) on each command before acting; unsigned/invalid → rejected |
| T2 | Replay of a captured command | Each command has a unique `req_id` + timestamp/nonce; the device drops stale or duplicate `req_id`s it has already acked |
| T3 | Rider claims payment without paying | Unlock happens only after the **gateway's signed webhook** is verified server-side (Vercel route); never trust a client assertion |
| T4 | Eavesdropping location / PII | **TLS everywhere** (HTTPS to Edge Functions, WSS for Realtime) — automatic on Supabase/Vercel; minimize stored PII; encrypt sensitive columns at rest if required |
| T5 | Rogue/downgraded firmware via OTA | OTA binary must pass **SHA-256 + signature** verified against a public key embedded in firmware; refuse a `version` ≤ running; only from the signed manifest |
| T6 | Physical tamper of a locked chair | Tamper task (SW-420 + MPU6050 + FSR), armed when LOCKED → siren + operator alert + `events` log |
| T7 | Stolen JWT / session hijack | Supabase Auth short-lived access tokens + refresh; **RLS role scoping** (a `rider` cannot insert commands or read fleet data); rate limiting; audit log of operator actions |
| T8 | Misconfigured RLS / leaked service-role key | Ship **default-deny RLS**, least-privilege policies; the **service-role key lives only in Vercel server env / Edge Function secrets** and is never exposed to the browser; devices never get the service-role key — only their own device key |
| T9 | Secrets in firmware/source | No hardcoded broker/keys in committed source; store the **device key in NVS/efuse**, provisioned at flash time; server secrets in Vercel/Supabase secret storage |
| T10 | Ingestion abuse / command flooding | The `/ingest` and `/commands` Edge Functions **rate-limit per device** and reject malformed/oversized bodies; RLS limits who can insert commands; the device ignores malformed payloads |

## 3. Identity & auth
- **Device identity:** each chair has a unique `device_id` + a **per-device key**, registered in
  `wheelchairs` and stored server-side. The device signs every `/ingest` and reads/acks only its
  own `commands`. Provision the key at flash time (never committed).
- **User identity:** Supabase Auth JWT with a `role` claim (`rider` / `operator`). RLS enforces
  scope on every table; operator-only for command inserts, fleet reads, OTA, geofence.
- **Command authenticity:** server includes an HMAC-SHA256 (device key) with each command; the
  device verifies before acting.

## 4. OTA security (Feature 12)
1. Build → compute SHA-256 → sign with the project private key.
2. The OTA command/manifest carries `{ url, version, sha256, signature }` over HTTPS.
3. Device downloads, recomputes SHA-256, verifies the signature against the **embedded public key**,
   checks `version > current`, flashes the inactive OTA partition, reboots, reports the new version.
4. Any check fails → abort, stay on current firmware, emit `OTA_FAIL`.
5. Never OTA during active motion (defer to LOCKED/IDLE).

## 5. Fail-safe defaults
- Unknown/expired/unknown-payment state → **LOCKED** (never default-open).
- Loss of connectivity → device honors its last known session end, then locks.
- Safety interlocks (fall, over-temp) **cannot** be overridden by any commercial command.
- The physical master switch is an absolute hardware cutoff, independent of software.

## 6. Logging & audit
- Every operator command, lock/unlock, payment, and safety event is logged with actor, timestamp,
  and `req_id`. Keep `events` and command history append-only for incident review.

## 7. Privacy
- Collect the minimum PII for rental + billing. Location history retained per a stated policy and
  access-controlled via RLS. Riders see only their own data; operators see fleet data.
