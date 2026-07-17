// ===========================================================================
//  config.h — single source of firmware configuration
//  Pins come from HARDWARE.md §2. Thresholds from FEATURES.md config table.
//  DO NOT commit real secrets — fill these at flash time / from a private header.
// ===========================================================================
#pragma once

// ------------------------- Identity -------------------------
#define DEVICE_ID          "WCHAIR-002"
#define FW_VERSION         "0.3.9"

// ------------------------- WiFi & Supabase Credentials -------
#if __has_include("private_config.h")
#include "private_config.h"
#else
#define WIFI_SSID          "wrong_ssid"
#define WIFI_PASS          "YaAllah406"
#define SUPABASE_URL       "https://YOUR-PROJECT.supabase.co"
#define DEVICE_KEY         "REPLACE_WITH_DEVICE_KEY"
#endif

#define INGEST_PATH        "/functions/v1/ingest"      // POST telemetry/events
#define COMMANDS_PATH      "/functions/v1/commands"    // POST ack; simulator also GETs pending
#define TELEMETRY_HZ       1
#define COMMAND_POLL_MS    400

// ------------------------- GPS (NEO-M8N, UART1) --------------
#define GPS_RX_PIN         18   // <- GPS TXD
#define GPS_TX_PIN         17   // -> GPS RXD
#define GPS_BAUD           9600

// ------------------------- I2C (MPU6500 6-Axis IMU) -----------
#define I2C_SDA_PIN        5
#define I2C_SCL_PIN        6
#define MPU6500_ADDR       0x68

// ------------------------- Temperature ----------------------
#define ONEWIRE_PIN        8    // Single DS18B20 motor temp sensor (waterproof probe)


// Anti-tamper (MPU6500) ------------
// Shock and vibration tamper detection. Armed only while the chair is LOCKED.
// A locked/parked chair is stationary; lifting/pushing produces linear
// acceleration and rotating/tilting it produces gyro rate — either crossing
// its threshold counts as one disturbance (same 3-warn / 4th-siren escalation).
#define TAMPER_REFRACTORY_MS     2500  // min gap between counted tamper events (longer refractory)
#define TAMPER_ALARM_AT          4     // 3 warning chirps, 4th => continuous siren
#define TAMPER_MPU_ACCEL_THRESH  4.5f  // m/s^2 deviation from 1g (~0.46g) = heavy shove/lift/shake (increased from 2.5)
#define TAMPER_MPU_GYRO_THRESH   45.0f // deg/s rotation rate = rapid tilting/turning the chair (increased from 30.0)

// ------------------------- Power sense ----------------------
#define BATT_ADC_PIN       1    // ADC1_CH0 (GPIO 1) — via divider
#define BATT_DIVIDER       2.0f

// ------------------------- Actuators ------------------------
#define RELAY_MOTION_PIN   13   // CH2 — motion lock
#define RELAY_ACTIVE_LOW   1    // most modules are active-low
#define BUZZER_PIN         11   // Piezo Buzzer
#define BUZZER_ACTIVE_LOW  0    // 0 = active-high, 1 = active-low
#define STATUS_LED_PIN     21   // Onboard status LED


// ------------------------- Thresholds (FEATURES.md) ---------
#define TEMP_HOT_C         55.0f
#define TEMP_HYSTERESIS_C  5.0f
#define TILT_WARN_DEG      30.0f
#define TILT_FALL_DEG      50.0f
#define GEOFENCE_RADIUS_M  300.0f
#define EXPIRY_WARN_S      120
#define OFFLINE_AFTER_S    30   // cloud marks device offline if no telemetry within this window
