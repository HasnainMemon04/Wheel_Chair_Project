#include "actuators.h"
#include "sensors.h"
#include "network.h"
#include "config.h"

// Track relay states locally
static bool powerRelayState = false; // opposite default to trigger boot log
static bool motionRelayState = true;  // opposite default to trigger boot log

// Safety supervisor latches (file scope so applyActuatorStates can read them)
static bool overtempLatched = false;
static bool overtempReported = false;
static bool fallLatched = false;
static bool fallReported = false;
static int fallBreachTicks = 0;

// Manual SOS latches
static bool manualSOSLatched = false;
static bool manualSOSReported = false;

// Warnings and events latches
static bool tiltWarnLatched = false;
static bool geofenceExitLatched = false;
static int overspeedTicks = 0;

// Anti-tamper detection (SW-520D edge counting). Armed only while LOCKED.
// 3 disturbances => warning chirps; the 4th latches a continuous siren until
// an operator/rider sends CLEAR_TAMPER (or the chair is unlocked/rented).
static int  tamperWarnCount = 0;
static bool tamperAlarmLatched = false;
static bool tamperReported = false;
static bool tamperArmed = false;
static unsigned long lastTamperEventMs = 0;

void initActuators() {
    pinMode(RELAY_POWER_PIN, OUTPUT);
    pinMode(RELAY_MOTION_PIN, OUTPUT);
    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(STATUS_LED_PIN, OUTPUT);
    
    // Set default fail-safe state: Power ON, Motion LOCKED
    setPowerRelay(true);
    setMotionRelay(false);
    
    // Simple startup buzzes
    buzzerChirp(2, 80);
}

