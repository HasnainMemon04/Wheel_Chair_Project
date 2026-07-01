// ===========================================================================
//  config.h — single source of firmware configuration
//  Pins come from HARDWARE.md §2. Thresholds from FEATURES.md config table.
//  DO NOT commit real secrets — fill these at flash time / from a private header.
// ===========================================================================
#pragma once

// ------------------------- Identity -------------------------
#define DEVICE_ID          "WCHAIR-001"
#define FW_VERSION         "0.1.0"

// ------------------------- WiFi & Supabase Credentials -------
#if __has_include("private_config.h")
#include "private_config.h"
#else
#define WIFI_SSID          "ZettaMight"
#define WIFI_PASS          "YaAllah406"
#define SUPABASE_URL       "https://YOUR-PROJECT.supabase.co"
#define DEVICE_KEY         "REPLACE_WITH_DEVICE_KEY"
#endif

#define INGEST_PATH        "/functions/v1/ingest"      // POST telemetry/events
#define COMMANDS_PATH      "/functions/v1/commands"    // GET pending, POST ack
#define TELEMETRY_HZ       1
#define COMMAND_POLL_MS    400

// ------------------------- GPS (NEO-6M, UART1) --------------
#define GPS_RX_PIN         16   // <- GPS TXD
#define GPS_TX_PIN         17   // -> GPS RXD (optional)
#define GPS_BAUD           9600

// ------------------------- I2C (MPU6050) --------------------
#define I2C_SDA_PIN        21
#define I2C_SCL_PIN        22
#define MPU6050_ADDR       0x68

// ------------------------- Temperature ----------------------
#define ONEWIRE_PIN        4    // DS18B20 motor + battery share this bus (ROM-addressed)
#define DHT_PIN            5
#define DHT_TYPE           DHT22

// ------------------------- Safety / tilt --------------------
#define TILT_SWITCH_PIN    14   // SW-520D (tilt detection + anti-tamper)

// ------------------------- Anti-tamper (SW-520D) ------------
// Edge-counting tamper detection, ported from the hardware_test_lab
// tamper_detection_sw520d.ino sketch. Armed only while the chair is LOCKED.
// A single bump makes 1-2 edges (ignored); real handling/shaking makes a
// burst of edges (the tilt ball keeps re-triggering) and counts as tamper.
#define TAMPER_EDGE_DEBOUNCE_MS  15    // filters pure electrical contact noise
#define TAMPER_EDGE_WINDOW_MS    700   // window edges are counted within
#define TAMPER_EDGE_THRESHOLD    4     // edges in the window => one tamper event
#define TAMPER_MAX_EDGE_BUFFER   20    // ring buffer size for edge timestamps
#define TAMPER_REFRACTORY_MS     1500  // min gap between counted tamper events
#define TAMPER_ALARM_AT          4     // 3 warning chirps, 4th => continuous siren

// Secondary tamper trigger via MPU6050 (works even if the SW-520D is faulty).
// A locked/parked chair is stationary; lifting/pushing produces linear
// acceleration and rotating/tilting it produces gyro rate — either crossing
// its threshold counts as one disturbance (same 3-warn / 4th-siren escalation).
#define TAMPER_MPU_ACCEL_THRESH  2.5f  // m/s^2 deviation from 1g (~0.25g) = shove/lift/shake
#define TAMPER_MPU_GYRO_THRESH   30.0f // deg/s rotation rate = tilting/turning the chair

// ------------------------- Power sense ----------------------
// TODO: Battery voltage sense is untested on bench
#define BATT_ADC_PIN       35   // ADC1 — via divider (INPUT ONLY)
#define BATT_DIVIDER       2.0f // multiply ADC voltage by this; calibrate w/ multimeter

// ------------------------- Actuators ------------------------
#define RELAY_POWER_PIN    25   // CH1 — main power (Feature 1 - untested)
#define RELAY_MOTION_PIN   26   // CH2 — motion lock (Features 5,13)
#define RELAY_ACTIVE_LOW   1    // most modules are active-low
#define BUZZER_PIN         13   // Piezo Buzzer Module
#define BUZZER_ACTIVE_LOW  0    // 0 = active-high (high drives buzzer), 1 = active-low
#define STATUS_LED_PIN     2    // Onboard status LED

// ------------------------- Thresholds (FEATURES.md) ---------
#define SPEED_LIMIT_KMH    6
#define OVERSPEED_GRACE_S  5
#define TEMP_HOT_C         70.0f
#define TEMP_HYSTERESIS_C  8.0f
#define TILT_WARN_DEG      30.0f
#define TILT_FALL_DEG      50.0f
#define GEOFENCE_RADIUS_M  300.0f
#define EXPIRY_WARN_S      120
#define OFFLINE_AFTER_S    30   // cloud marks device offline if no telemetry within this window
