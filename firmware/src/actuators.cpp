#include "actuators.h"
#include "sensors.h"
#include "network.h"
#include "config.h"

// Track relay states locally
static bool motionRelayState = true;  // opposite default to trigger boot log

// Safety supervisor latches (file scope so applyActuatorStates can read them)
static bool overtempLatched = false;
static bool overtempReported = false;
static bool fallLatched = false;
static bool fallReported = false;
static int fallBreachTicks = 0;

// Sensor Fault latches
static bool sensorFaultLatched = false;
static bool sensorFaultReported = false;

// Manual SOS latches
static bool manualSOSLatched = false;
static bool manualSOSReported = false;

// Warnings and events latches
static bool tiltWarnLatched = false;
static bool geofenceExitLatched = false;

// Anti-tamper detection (SW-520D edge counting). Armed only while LOCKED.
// 3 disturbances => warning chirps; the 4th latches a continuous siren until
// an operator/rider sends CLEAR_TAMPER (or the chair is unlocked/rented).
static int  tamperWarnCount = 0;
static bool tamperAlarmLatched = false;
static bool tamperReported = false;
static bool tamperArmed = false;
static unsigned long lastTamperEventMs = 0;

void initActuators() {
    pinMode(RELAY_MOTION_PIN, OUTPUT);
    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(STATUS_LED_PIN, OUTPUT);
    
    // Set default fail-safe state: Motion LOCKED
    setMotionRelay(false);
    
    // Simple startup buzzes
    buzzerChirp(2, 80);
}


void setMotionRelay(bool allowMotion) {
    if (motionRelayState == allowMotion) return; // Don't write or log if already in this state
    motionRelayState = allowMotion;
    bool pinValue = allowMotion;
    if (RELAY_ACTIVE_LOW) {
        pinValue = !allowMotion;
    }
    digitalWrite(RELAY_MOTION_PIN, pinValue ? HIGH : LOW);
    Serial.printf("[Relay] MOTION set to %s (pin write)\n", allowMotion ? "ALLOW" : "LOCKED");
}

void buzzerWrite(bool on) {
    bool pinValue = on;
    if (BUZZER_ACTIVE_LOW) {
        pinValue = !on;
    }
    digitalWrite(BUZZER_PIN, pinValue ? HIGH : LOW);
}


void buzzerChirp(int count, int delayMs) {
    for (int i = 0; i < count; i++) {
        buzzerWrite(true);
        delay(delayMs);
        buzzerWrite(false);
        if (i < count - 1) {
            delay(delayMs);
        }
    }
}

void buzzerAlarm(bool active) {
    buzzerWrite(active);
}

void updateRGBLED(uint8_t r, uint8_t g, uint8_t b) {
    digitalWrite(STATUS_LED_PIN, (r > 0 || g > 0 || b > 0) ? HIGH : LOW);
}

// Immediate Actuation Trigger (called directly by processCommands on Core 0)
void applyActuatorStates() {
    xSemaphoreTake(stateMutex, portMAX_DELAY);
    bool power = sharedTelemetry.power_state;
    bool locked = sharedTelemetry.locked_state;
    float tempBatt = sharedTelemetry.temp_battery;
    float currentSpeed = sharedTelemetry.gps_speed_kmh;
    xSemaphoreGive(stateMutex);

    bool safetyInterlockActive = (overtempLatched || fallLatched || manualSOSLatched || sensorFaultLatched);

    if (safetyInterlockActive) {
        setMotionRelay(false);
    } else {
        // Safe-state interlock: Remote POWER OFF can only take effect if the chair is fully stopped (speed <= 0.1 km/h)
        // If speed > 0.1, we override and keep motion allowed (if unlocked) to prevent severe stop hazards.
        if (!power && currentSpeed > 0.1f) {
            setMotionRelay(!locked);
            Serial.println("[Safety] Remote POWER OFF ignored because the wheelchair is in motion!");
        } else {
            if (power) {
                setMotionRelay(!locked);
            } else {
                setMotionRelay(false);
            }
        }
    }
}


// Manual SOS API controls
void triggerManualSOS() {
    manualSOSLatched = true;
}

void clearManualSOS() {
    manualSOSLatched = false;
    manualSOSReported = false;
}

// Anti-tamper acknowledgement (CLEAR_TAMPER command from operator/rider).
// Silences the siren, resets the warning count, and re-arms cleanly.
void clearTamper() {
    tamperAlarmLatched = false;
    tamperWarnCount = 0;
    tamperReported = false;
    Serial.println("[Tamper] Cleared by operator/rider acknowledgment. Re-armed.");
}

