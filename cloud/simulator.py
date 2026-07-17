import time
import hmac
import hashlib
import json
import math
import requests
import random
import sys
import threading

# Default configuration (can be overridden by command-line arguments)
SUPABASE_URL = "https://txqjevrhedgsjltnflmg.supabase.co"
INGEST_PATH = "/functions/v1/ingest"
COMMANDS_PATH = "/functions/v1/commands"
DEVICE_ID = "WCHAIR-001"
DEVICE_KEY = "super-secret-key-123"

if len(sys.argv) >= 3:
    SUPABASE_URL = sys.argv[1]
    DEVICE_KEY = sys.argv[2]
if len(sys.argv) >= 4:
    DEVICE_ID = sys.argv[3]

print("=================================================")
print(f"  Smart Wheelchair IoT Simulator (M6) Started   ")
print(f"  Device ID: {DEVICE_ID}")
print(f"  Target URL: {SUPABASE_URL.rstrip('/')}")
print("  Interactive commands available:")
print("    temp <c>     - Set motor temperature")
print("    tilt <deg>   - Set tilt angle")
print("    tamp         - Tamper/shake a LOCKED chair (SW-520D); 4th = siren")
print("    speed <kmh>  - Set speed limit override")
print("    gf <1/0>     - Toggle geofence inside/outside")
print("    clear        - Reset all sensors to normal")
print("=================================================")

# Simulation physical inputs (changed interactively)
sim_temp_motor = 38.5
sim_tilt = 1.0
sim_tamper_hit = False   # one-shot: a tamper disturbance (shake) just happened
sim_speed = 4.0
sim_gf_inside_mock = True

def stdin_thread():
    global sim_temp_motor, sim_tilt, sim_tamper_hit, sim_speed, sim_gf_inside_mock
    while True:
        try:
            line = sys.stdin.readline().strip()
            if not line:
                continue
            parts = line.split()
            cmd = parts[0].lower()
            if cmd == "temp" and len(parts) > 1:
                t = float(parts[1])
                sim_temp_motor = t
                print(f"[Sim Input] Set motor temp to {t}°C")
            elif cmd == "tilt" and len(parts) > 1:
                t = float(parts[1])
                sim_tilt = t
                print(f"[Sim Input] Set tilt to {t}°")
            elif cmd == "tamp":
                sim_tamper_hit = True
                print("[Sim Input] Tamper disturbance (only counts while LOCKED)")
            elif cmd == "speed" and len(parts) > 1:
                sim_speed = float(parts[1])
                print(f"[Sim Input] Set speed to {sim_speed} km/h")
            elif cmd == "gf" and len(parts) > 1:
                sim_gf_inside_mock = int(parts[1]) == 1
                print(f"[Sim Input] Set geofence inside state to {sim_gf_inside_mock}")
            elif cmd == "clear":
                sim_temp_motor = 38.5
                sim_tilt = 1.0
                sim_tamper_hit = False
                sim_speed = 4.0
                sim_gf_inside_mock = True
                print("[Sim Input] Reset all sensors to normal states.")
            else:
                print("[Sim Input] Unknown command. Use: temp <val>, tilt <val>, tamp, speed <val>, gf <val>, clear")
        except Exception as e:
            print(f"Error reading input: {e}")

# Start interactive background thread
t_in = threading.Thread(target=stdin_thread, daemon=True)
t_in.start()

# Shared state registers
sim_power = 1
sim_locked = 1
sim_session_state = "LOCKED"
sim_speed_limit = 6
sim_geofence_r = 300
sim_time_left = 0
sim_ending_ticks = 0

# Safety Latches
overtemp_latched = False
overtemp_reported = False
fall_latched = False
fall_reported = False
fall_breach_ticks = 0

# Warning & Event Latches
tilt_warn_latched = False
geofence_exit_latched = False
overspeed_ticks = 0

# Anti-tamper (SW-520D), mirrors firmware: armed while LOCKED. 3 warning chirps,
# the 4th disturbance latches a continuous siren until CLEAR_TAMPER.
TAMPER_ALARM_AT = 4
tamper_warn_count = 0
tamper_alarm_latched = False
tamper_event_reported = False

