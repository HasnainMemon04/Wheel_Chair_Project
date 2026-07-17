# Feature Specifications & Acceptance Criteria

Each feature lists: **inputs**, **behavior**, **outputs/actions**, and **acceptance criteria**
(testable "done" conditions). Thresholds are defaults in `config.h` — tune on the bench.

---

## F1 — Remote Power ON/OFF
- **Inputs:** `cmd: POWER_ON` / `POWER_OFF` from backend; physical master switch (hard cutoff).
- **Behavior:** sets relay **CH1** (main power line). Power-off forces motion off too.
- **Outputs:** relay CH1 state; `ack`; telemetry field `power`.
- **Acceptance:**
  - From the app, toggling power changes CH1 within 2 s and an `ack` returns.
  - Master physical switch always cuts power regardless of software state.
  - Telemetry reflects the new `power` state on the next cycle.

## F2 — Temperature Monitoring (Motor & Battery)
- **Inputs:** DS18B20 motor (`temp_motor`), DS18B20 battery (`temp_batt`), DHT22 ambient.
- **Behavior:** read at 0.5 Hz. Classify each: NORMAL / WARM / HOT. If `temp_motor` or
  `temp_batt` > **HOT threshold** (default 70 °C) → **over-temp interlock**: cut CH1 power,
  siren, `OVERTEMP` event. Auto-clear only when temp falls below a hysteresis band.
- **Outputs:** telemetry `temp_motor/temp_batt/temp_amb/humidity`; `OVERTEMP` event.
- **Ambient climate (DHT22):** the website surfaces `temp_amb` + `humidity` and derives dew
  point (Magnus-Tetens), heat index / "feels-like" (NOAA Rothfusz), and a comfort/hydration
  tip using the exact formulas from `hardware_test_lab/dht_test/dht_test.ino` (see
  `webapp/utils/climate.ts`), shown in the Ambient Climate card on the rider & operator views.
- **Acceptance:**
  - Both probes report distinct values addressed by ROM ID.
  - Heating a probe past threshold cuts power and raises an event within 3 s.
  - Power does not auto-restore until temp < (threshold − hysteresis).
  - The website shows live ambient temp/humidity with derived dew point, feels-like, and comfort.

## F4 — GPS Tracking & Geofencing
- **Inputs:** NEO-6M (lat, lng, speed, sats, HDOP); geofence config (center, radius) via `cmd`.
- **Behavior:** publish position at 1 Hz. On-device circular geofence (haversine) computed
  locally so it works if the link drops. Edge-detect ENTER/EXIT.
- **Outputs:** telemetry `lat/lng/speed/sats`; `GEOFENCE_EXIT` / `GEOFENCE_ENTER` events.
- **Acceptance:**
  - Web map shows live position + trail, updating ≤ 2 s.
  - Crossing the configured radius raises EXIT (and ENTER on return) once per crossing.
  - Geofence can be re-set live from the operator app and the device honors it.

## F5 — Speed Monitoring & Speed Limiting
- **Inputs:** GPS speed (km/h); `speed_limit` via `cmd` (default 6 km/h).
- **Behavior:** monitor speed at 1 Hz. Over-limit → escalating buzzer warning; sustained
  over-limit (> N s) → motion cutoff via CH2 (see HARDWARE.md gap — relay is on/off).
  Implement a ramp-down command path now so a real motor controller drops straight in.
- **Outputs:** telemetry `speed`, `over_speed` flag; `OVERSPEED` event.
- **Acceptance:**
  - Telemetry speed tracks GPS speed.
  - Exceeding the limit triggers a warning; sustained breach engages cutoff + event.
  - Limit is configurable per session from the backend.

## F7 — Internet Connectivity
- **Inputs:** WiFi SSID/pass (config or provisioning); Supabase URL + device key.
- **Behavior:** maintain WiFi + an HTTPS (TLS) client to Supabase with auto-reconnect +
  exponential backoff. Telemetry uploads act as a **heartbeat**; the cloud marks the device
  `offline` if no telemetry arrives within `OFFLINE_AFTER_S`. On reconnect the device re-reads
  its desired state (locked/speed_limit/geofence) + pending commands.
- **Outputs:** `online` flag on `device_state`; WiFi RSSI in telemetry.
- **Acceptance:**
  - Killing WiFi flips the device to offline in the app within the offline window.
  - On restore, it reconnects automatically and resumes uploads without a reflash.