void setPowerRelay(bool on) {
    if (powerRelayState == on) return; // Don't write or log if already in this state
    powerRelayState = on;
    bool pinValue = on;
    if (RELAY_ACTIVE_LOW) {
        pinValue = !on;
    }
    digitalWrite(RELAY_POWER_PIN, pinValue ? HIGH : LOW);
    Serial.printf("[Relay] POWER set to %s (pin write)\n", on ? "ON" : "OFF");
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
    float tempMotor = sharedTelemetry.temp_motor;
    float tempBatt = sharedTelemetry.temp_battery;
    float tilt = sharedTelemetry.tilt;
    bool tiltSwActive = sharedTelemetry.tilt_switch_state;
    xSemaphoreGive(stateMutex);

    bool safetyInterlockActive = (overtempLatched || fallLatched || manualSOSLatched);

    if (safetyInterlockActive) {
        setPowerRelay(!overtempLatched);
        setMotionRelay(false);
    } else {
        setPowerRelay(power);
        if (power) {
            setMotionRelay(!locked);
        } else {
            setMotionRelay(false);
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
    resetTamperEdges();
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

        // Handle non-blocking buzzer warning beeps
        if (buzzerBeepTicks > 0) {
            buzzerBeepTicks--;
            buzzerWrite(true);
        }

        // Read shared state values
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        float tempMotor = sharedTelemetry.temp_motor;
        float tempBatt = sharedTelemetry.temp_battery;
        float tilt = sharedTelemetry.tilt;
        bool locked = sharedTelemetry.locked_state;
        bool power = sharedTelemetry.power_state;
        String state = sharedTelemetry.session_state;
        int timeLeft = sharedTelemetry.time_left_s;
        int speedLimit = sharedTelemetry.speed_limit_kmh;
        float speedGps = sharedTelemetry.gps_speed_kmh;
        bool tiltSwActive = sharedTelemetry.tilt_switch_state;
        bool insideGf = sharedTelemetry.gf.inside;
        float gfDist = sharedTelemetry.gf.dist_m;
        float gfRadius = sharedTelemetry.gf.radius_m;
        bool gfOn = sharedTelemetry.gf.on;
        xSemaphoreGive(stateMutex);

        // 1. OVERTEMP Interlock Check (Battery or Motor > 70 C)
        if (tempMotor > TEMP_HOT_C || tempBatt > TEMP_HOT_C) {
            if (!overtempLatched) {
                overtempLatched = true;
                Serial.printf("[Safety] OVERTEMP Breached! Motor: %.1f C, Batt: %.1f C\n", tempMotor, tempBatt);
            }
        }
        // Hysteresis release: Only clear when BOTH fall below (70 C - 8 C) = 62 C
        if (overtempLatched) {
            if (tempMotor < (TEMP_HOT_C - TEMP_HYSTERESIS_C) && tempBatt < (TEMP_HOT_C - TEMP_HYSTERESIS_C)) {
                overtempLatched = false;
                overtempReported = false;
                Serial.println("[Safety] OVERTEMP Cleared. Hysteresis band reset.");
            }
        }

        // 2. FALL Interlock Check (MPU6050 angle > 50 deg OR digital tilt switch)
        bool fallBreached = false;
        if (tilt > TILT_FALL_DEG) {
            // MPU6050 primary tilt breach - standard 500ms (10 ticks) debounce
            fallBreachTicks++;
            if (fallBreachTicks >= 10) {
                fallBreached = true;
            }
        } else if (tiltSwActive) {
            // Digital switch breach alone - require longer confirmation (1.5 seconds = 30 ticks)
            fallBreachTicks++;
            if (fallBreachTicks >= 30) {
                fallBreached = true;
            }
        } else {
            fallBreachTicks = 0;
        }

        if (fallBreached) {
            if (!fallLatched) {
                fallLatched = true;
                Serial.printf("[Safety] FALL Breached! Tilt: %.1f deg, Switch: %d\n", tilt, tiltSwActive);
            }
        }

        // Auto-reset fall & manual SOS interlock if operator clears state (and device uprighted if fall occurred)
        bool canClearFall = !fallLatched || (tilt < TILT_WARN_DEG && !tiltSwActive);
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
            // Relays force fail-safe open states
            setPowerRelay(!overtempLatched);  // Complete power shutdown if overtemp
            setMotionRelay(false);            // Disables motion instantly
            buzzerWrite(true);                // Force continuous siren
            updateRGBLED(255, 0, 0);          // Red LED indicator
            
            state = "SAFE_FAULT";
            locked = true;

            // Report safety events to Supabase (non-blocking outside mutex)
            if (overtempLatched && !overtempReported) {
                overtempReported = true;
                reportSafetyEvent("OVERTEMP", "{\"temp_motor\":" + String(tempMotor) + ",\"temp_batt\":" + String(tempBatt) + "}");
            }
            if (fallLatched && !fallReported) {
                fallReported = true;
                reportSafetyEvent("FALL", "{\"tilt\":" + String(tilt) + ",\"switch\":" + String(tiltSwActive ? 1 : 0) + "}");
            }
            if (manualSOSLatched && !manualSOSReported) {
                manualSOSReported = true;
                reportSafetyEvent("SOS", "{\"manual\":1}");
            }
        } else {
            // Normal Operating Mode (No active interlocks)
            
            // Turn off continuous siren pin driving if not warning-beeping and
            // not in a latched tamper alarm.
            if (buzzerBeepTicks <= 0 && !tamperAlarmLatched) {
                buzzerWrite(false);
            }

            // Local 1-second timer tick (runs once per second = 20 ticks)
            bool tickSecond = (loopTicks % 20 == 0);

            // ---- Anti-tamper security (SW-520D), armed only while LOCKED ----
            // While the chair is locked, a burst of tilt-switch edges means
            // someone is moving/shaking it. Each burst counts as one disturbance:
            // the first few are warning chirps, the TAMPER_ALARM_AT-th latches a
            // continuous siren and reports a TAMPER event to the cloud.
            // Armed whenever the chair is locked/parked (independent of the motor
            // power relay — the ESP32 + buzzer run on aux power, so a locked chair
            // that was powered off is still guarded against theft/tampering).
            bool tamperArmedNow = (locked && state == "LOCKED");
            if (tamperArmedNow) {
                if (!tamperArmed) {
                    // Just armed — drop stale pre-lock edges so handing the chair
                    // over / locking it doesn't immediately trip the alarm.
                    tamperArmed = true;
                    resetTamperEdges();
                }
                unsigned long nowMs = millis();
                if (!tamperAlarmLatched &&
                    tamperRecentEdges(nowMs) >= TAMPER_EDGE_THRESHOLD &&
                    (nowMs - lastTamperEventMs) > TAMPER_REFRACTORY_MS) {
                    lastTamperEventMs = nowMs;
                    resetTamperEdges();          // consume this burst; count discrete events
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
                // Disarmed (unlocked / rented / powered off) — stand down and reset.
                if (tamperArmed) resetTamperEdges();
                tamperArmed = false;
                tamperWarnCount = 0;
                tamperAlarmLatched = false;
                tamperReported = false;
            }

            // Overspeed interlock & warning check (Rider state only)
            if ((state == "ACTIVE" || state == "EXPIRING") && power && !locked) {
                if (speedGps > speedLimit) {
                    overspeedTicks++;
                    if (overspeedTicks >= 100) { // 5 seconds grace period
                        state = "LOCKED";
                        locked = true;
                        overspeedTicks = 0;
                        reportSafetyEvent("OVERSPEED", "{\"speed\":" + String(speedGps) + ",\"limit\":" + String(speedLimit) + "}");
                        Serial.println("[Safety] Sustained overspeed interlock triggered! Locked.");
                    } else {
                        // Rapid escalating buzzer warnings (100ms beep every 300ms)
                        if (loopTicks % 6 == 0) {
                            buzzerBeepTicks = 2; // 100ms chirp
                        }
                    }
                } else {
                    overspeedTicks = 0;
                }
            } else {
                overspeedTicks = 0;
            }

            // Tilt Warning checks (MPU6050 tilt > 30 deg but <= 50 deg)
            if (tilt > TILT_WARN_DEG && tilt <= TILT_FALL_DEG) {
                // Flash yellow status LED
                if ((loopTicks / 5) % 2 == 0) {
                    updateRGBLED(255, 120, 0);
                } else {
                    updateRGBLED(0, 0, 0);
                }
                // warning beep (50ms every 1 second)
                if (tickSecond) {
                    buzzerBeepTicks = 1;
                    if (!tiltWarnLatched) {
                        tiltWarnLatched = true;
                        reportSafetyEvent("TILT_WARN", "{\"tilt\":" + String(tilt) + "}");
                    }
                }
            } else if (tilt < TILT_WARN_DEG - 3.0f) {
                // Clear warning latch with small hysteresis buffer
                tiltWarnLatched = false;
            }

            // Geofence enforcement locally
            if (gfOn && !insideGf) {
                if (!geofenceExitLatched) {
                    geofenceExitLatched = true;
                    reportSafetyEvent("GEOFENCE_EXIT", "{\"dist\":" + String(gfDist) + ",\"radius\":" + String(gfRadius) + "}");
                    Serial.println("[Safety] GEOFENCE_EXIT! Restricting speed limit to 2 km/h.");
                }
                speedLimit = 2; // Restrict speed limit
            } else if (insideGf && geofenceExitLatched) {
                geofenceExitLatched = false;
                reportSafetyEvent("GEOFENCE_ENTER", "{}");
                Serial.println("[Safety] GEOFENCE_ENTER. Speed limit restrictions lifted.");
            }

            // Local timer countdown (runs once per second = 20 ticks)
            if (tickSecond && power && !locked) {
                if (state == "ACTIVE" || state == "EXPIRING") {
                    if (timeLeft > 0) {
                        timeLeft--;
                        
                        // Enter warning window locally (idempotent, won't override locked states)
                        if (timeLeft <= 120 && state == "ACTIVE") {
                            state = "EXPIRING";
                            Serial.println("[Session] Local countdown entered warning window (<= 120s).");
                        }
                        
                        if (timeLeft <= 0) {
                            state = "ENDING";
                            endingRampTicks = 0;
                            Serial.println("[Session] Local countdown ended. Ramping down speed.");
                        }
                    }
                }
            }

            // Deceleration speed ramp handling (5 seconds at 20Hz = 100 ticks)
            if (state == "ENDING") {
                endingRampTicks++;
                if (endingRampTicks >= 100) {
                    state = "LOCKED";
                    locked = true;
                    timeLeft = 0;
                    buzzerBeepTicks = 10; // Play 500ms locking tone
                    Serial.println("[Session] Speed ramp-down complete. Relays opened. LOCKED.");
                } else {
                    int virtualRampedLimit = (speedLimit * (100 - endingRampTicks)) / 100;
                    if (endingRampTicks % 20 == 0) {
                        Serial.printf("[Session] Decelerating... Target speed limit: %d km/h\n", virtualRampedLimit);
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

            // Save state updates back to shared data structures
            xSemaphoreTake(stateMutex, portMAX_DELAY);
            // If the database states were updated by a command in the middle of our 50ms tick,
            // we synchronize our local variables so we don't stomp them.
            if (sharedTelemetry.session_state != "SAFE_FAULT") {
                if (sharedTelemetry.power_state != power) {
                    power = sharedTelemetry.power_state;
                }
                if (sharedTelemetry.locked_state != locked) {
                    locked = sharedTelemetry.locked_state;
                }
                if (sharedTelemetry.session_state != state) {
                    state = sharedTelemetry.session_state;
                }
            }
            sharedTelemetry.session_state = state;
            sharedTelemetry.time_left_s = timeLeft;
            sharedTelemetry.locked_state = locked;
            sharedTelemetry.tamper_alarm = tamperAlarmLatched;
            sharedTelemetry.tamper_warn_count = tamperWarnCount;
            xSemaphoreGive(stateMutex);

            // Latched tamper alarm: continuous siren + fast red/blue LED flash.
            if (tamperAlarmLatched) {
                buzzerWrite(true);
                updateRGBLED((loopTicks / 3) % 2 == 0 ? 255 : 0, 0, (loopTicks / 3) % 2 == 0 ? 0 : 255);
            }

            // Reflect power and lock states on actuators
            if (power) {
                setPowerRelay(true);
                setMotionRelay(!locked);
                if (locked) {
                    if (!tamperAlarmLatched) updateRGBLED(0, 0, 255);
                } else if (state == "EXPIRING") {
                    // yellow flashing
                } else if (tilt <= TILT_WARN_DEG) {
                    updateRGBLED(0, 255, 0); // Green for Active/Unlocked
                }
            } else {
                setPowerRelay(false);
                setMotionRelay(false);
                updateRGBLED(0, 0, 0); // Off
            }
        }

        vTaskDelayUntil(&lastWakeTime, pdMS_TO_TICKS(50)); // 20 Hz
    }
}