def calculate_hmac(payload: str, key: str) -> str:
    return hmac.new(key.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()

def check_fall_latch():
    """FALL interlock sampling. Called every 500ms (twice per main-loop second)
    so the latch window is time-equivalent to the firmware's 500ms sustained
    breach debounce (actuators.cpp: 20Hz x 10 ticks). The old 1Hz check could
    take up to a full second — 2x the hardware window — hiding regressions."""
    global fall_breach_ticks, fall_latched
    if sim_tilt > 50.0:
        fall_breach_ticks += 1
        if fall_breach_ticks >= 1 and not fall_latched:  # 1 x 500ms sample = 500ms
            fall_latched = True
            print(f"[Safety] FALL Breached! Tilt: {sim_tilt}°")
    else:
        fall_breach_ticks = 0

def report_safety_event(event_type: str, detail_dict: dict):
    event_payload = {
        "kind": "event",
        "id": DEVICE_ID,
        "ts": int(time.time()),
        "event": event_type,
        "lat": 24.860731,
        "lng": 67.001142,
        "detail": detail_dict
    }
    
    body_str = json.dumps(event_payload)
    sig = calculate_hmac(body_str, DEVICE_KEY)
    
    headers = {
        "Content-Type": "application/json",
        "x-device-id": DEVICE_ID,
        "x-device-signature": sig
    }
    
    url = f"{SUPABASE_URL.rstrip('/')}{INGEST_PATH}"
    try:
        res = requests.post(url, data=body_str, headers=headers, timeout=3)
        print(f"[Event Report] Uploaded event: {event_type}. Response: {res.status_code}")
    except Exception as e:
        print(f"[Event Report] Connection error: {e}")

def poll_and_execute_commands():
    global sim_power, sim_locked, sim_session_state, sim_speed_limit, sim_geofence_r, sim_time_left, sim_ending_ticks
    global tamper_warn_count, tamper_alarm_latched, tamper_event_reported
    
    query = f"device={DEVICE_ID}&status=pending"
    sig = calculate_hmac(query, DEVICE_KEY)
    
    headers = {
        "x-device-id": DEVICE_ID,
        "x-device-signature": sig
    }
    
    poll_url = f"{SUPABASE_URL.rstrip('/')}{COMMANDS_PATH}?{query}"
    
    try:
        res = requests.get(poll_url, headers=headers, timeout=3)
        if res.status_code == 200:
            commands = res.json()
            commands.sort(key=lambda item: 0 if item.get("cmd") == "UNLOCK" else 1 if item.get("cmd") in ("SET_SPEED_LIMIT", "SET_GEOFENCE") else 2)
            for cmd_obj in commands:
                cmd_id = cmd_obj.get("id")
                cmd = cmd_obj.get("cmd")
                req_id = cmd_obj.get("req_id")
                args = cmd_obj.get("args") or {}
                
                print(f"[Command] Received: {cmd}")
                
                # Command validation under active SAFE_FAULT hazards
                hazard_active = (sim_temp_motor > 70.0 or sim_tilt > 50.0)
                is_safe_fault = (sim_session_state == "SAFE_FAULT")
                
                ok = False
                session_start_ts = None
                session_end_ts = None
                if cmd == "POWER_ON":
                    if is_safe_fault and hazard_active:
                        print("[Command] Rejected POWER_ON: Safety hazard is still active!")
                        ok = False
                    else:
                        sim_power = 1
                        if is_safe_fault:
                            sim_session_state = "LOCKED"
                        ok = True
                elif cmd == "POWER_OFF":
                    sim_power = 0
                    sim_locked = 1
                    sim_session_state = "LOCKED"
                    ok = True
                elif cmd == "LOCK":
                    sim_locked = 1
                    sim_session_state = "LOCKED"
                    ok = True
                elif cmd == "UNLOCK":
                    if is_safe_fault and hazard_active:
                        print("[Command] Rejected UNLOCK: Safety hazard is still active!")
                        ok = False
                    else:
                        sim_locked = 0
                        sim_session_state = "ACTIVE"
                        sim_time_left = args.get("duration_s", 1200)
                        session_start_ts = int(time.time())
                        ok = True
                elif cmd == "WARN_EXPIRY":
                    if sim_session_state == "ACTIVE":
                        sim_session_state = "EXPIRING"
                        sim_time_left = args.get("time_left", 120)
                    ok = True
                elif cmd == "END_SESSION":
                    if sim_session_state in ("ACTIVE", "EXPIRING", "ENDING"):
                        sim_session_state = "ENDING"
                        sim_time_left = 0
                        sim_ending_ticks = 0
                        session_end_ts = int(time.time())
                    ok = True
                elif cmd == "CLEAR_TAMPER":
                    tamper_alarm_latched = False
                    tamper_warn_count = 0
                    tamper_event_reported = False
                    print("[Tamper] Cleared by operator/rider. Re-armed.")
                    ok = True
                elif cmd == "SET_SPEED_LIMIT":
                    if sim_session_state not in ("ACTIVE", "EXPIRING"):
                        print("[Command] Rejected SET_SPEED_LIMIT: no active device session.")
                        ok = False
                    else:
                        sim_speed_limit = args.get("kmh", 6)
                        ok = True
                elif cmd == "SET_GEOFENCE":
                    if sim_session_state not in ("ACTIVE", "EXPIRING"):
                        print("[Command] Rejected SET_GEOFENCE: no active device session.")
                        ok = False
                    else:
                        sim_geofence_r = args.get("radius", 300)
                        ok = True
                elif cmd == "PING":
                    ok = True
                
                # Send Ack
                ack_payload = {
                    "id": cmd_id,
                    "req_id": req_id,
                    "ok": ok,
                    "state": {
                        "power": sim_power == 1,
                        "locked": sim_locked == 1,
                        "speed_limit": sim_speed_limit,
                        "session_state": sim_session_state
                    }
                }
                if session_start_ts is not None:
                    ack_payload["session_start_ts"] = session_start_ts
                if session_end_ts is not None:
                    ack_payload["session_end_ts"] = session_end_ts
                
                ack_str = json.dumps(ack_payload)
                ack_sig = calculate_hmac(ack_str, DEVICE_KEY)
                
                ack_headers = {
                    "Content-Type": "application/json",
                    "x-device-id": DEVICE_ID,
                    "x-device-signature": ack_sig
                }
                
                ack_url = f"{SUPABASE_URL.rstrip('/')}{COMMANDS_PATH}/ack"
                requests.post(ack_url, data=ack_str, headers=ack_headers, timeout=3)
        else:
            print(f"[Command] Poll error: {res.status_code}")
    except Exception as e:
        print(f"[Command] Poll connection error: {e}")

uptime = 0
try:
    while True:
        loop_time = int(time.time())
        
        # 1. Poll and execute commands
        poll_and_execute_commands()

        # 2. OVERTEMP Interlock (Hysteresis check)
        if sim_temp_motor > 70.0:
            if not overtemp_latched:
                overtemp_latched = True
                print(f"[Safety] OVERTEMP Breached! Temp: {sim_temp_motor}°C")
        if overtemp_latched:
            if sim_temp_motor < 62.0: # 70 - 8 hysteresis
                overtemp_latched = False
                overtemp_reported = False
                print("[Safety] OVERTEMP Cleared. Hysteresis band reset.")

        # 3. FALL Interlock — sampled at 500ms cadence (here + mid-sleep below)
        # to match the firmware's 500ms sustained-breach window (M1).
        check_fall_latch()

        if fall_latched and sim_tilt < 30.0:
            if sim_session_state in ("LOCKED", "ACTIVE"):
                fall_latched = False
                fall_reported = False
                print("[Safety] FALL Latch cleared by operator acknowledgment.")

        # 4. Evaluate Safety Interlocks override
        safety_interlock_active = (overtemp_latched or fall_latched)

        if safety_interlock_active:
            sim_session_state = "SAFE_FAULT"
            sim_locked = 1
            print(f"[Safety] SAFE_FAULT Active! Power Relay: {not overtemp_latched}, Motion Relay: False (Siren Sounding)")
            
            # Send events to cloud once
            if overtemp_latched and not overtemp_reported:
                overtemp_reported = True
                report_safety_event("OVERTEMP", {"temp_motor": sim_temp_motor, "temp_batt": 33.8})
            if fall_latched and not fall_reported:
                fall_reported = True
                report_safety_event("FALL", {"tilt": sim_tilt})
        else:
            # 5. Normal Operation Supervisor (when no interlocks are active)

            # Anti-tamper (SW-520D edge burst), armed only while LOCKED.
            # Each `tamp` disturbance counts once: the first few chirp a warning,
            # the TAMPER_ALARM_AT-th latches a continuous siren + TAMPER event.
            if sim_session_state == "LOCKED":
                if sim_tamper_hit and not tamper_alarm_latched:
                    tamper_warn_count += 1
                    if tamper_warn_count >= TAMPER_ALARM_AT:
                        tamper_alarm_latched = True
                        if not tamper_event_reported:
                            tamper_event_reported = True
                            report_safety_event("TAMPER", {"count": tamper_warn_count})
                        print(f"[Tamper] ALARM! Disturbance {tamper_warn_count} — continuous siren. Awaiting CLEAR_TAMPER.")
                    else:
                        print(f"[Tamper] Warning {tamper_warn_count}/{TAMPER_ALARM_AT - 1} — locked chair disturbed (chirp).")

                if tamper_alarm_latched:
                    print("[Tamper] Siren sounding (blink red/blue LEDs). Send CLEAR_TAMPER to silence.")
            else:
                # Disarmed (unlocked / rented) — stand down and reset.
                tamper_warn_count = 0
                tamper_alarm_latched = False
                tamper_event_reported = False

            # Always consume the one-shot disturbance flag.
            sim_tamper_hit = False

            # Geofence local check
            current_speed_limit = sim_speed_limit
            if not sim_gf_inside_mock:
                if not geofence_exit_latched:
                    geofence_exit_latched = True
                    report_safety_event("GEOFENCE_EXIT", {"dist": 340, "radius": sim_geofence_r})
                    print("[Geofence] Restricting speed limit to 2 km/h.")
                current_speed_limit = 2
            else:
                if geofence_exit_latched:
                    geofence_exit_latched = False
                    report_safety_event("GEOFENCE_ENTER", {})
                    print("[Geofence] Re-entered geofence. Speed limits restored.")

            # Overspeed check
            if sim_session_state in ("ACTIVE", "EXPIRING") and sim_locked == 0:
                if sim_speed > current_speed_limit:
                    overspeed_ticks += 1
                    if overspeed_ticks >= 5: # 5 seconds grace period
                        sim_session_state = "LOCKED"
                        sim_locked = 1
                        overspeed_ticks = 0
                        report_safety_event("OVERSPEED", {"speed": sim_speed, "limit": current_speed_limit})
                        print("[Safety] Sustained overspeed interlock triggered! Locked.")
                    else:
                        print(f"[Safety] WARNING: Speeding ({sim_speed} > {current_speed_limit} km/h). Beep warning!")
                else:
                    overspeed_ticks = 0

            # Tilt warning check (30 to 50 deg)
            if 30.0 < sim_tilt <= 50.0:
                print(f"[Safety] WARNING: High tilt angle ({sim_tilt}°). Blinking amber status LED.")
                if not tilt_warn_latched:
                    tilt_warn_latched = True
                    report_safety_event("TILT_WARN", {"tilt": sim_tilt})
            elif sim_tilt < 27.0:
                tilt_warn_latched = False

            # Local timer countdown (runs once per second)
            if sim_power == 1 and sim_locked == 0:
                if sim_session_state in ("ACTIVE", "EXPIRING"):
                    if sim_time_left > 0:
                        sim_time_left -= 1
                        if sim_time_left <= 120 and sim_session_state == "ACTIVE":
                            sim_session_state = "EXPIRING"
                        if sim_time_left <= 0:
                            sim_session_state = "ENDING"
                            sim_ending_ticks = 0

            # Deceleration speed ramp
            if sim_session_state == "ENDING":
                sim_ending_ticks += 1
                if sim_ending_ticks >= 5:
                    sim_session_state = "LOCKED"
                    sim_locked = 1
                    sim_time_left = 0
                else:
                    virtual_speed = (current_speed_limit * (5 - sim_ending_ticks)) // 5
                    print(f"[Session] Decelerating virtual motors... Speed: {virtual_speed} km/h")

        # 6. Simulate physical sensors and upload telemetry
        if sim_locked == 0 and sim_power == 1 and sim_session_state != "ENDING" and not safety_interlock_active:
            # Random drift for normal telemetry if not set manually
            if sim_temp_motor == 38.5:
                motor_t = round(38.5 + 2.0 * math.sin(uptime / 10.0), 1)
            else:
                motor_t = sim_temp_motor
            if sim_tilt == 1.0:
                tilt_val = round(random.uniform(0.5, 1.2), 1)
            else:
                tilt_val = sim_tilt
            if sim_speed == 4.0:
                spd_val = round(4.0 + random.uniform(-0.4, 0.4), 1)
            else:
                spd_val = sim_speed
        else:
            motor_t = sim_temp_motor
            tilt_val = sim_tilt
            spd_val = 0.0

        # Construct telemetry packet
        payload = {
            "kind": "telemetry",
            "id": DEVICE_ID,
            "ts": int(time.time()),
            "fw": "0.1.0",
            "up": uptime,
            "fix": 1,
            "lat": 24.860731,
            "lng": 67.001142,
            "spd": spd_val,
            "sats": 10,
            "hdop": 1.0,
            "pitch": 0.0,
            "roll": 0.0,
            "tilt": tilt_val,
            "yaw": 180.0,
            "temp_motor": motor_t,
            "temp_batt": 33.8,
            "temp_amb": 25.0,
            "humidity": 63,
            "batt_v": 4.12,
            "batt_pct": 98,
            "in_motion": 1 if (spd_val > 0.1) else 0,
            "tamper": 1 if tamper_alarm_latched else 0,
            "tamper_count": tamper_warn_count,
            "rssi": -55,
            "power": sim_power,
            "locked": sim_locked,
            "session_state": sim_session_state,
            "time_left": sim_time_left,
            "speed_limit": sim_speed_limit,
            "over_speed": 1 if (spd_val > current_speed_limit) else 0,
            "gf": {
                "on": 1,
                "in": 1 if sim_gf_inside_mock else 0,
                "dist": 20 if sim_gf_inside_mock else 340,
                "r": sim_geofence_r
            }
        }
        
        # Serialize to JSON and sign
        body_str = json.dumps(payload)
        sig = calculate_hmac(body_str, DEVICE_KEY)
        
        headers = {
            "Content-Type": "application/json",
            "x-device-id": DEVICE_ID,
            "x-device-signature": sig
        }
        
        ingest_url = f"{SUPABASE_URL.rstrip('/')}{INGEST_PATH}"
        try:
            res = requests.post(ingest_url, data=body_str, headers=headers, timeout=3)
            print(f"[{uptime:04d}s] Telemetry uploaded. State: {sim_session_state}, Left: {sim_time_left}s, Temp: {motor_t}°C, Tilt: {tilt_val}°")
        except Exception as e:
            print(f"[{uptime:04d}s] Ingest connection error: {e}")
            
        uptime += 1
        # Split the 1s cycle so the FALL check samples at 500ms — time-equivalent
        # to the firmware's 500ms sustained-breach debounce (M1).
        time.sleep(0.5)
        check_fall_latch()
        time.sleep(0.5)

except KeyboardInterrupt:
    print("\nSimulator stopped by user.")