## F9 — Gyroscope & Tilt Detection
- **Inputs:** MPU6050 (accel + gyro) @ 50 Hz; SW-520D as cheap backup.
- **Behavior:** compute tilt angle (complementary/Madgwick filter). If tilt > **TILT_WARN**
  (e.g. 30°) → warn; tilt > **TILT_FALL** (e.g. 50°) or free-fall signature → **fall interlock**:
  graceful motion cut, siren, `FALL` event, notify backend (operator alert).
- **Outputs:** telemetry `pitch/roll/tilt`; `TILT_WARN` / `FALL` events.
- **Acceptance:**
  - Tilting the unit past the warn angle raises a warning; past the fall angle cuts motion
    and raises a `FALL` event within 1 s.
  - SW-520D independently confirms a hard tip-over (redundancy).

## F10 — Tamper Detection
- **Inputs:** SW-520D tilt switch (GPIO 14, edge counting), relay/lock/session state.
- **Behavior:** **armed only when LOCKED.** The SW-520D interrupt records tilt-switch edges;
  a single bump makes 1-2 edges (ignored), while real handling/shaking of the parked chair
  makes a burst (`TAMPER_EDGE_THRESHOLD` edges within `TAMPER_EDGE_WINDOW_MS`) that counts as
  one disturbance. The first 3 disturbances each sound a short **warning chirp**; the **4th**
  (`TAMPER_ALARM_AT`) latches a **continuous siren**, reports a `TAMPER` event, and raises the
  alarm overlay on the website. The alarm clears on `CLEAR_TAMPER` (operator/rider "Silence
  Alarm & Re-arm") or automatically when the chair is unlocked/rented. Logic is ported from
  `hardware_test_lab/tamper_detection_sw520d.ino`.
- **Outputs:** `tamper` + `tamper_count` telemetry; `TAMPER` event; buzzer siren; website
  alarm overlay with turn-off control.
- **Acceptance:**
  - While LOCKED, shaking/moving the chair chirps 3 warnings, then sirens continuously on the
    4th and shows the operator/rider a dismissible alarm.
  - While ACTIVE (rented), normal use does **not** trigger tamper.

## F12 — OTA Firmware/Software Updates
- **Inputs:** `cmd: OTA {url, version, sha256, signature}`; or hourly version check.
- **Behavior:** download firmware over HTTPS, verify SHA-256 + signature (SECURITY.md),
  flash to the OTA partition, reboot, report new version. Refuse unsigned/older builds.
  Never OTA while a rider is ACTIVE and moving (defer to LOCKED/IDLE).
- **Outputs:** `OTA_PROGRESS` / `OTA_DONE` / `OTA_FAIL` events; `fw_version` in telemetry.
- **Acceptance:**
  - Operator pushes a new signed build; device updates and reports the new version.
  - A tampered/unsigned binary is rejected and the device stays on the old firmware.
  - OTA is blocked during active motion.

## F13 — Rental Session Control
- **Inputs:** session start (paid), session timer, payment events, motion status, `cmd` lock/unlock.
- **Behavior:** full state machine in **RENTAL.md**. Summary: pay → UNLOCK + start timer;
  near expiry → warn (buzzer + app); expiry → graceful stop → LOCK; reactivate only on new
  payment or authorized operator unlock.
- **Outputs:** telemetry `session_state`, `time_left`; `EXPIRY_WARNING`, `SESSION_LOCKED` events.
- **Acceptance:**
  - Paying unlocks the chair (motion enabled) within 3 s of the payment webhook.
  - A configurable warning fires before expiry (buzzer + app banner).
  - At expiry the chair comes to a safe stop and locks; movement commands are refused.
  - Re-payment (or operator unlock) restores ACTIVE; nothing else does.

---

## Global config (defaults — put in `firmware/include/config.h` and backend settings)

| Key | Default | Meaning |
|-----|---------|---------|
| `SPEED_LIMIT_KMH` | 6 | per-session speed cap |
| `OVERSPEED_GRACE_S` | 5 | sustained over-limit before cutoff |
| `TEMP_HOT_C` | 70 | motor/battery over-temp cutoff |
| `TEMP_HYSTERESIS_C` | 8 | re-enable band |
| `TILT_WARN_DEG` | 30 | tilt warning |
| `TILT_FALL_DEG` | 50 | fall interlock |
| `GEOFENCE_RADIUS_M` | 300 | default rental zone radius |
| `EXPIRY_WARN_S` | 120 | warn this long before session end |
| `TELEMETRY_HZ` | 1 | publish rate |
| `OFFLINE_AFTER_S` | 30 | cloud marks device offline if no telemetry within this window |