// Safety Supervisor Task running at 20 Hz
void safetySupervisorTask(void *pvParameters) {
    TickType_t lastWakeTime = xTaskGetTickCount();
    Serial.println("[Tasks] Safety Supervisor Task started.");

    uint32_t loopTicks = 0;
    int buzzerBeepTicks = 0;
    int endingRampTicks = 0;

    while (true) {
        loopTicks++;

        // Handle non-blocking buzzer warning beeps decrement
        if (buzzerBeepTicks > 0) {
            buzzerBeepTicks--;
        }

        // Read shared state values
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        float tempBatt = sharedTelemetry.temp_battery;
        float tilt = sharedTelemetry.tilt;
        bool locked = sharedTelemetry.locked_state;
        bool power = sharedTelemetry.power_state;
        String state = sharedTelemetry.session_state;
        int timeLeft = sharedTelemetry.time_left_s;
        float speedGps = sharedTelemetry.gps_speed_kmh;
        bool gpsFix = sharedTelemetry.gps_fix;
        bool vibrationActive = sharedTelemetry.vibration_state;
        bool insideGf = sharedTelemetry.gf.inside;
        float gfDist = sharedTelemetry.gf.dist_m;
        float gfRadius = sharedTelemetry.gf.radius_m;
        bool gfOn = sharedTelemetry.gf.on;
        xSemaphoreGive(stateMutex);

        // Snapshot what this task observed. At the write-back boundary, only a
        // value changed by another task should override local state-machine work.
        const bool observedLocked = locked;
        const bool observedPower = power;
        const String observedState = state;
        const int observedTimeLeft = timeLeft;

        // 1. SENSOR FAULT Check (Battery probe missing or failed/disconnected)
        if (isnan(tempBatt)) {
            if (!sensorFaultLatched) {
                sensorFaultLatched = true;
                Serial.printf("[Safety] SENSOR FAULT! Batt: %.1f C\n", tempBatt);
                Serial.println("[Safety] Battery temperature probe NOT FOUND/DISCONNECTED — temperature is NOT monitored!");
            }
        }
        if (sensorFaultLatched) {
            if (!isnan(tempBatt)) {
                sensorFaultLatched = false;
                sensorFaultReported = false;
                Serial.println("[Safety] SENSOR FAULT Cleared. Sensor readings restored.");
            }
        }

        // 2. OVERTEMP Interlock Check (Battery > 70 C)
        // If there is a sensor fault, we treat it as a critical failure (handled by sensorFaultLatched above)
        // We only check temperature thresholds if the sensor readings are valid (not NaN).
        if (!isnan(tempBatt)) {
            if (tempBatt > TEMP_HOT_C) {
                if (!overtempLatched) {
                    overtempLatched = true;
                    Serial.printf("[Safety] OVERTEMP Breached! Batt: %.1f C\n", tempBatt);
                }
            }
            // Hysteresis release: Only clear when it falls below (70 C - 8 C) = 62 C
            if (overtempLatched) {
                if (tempBatt < (TEMP_HOT_C - TEMP_HYSTERESIS_C)) {
                    overtempLatched = false;
                    overtempReported = false;
                    Serial.println("[Safety] OVERTEMP Cleared. Hysteresis band reset.");
                }
            }
        }

        // 2. FALL Interlock Check (MPU6500 angle > 50 deg)
        bool fallBreached = false;
        if (tilt > TILT_FALL_DEG) {
            fallBreachTicks++;
            if (fallBreachTicks >= 10) {
                fallBreached = true;
            }
        } else {
            fallBreachTicks = 0;
        }

        if (fallBreached) {
            if (!fallLatched) {
                fallLatched = true;
                Serial.printf("[Safety] FALL Breached! Tilt: %.1f deg\n", tilt);
            }
        }

        // Auto-reset fall & manual SOS interlock if operator clears state (and device uprighted if fall occurred)
        bool canClearFall = !fallLatched || (tilt < TILT_WARN_DEG);
        if ((fallLatched || manualSOSLatched) && canClearFall) {
            // If operator sent LOCK or UNLOCK (meaning state transitioned away from SAFE_FAULT)
            if (state == "LOCKED" || state == "ACTIVE") {
                fallLatched = false;
                fallReported = false;
                manualSOSLatched = false;
                manualSOSReported = false;
                Serial.println("[Safety] Emergency latches cleared by operator acknowledgment.");
            }
        }

        // 3. Evaluate active safety interlock states
        bool safetyInterlockActive = (overtempLatched || fallLatched || manualSOSLatched);

        if (safetyInterlockActive) {
            state = "SAFE_FAULT";
            locked = true;

            // Report safety events to Supabase (non-blocking outside mutex)
            if (sensorFaultLatched && !sensorFaultReported) {
                sensorFaultReported = true;
                reportSafetyEvent("SENSOR_FAULT", "{\"error\":\"Battery temp probe disconnected\"}");
            }
            if (overtempLatched && !overtempReported) {
                overtempReported = true;
                reportSafetyEvent("OVERTEMP", "{\"temp_batt\":" + String(tempBatt) + "}");
            }
            if (fallLatched && !fallReported) {
                fallReported = true;
                reportSafetyEvent("FALL", "{\"tilt\":" + String(tilt) + "}");
            }
            if (manualSOSLatched && !manualSOSReported) {
                manualSOSReported = true;
                reportSafetyEvent("SOS", "{\"manual\":1}");
            }
        } else {
            // Normal Operating Mode (No active interlocks)
            
            // Local 1-second timer tick (runs once per second = 20 ticks)
            bool tickSecond = (loopTicks % 20 == 0);

            // ---- Anti-tamper security (MPU6500 accelerometer), armed only while LOCKED ----
            bool tamperArmedNow = (locked && state == "LOCKED");
            if (tamperArmedNow) {
                if (!tamperArmed) {
                    tamperArmed = true;
                }
                unsigned long nowMs = millis();
                bool imuTriggered = vibrationActive;

                if (!tamperAlarmLatched &&
                    imuTriggered &&
                    (nowMs - lastTamperEventMs) > TAMPER_REFRACTORY_MS) {
                    lastTamperEventMs = nowMs;
                    tamperWarnCount++;
                    if (tamperWarnCount >= TAMPER_ALARM_AT) {
                        tamperAlarmLatched = true;
                        if (!tamperReported) {
                            tamperReported = true;
                            reportSafetyEvent("TAMPER", "{\"count\":" + String(tamperWarnCount) + "}");
                        }
                        Serial.printf("[Tamper] ALARM! Disturbance %d — continuous siren. Awaiting CLEAR_TAMPER.\n", tamperWarnCount);
                    } else {
                        buzzerBeepTicks = 3;     // simple ~150ms warning chirp
                        Serial.printf("[Tamper] Warning %d/%d — locked chair disturbed.\n",
                                      tamperWarnCount, TAMPER_ALARM_AT - 1);
                    }
                }
            } else {
                tamperArmed = false;
                tamperWarnCount = 0;
                tamperAlarmLatched = false;
                tamperReported = false;
            }

            // Tilt Warning checks (MPU6050 tilt > 30 deg but <= 50 deg)
            if (!isnan(tilt) && tilt > TILT_WARN_DEG && tilt <= TILT_FALL_DEG) {
                if ((loopTicks / 5) % 2 == 0) {
                    updateRGBLED(255, 120, 0);
                } else {
                    updateRGBLED(0, 0, 0);
                }
                if (tickSecond) {
                    buzzerBeepTicks = 1;
                    if (!tiltWarnLatched) {
                        tiltWarnLatched = true;
                        reportSafetyEvent("TILT_WARN", "{\"tilt\":" + String(tilt) + "}");
                    }
                }
            } else if (isnan(tilt) || tilt < TILT_WARN_DEG - 3.0f) {
                tiltWarnLatched = false;
            }

            // Geofence enforcement locally
            if (gfOn && gpsFix && !insideGf) {
                if (!geofenceExitLatched) {
                    geofenceExitLatched = true;
                    reportSafetyEvent("GEOFENCE_EXIT", "{\"dist\":" + String(gfDist) + ",\"radius\":" + String(gfRadius) + "}");
                    Serial.println("[Safety] GEOFENCE_EXIT! Device is outside authorized boundary.");
                }
            } else if (gpsFix && insideGf && geofenceExitLatched) {
                geofenceExitLatched = false;
                reportSafetyEvent("GEOFENCE_ENTER", "{}");
                Serial.println("[Safety] GEOFENCE_ENTER. Returned to safety zone.");
            }

            // Time Limit Auto-Expiration check (Rider state only)
            if (state == "ACTIVE" || state == "EXPIRING" || state == "ENDING") {
                if (tickSecond) {
                    xSemaphoreTake(stateMutex, portMAX_DELAY);
                    if (sharedTelemetry.time_left_s > 0) {
                        sharedTelemetry.time_left_s--;
                    }
                    timeLeft = sharedTelemetry.time_left_s;
                    xSemaphoreGive(stateMutex);

                    if (timeLeft <= 0) {
                        if (state != "ENDING") {
                            state = "ENDING";
                            endingRampTicks = 0;
                        }
                    } else if (timeLeft <= EXPIRY_WARN_S && state == "ACTIVE") {
                        state = "EXPIRING";
                    }
                }

                if (state == "ENDING") {
                    if (endingRampTicks < 100) {
                        endingRampTicks++;
                    } else {
                        state = "LOCKED";
                        locked = true;
                    }
                    if (endingRampTicks % 20 == 0) {
                        Serial.printf("[Session] Decelerating... Ending session locks in progress\n");
                    }
                }
            }

            // Escalating warning chirps in EXPIRING state
            if (state == "EXPIRING" && tickSecond && timeLeft > 0) {
                bool shouldBeep = false;
                if (timeLeft > 60) {
                    shouldBeep = (timeLeft % 10 == 0);
                } else if (timeLeft > 30) {
                    shouldBeep = (timeLeft % 5 == 0);
                } else if (timeLeft > 10) {
                    shouldBeep = (timeLeft % 2 == 0);
                } else {
                    shouldBeep = true; // beep every second
                }

                if (shouldBeep) {
                    buzzerBeepTicks = 2; // 100ms warning beep
                }
            }
        }

        // 4. Save state updates back to shared data structures
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        
        // If a command arrived during this 50 ms tick, consume that newer shared
        // value. Comparing with the original snapshot preserves local transitions
        // such as ENDING -> LOCKED instead of restoring the older shared state.
        if (sharedTelemetry.session_state != "SAFE_FAULT" && !safetyInterlockActive) {
            if (sharedTelemetry.power_state != observedPower) {
                power = sharedTelemetry.power_state;
            }
            if (sharedTelemetry.locked_state != observedLocked) {
                locked = sharedTelemetry.locked_state;
            }
            if (sharedTelemetry.session_state != observedState) {
                state = sharedTelemetry.session_state;
                if (state == "ENDING" && observedState != "ENDING") {
                    endingRampTicks = 0;
                }
            }
            if (sharedTelemetry.time_left_s != observedTimeLeft) {
                timeLeft = sharedTelemetry.time_left_s;
            }
        }

        sharedTelemetry.session_state = state;
        sharedTelemetry.power_state = power;
        sharedTelemetry.locked_state = locked;
        sharedTelemetry.time_left_s = timeLeft;
        sharedTelemetry.tamper_alarm = tamperAlarmLatched;
        sharedTelemetry.tamper_warn_count = tamperWarnCount;
        xSemaphoreGive(stateMutex);

        // 5. Update physical actuators based on final resolved states
        if (safetyInterlockActive) {
            setMotionRelay(false);            // Disables motion instantly
            buzzerWrite(true);                // Force continuous siren
            updateRGBLED(255, 0, 0);          // Red LED indicator
        } else {
            // Latched tamper alarm: continuous siren + fast red/blue LED flash.
            if (tamperAlarmLatched) {
                buzzerWrite(true);
                updateRGBLED((loopTicks / 3) % 2 == 0 ? 255 : 0, 0, (loopTicks / 3) % 2 == 0 ? 0 : 255);
            } else {
                // Warning beep ticks
                if (buzzerBeepTicks > 0) {
                    buzzerWrite(true);
                } else {
                    buzzerWrite(false);
                }
                
                // LED state
                if (power) {
                    if (locked) {
                        updateRGBLED(0, 0, 255); // Solid Blue when Locked
                    } else if (state == "EXPIRING") {
                        updateRGBLED((loopTicks / 5) % 2 == 0 ? 255 : 0, (loopTicks / 5) % 2 == 0 ? 120 : 0, 0);
                    } else if (tilt <= TILT_WARN_DEG) {
                        updateRGBLED(0, 255, 0); // Solid Green when Active/Unlocked
                    }
                } else {
                    updateRGBLED(0, 0, 0); // Off
                }
            }

            // Reflect lock states on motion relay
            if (power) {
                setMotionRelay(!locked);
            } else {
                setMotionRelay(false);
            }
        }

        vTaskDelayUntil(&lastWakeTime, pdMS_TO_TICKS(50)); // 20 Hz
    }
}

bool isSafetyFaultActive() {
    return (overtempLatched || fallLatched || manualSOSLatched || sensorFaultLatched);
}

bool isOTASafetyFaultActive() {
    return (overtempLatched || fallLatched || manualSOSLatched);
}
