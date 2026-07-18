#include "network.h"
#include "sensors.h"
#include "actuators.h"
#include "config.h"
#include "wifi_portal.h"
#include "ota.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>
#include <algorithm>
#include <vector>
#include <time.h>
#include "esp_sntp.h"

// Global connection state
bool wifiConnected = false;

// Active WiFi credentials (loaded from NVS, or config.h defaults, or the AP portal).
// These replace the compile-time WIFI_SSID/WIFI_PASS at runtime so the device can be
// re-provisioned in the field without reflashing.
static String activeSSID;
static String activePASS;

// Task handles for diagnostic high-water mark reporting
extern TaskHandle_t sensorPollTaskHandle;
extern TaskHandle_t tempTaskHandle;
extern TaskHandle_t gpsTaskHandle;
extern TaskHandle_t safetySupervisorTaskHandle;
extern TaskHandle_t networkTaskHandle;
extern TaskHandle_t uploadTelemetryTaskHandle;

// CPU Load tracking tick counters
extern volatile uint64_t idleTicksCore0;
extern volatile uint64_t idleTicksCore1;

// Shared Secure client and serialization mutex to prevent memory starvation
WiFiClientSecure secureClient;
HTTPClient httpClient; // Global reused HTTP client to enable keep-alive
SemaphoreHandle_t wifiClientMutex = NULL;

// Decoupled safety event queue structure.
// detailJson is 256 bytes: strncpy-truncating a JSON object would produce a
// bare string in the cloud's jsonb column (silent schema corruption), so
// reportSafetyEvent() also refuses to enqueue anything that would not fit.
struct SafetyEvent {
    char eventType[16];
    char detailJson[256];
};
QueueHandle_t safetyEventQueue = NULL;

// Cache of recently processed command IDs to deduplicate incoming backlogs
static std::vector<String> processedCmdIds;

// ---------------- Real wall-clock time via SNTP ----------------
// The device used to fabricate timestamps from uptime plus a hard-coded epoch offset, which
// corrupted latency metrics, event ordering, and drifted into the future.
// Now: SNTP syncs after WiFi connects (UTC), re-syncs hourly, and every
// timestamped upload is gated on timeIsSynced() — we NEVER send a made-up
// epoch. If not yet synced, `ts` is omitted and the ingest Edge Function
// stamps the row server-side with now().
static bool sntpConfigured = false;

static void configureSNTP() {
    if (sntpConfigured) return;
    sntpConfigured = true;
    // Re-sync every hour so long-running devices don't drift.
    sntp_set_sync_interval(3600 * 1000);
    configTime(0, 0, "pool.ntp.org", "time.nist.gov"); // UTC, no DST offset
    Serial.println("[Time] SNTP configured (UTC, pool.ntp.org, hourly re-sync).");
}

// Any epoch before 2023-01-01 means SNTP has not completed a sync yet.
static bool timeIsSynced() {
    return time(nullptr) > 1672531200;
}

// Local command representation for parsing
struct LocalCommand {
    String id;
    String cmd;
    String reqId;
    int duration_s;
    int time_left;
    float radius;
    double lat;
    double lng;
    bool use_current_location;
    String ota_url;
    String ota_version;
    size_t ota_size;
};

static int commandPriority(const String &cmd) {
    if (cmd == "UNLOCK") return 0;
    if (cmd == "SET_GEOFENCE") return 1;
    return 2;
}

// HMAC calculation using ESP32's mbedtls
String calculateHMAC(const String &payload, const String &key) {
    byte hmacResult[32];
    mbedtls_md_context_t ctx;
    mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;

    mbedtls_md_init(&ctx);
    mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 1);
    mbedtls_md_hmac_starts(&ctx, (const unsigned char*) key.c_str(), key.length());
    mbedtls_md_hmac_update(&ctx, (const unsigned char*) payload.c_str(), payload.length());
    mbedtls_md_hmac_finish(&ctx, hmacResult);
    mbedtls_md_free(&ctx);

    String hmacStr = "";
    for (int i = 0; i < 32; i++) {
        char str[3];
        sprintf(str, "%02x", hmacResult[i]);
        hmacStr += str;
    }
    return hmacStr;
}

void initNetwork() {
    Serial.println("[Network] Initializing WiFi...");
    WiFi.mode(WIFI_MODE_STA);
    WiFi.disconnect();

    // Reset the previous temporary network (Gemnet-BB) once, then load the
    // original configured network. The token prevents subsequent reboots from
    // overwriting credentials entered later through the provisioning portal.
    resetSavedWiFiCredsOnce("restore-config-default-2026-07-18");

    // Load WiFi credentials: NVS-saved first, else config.h defaults.
    bool haveSaved = loadSavedWiFiCreds(activeSSID, activePASS);
    Serial.printf("[Network] Using %s WiFi creds. SSID: %s\n",
                  haveSaved ? "saved (NVS)" : "default (config.h)", activeSSID.c_str());

    // Disable certificate verification to save ~30KB of heap
    secureClient.setInsecure();

    // Enable keep-alive on the global HTTP client
    httpClient.setReuse(true);

    // Create the mutex to serialize all HTTPS transactions
    wifiClientMutex = xSemaphoreCreateMutex();

    // Decoupled queue for safety supervisor / OTA events (non-blocking writes).
    // A complete OTA sends every major stage plus 5% download updates. Keep the
    // full timeline buffered while HTTPS uploads drain it on a weak connection.
    safetyEventQueue = xQueueCreate(64, sizeof(SafetyEvent));
}

// WiFi Monitor Task: connect with saved creds; after repeated failures open the
// AP config portal ("WheelchairSetup") to capture new creds, then retry forever.
void networkTask(void *pvParameters) {
    uint32_t backoffMs = 2000;
    const uint32_t maxBackoffMs = 60000;

    // How long to keep failing before we open the AP config portal.
    // Each connect attempt below waits up to 10s, so ~3 failed attempts ≈ 30s.
    const int failuresBeforePortal = 3;
    int consecutiveFailures = 0;

    Serial.println("[Tasks] WiFi Task started.");

    while (true) {
        if (WiFi.status() != WL_CONNECTED) {
            wifiConnected = false;
            Serial.printf("[Network] WiFi not connected. Connecting to SSID: %s...\n", activeSSID.c_str());
            WiFi.mode(WIFI_STA);
            // Override DNS with Google Public DNS (8.8.8.8, 8.8.4.4) to bypass broken local router DNS resolution
            WiFi.config(IPAddress(0, 0, 0, 0), IPAddress(0, 0, 0, 0), IPAddress(0, 0, 0, 0), IPAddress(8, 8, 8, 8), IPAddress(8, 8, 4, 4));
            WiFi.begin(activeSSID.c_str(), activePASS.c_str());

            // Wait up to 10s for connection
            int retries = 0;
            while (WiFi.status() != WL_CONNECTED && retries < 20) {
                vTaskDelay(pdMS_TO_TICKS(500));
                retries++;
            }

            if (WiFi.status() == WL_CONNECTED) {
                wifiConnected = true;
                backoffMs = 2000;            // Reset backoff
                consecutiveFailures = 0;     // Reset failure counter
                Serial.printf("[Network] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
                configureSNTP();             // Start real wall-clock sync (idempotent)
            } else {
                consecutiveFailures++;
                Serial.printf("[Network] Connection failed (%d/%d).\n",
                              consecutiveFailures, failuresBeforePortal);

                // After ~30s of failure, open the AP portal to re-provision.
                if (consecutiveFailures >= failuresBeforePortal) {
                    Serial.println("[Network] Repeated failures. Opening WiFi setup portal...");
                    Serial.println("[Network] Uploads paused; sensors & safety keep running.");

                    // Blocking portal: runs until the user submits new credentials.
                    // Sensors/safety tasks keep running on their own cores/tasks.
                    bool got = startConfigPortal(0);   // 0 = wait indefinitely

                    if (got) {
                        // Reload the freshly-saved credentials and try again immediately.
                        loadSavedWiFiCreds(activeSSID, activePASS);
                        Serial.printf("[Network] New creds loaded. Reconnecting to SSID: %s...\n",
                                      activeSSID.c_str());
                    }

                    consecutiveFailures = 0;
                    backoffMs = 2000;
                    // Loop straight back to a connect attempt with the new creds.
                } else {
                    Serial.printf("[Network] Backing off for %d ms...\n", backoffMs);
                    vTaskDelay(pdMS_TO_TICKS(backoffMs));
                    backoffMs = min(backoffMs * 2, maxBackoffMs);
                }
            }
        } else {
            wifiConnected = true;

            // Update RSSI in telemetry
            xSemaphoreTake(stateMutex, portMAX_DELAY);
            sharedTelemetry.wifi_rssi = WiFi.RSSI();
            xSemaphoreGive(stateMutex);

            vTaskDelay(pdMS_TO_TICKS(5000)); // Check link status every 5s
        }
    }
}

// Reusable HTTPS request performer (Keep-alive and single-client session reuse)
int performHTTPSRequest(const String &url, const String &method, const String &payload, const String &sig, String &responseBody) {
    if (!wifiConnected) return -1;

    int httpResponseCode = -1;

    if (xSemaphoreTake(wifiClientMutex, portMAX_DELAY) == pdTRUE) {
        bool isHttps = url.startsWith("https://");
        if (isHttps) {
            if (!secureClient.connected()) {
                Serial.printf("[TLS] Opening fresh TLS session. Free Heap: %d bytes\n", ESP.getFreeHeap());
            }
            httpClient.begin(secureClient, url);
        } else {
            WiFiClient plainClient;
            httpClient.begin(plainClient, url);
        }
        httpClient.setTimeout(5000); // 5-second read timeout to handle transient delays
        httpClient.addHeader("Content-Type", "application/json");
        httpClient.addHeader("x-device-id", DEVICE_ID);
        httpClient.addHeader("x-device-signature", sig);
        httpClient.addHeader("Connection", "keep-alive"); // Explicit keep-alive header

        if (method == "POST") {
            httpResponseCode = httpClient.POST(payload);
        } else {
            httpResponseCode = httpClient.GET();
        }

        if (httpResponseCode > 0) {
            responseBody = httpClient.getString();
        } else {
            Serial.printf("[Network] HTTPS %s failed: %s\n", method.c_str(), httpClient.errorToString(httpResponseCode).c_str());
            // Hard disconnect only on transport failures to allow fresh handshakes on reconnect
            httpClient.end();
            if (isHttps) {
                secureClient.stop();
            }
        }

        xSemaphoreGive(wifiClientMutex);
    }

    return httpResponseCode;
}

// Forward declaration of command execution engine
void processCommands(const String &jsonResponse);

// Synchronous Event Uploader (called internally by telemetry task)
void uploadSafetyEvent(const char* eventType, const char* detailJson) {
    JsonDocument doc;
    doc["kind"] = "event";
    doc["id"] = DEVICE_ID;

    xSemaphoreTake(stateMutex, portMAX_DELAY);
    double lat = sharedTelemetry.gps_lat;
    double lng = sharedTelemetry.gps_lng;
    uint32_t uptime = sharedTelemetry.uptime_s;
    xSemaphoreGive(stateMutex);

    // Real unix epoch only when SNTP has synced; otherwise omit ts and let
    // the ingest function stamp the row server-side with now().
    if (timeIsSynced()) {
        doc["ts"] = (uint32_t)time(nullptr);
    }
    doc["up"] = uptime; // uptime is useful context but is NOT a timestamp
    doc["event"] = eventType;
    doc["lat"] = lat;
    doc["lng"] = lng;

    JsonDocument detailDoc;
    DeserializationError err = deserializeJson(detailDoc, detailJson);
    if (!err) {
        doc["detail"] = detailDoc.as<JsonObject>();
    } else {
        doc["detail"] = detailJson;
    }

    String jsonPayload;
    serializeJson(doc, jsonPayload);
    String signature = calculateHMAC(jsonPayload, DEVICE_KEY);

    String url = String(SUPABASE_URL) + INGEST_PATH;
    String response;
    int code = performHTTPSRequest(url, "POST", jsonPayload, signature, response);
    if (code == 200) {
        Serial.printf("[Network] Successfully reported event: %s\n", eventType);
    } else {
        Serial.printf(
            "[Network] Event upload failed: %s | HTTP %d | Response: %.240s\n",
            eventType,
            code,
            response.c_str()
        );
    }
}

static void setJsonFloat(JsonDocument& doc, const char* key, float value) {
    if (isnan(value)) {
        doc[key] = JsonVariant();
    } else {
        doc[key] = value;
    }
}

// Ingestion Uploader Task (1 Hz)
void uploadTelemetryTask(void *pvParameters) {
    TickType_t lastWakeTime = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(1000 / TELEMETRY_HZ);

    Serial.println("[Tasks] Telemetry Upload Task started.");

    int lastUploadCode = -1;

    while (true) {
        if (wifiConnected && !isPortalActive()) {
            // Drain safety event queue first using our single-conn path
            SafetyEvent pendingEv;
            while (safetyEventQueue != NULL && xQueueReceive(safetyEventQueue, &pendingEv, 0) == pdTRUE) {
                uploadSafetyEvent(pendingEv.eventType, pendingEv.detailJson);
            }

            // 1. Copy shared state under lock
            TelemetryData localData;
            xSemaphoreTake(stateMutex, portMAX_DELAY);
            localData = sharedTelemetry;
            xSemaphoreGive(stateMutex);

            // 2. Serialize to JSON matching API.md §1
            JsonDocument doc;
            doc["kind"] = "telemetry";
            doc["id"] = DEVICE_ID;
            // Real unix epoch only when SNTP has synced; otherwise omit ts and
            // let the ingest function stamp the row server-side with now().
            if (timeIsSynced()) {
                doc["ts"] = (uint32_t)time(nullptr);
            }
            doc["fw"] = FW_VERSION;
            doc["up"] = localData.uptime_s; // uptime, NOT a timestamp
            doc["fix"] = localData.gps_fix ? 1 : 0;
            doc["gps_simulated"] = localData.gps_simulated ? 1 : 0;
            doc["lat"] = localData.gps_lat;
            doc["lng"] = localData.gps_lng;
            doc["spd"] = localData.gps_speed_kmh;
            doc["sats"] = localData.gps_sats;
            doc["hdop"] = localData.gps_hdop;
            doc["gps_fix"] = localData.gps_fix ? 1 : 0;
            setJsonFloat(doc, "gps_course", localData.gps_course_deg);
            setJsonFloat(doc, "gps_altitude", localData.gps_altitude_m);
            doc["gps_age_ms"] = localData.gps_last_data_ms > 0
                ? static_cast<int32_t>(millis() - localData.gps_last_data_ms)
                : -1;
            doc["gps_chars"] = localData.gps_chars_processed;
            doc["gps_sentences"] = localData.gps_sentences_valid;
            doc["gps_checksum_failures"] = localData.gps_checksum_failures;
            doc["gps_nmea_gga"] = localData.gps_nmea_gga;
            doc["gps_nmea_rmc"] = localData.gps_nmea_rmc;
            
            setJsonFloat(doc, "pitch", localData.pitch);
            setJsonFloat(doc, "roll", localData.roll);
            setJsonFloat(doc, "tilt", localData.tilt);
            setJsonFloat(doc, "yaw", localData.yaw);
            setJsonFloat(doc, "imu_accel_x", localData.imu_accel_x_g);
            setJsonFloat(doc, "imu_accel_y", localData.imu_accel_y_g);
            setJsonFloat(doc, "imu_accel_z", localData.imu_accel_z_g);
            setJsonFloat(doc, "imu_gyro_x", localData.imu_gyro_x_dps);
            setJsonFloat(doc, "imu_gyro_y", localData.imu_gyro_y_dps);
            setJsonFloat(doc, "imu_gyro_z", localData.imu_gyro_z_dps);
            doc["imu_age_ms"] = localData.imu_last_sample_ms > 0
                ? static_cast<int32_t>(millis() - localData.imu_last_sample_ms)
                : -1;
            setJsonFloat(doc, "temp_batt", localData.temp_battery);
            
            doc["batt_v"] = localData.batt_v;
            doc["batt_pct"] = localData.batt_pct;
            doc["in_motion"] = localData.in_motion ? 1 : 0;
            doc["tamper"] = localData.tamper_alarm ? 1 : 0;
            doc["tamper_count"] = localData.tamper_warn_count;
            doc["rssi"] = localData.wifi_rssi;
            doc["power"] = localData.power_state ? 1 : 0;
            doc["locked"] = localData.locked_state ? 1 : 0;
            doc["session_state"] = localData.session_state;
            doc["time_left"] = localData.time_left_s;
            doc["ota_status"] = localData.ota_status;
            doc["ota_progress"] = localData.ota_progress;
            doc["ota_last_error"] = localData.ota_last_error;

            JsonObject gfObj = doc["gf"].to<JsonObject>();
            gfObj["on"] = localData.gf.on ? 1 : 0;
            gfObj["in"] = localData.gf.inside ? 1 : 0;
            gfObj["dist"] = localData.gf.dist_m;
            gfObj["r"] = localData.gf.radius_m;
            gfObj["lat"] = localData.gf.center_lat;
            gfObj["lng"] = localData.gf.center_lng;

            String jsonPayload;
            serializeJson(doc, jsonPayload);

            // 3. Compute HMAC-SHA256 signature
            String signature = calculateHMAC(jsonPayload, DEVICE_KEY);

            // 4. HTTP POST request
            String url = String(SUPABASE_URL) + INGEST_PATH;
            String response;
            lastUploadCode = performHTTPSRequest(url, "POST", jsonPayload, signature, response);

            // 5. Parse and execute piggybacked commands from the telemetry response (near-instant execution)
            if (lastUploadCode == 200) {
                markFirmwareValid(); // Validate boot slot target on successful telemetry POST
                if (response.length() > 0) {
                    processCommands(response);
                }
            }

            // 6. CPU Load calculation using the idle hook counters
            static uint64_t lastIdle0 = 0;
            static uint64_t lastIdle1 = 0;
            uint64_t curIdle0 = idleTicksCore0;
            uint64_t curIdle1 = idleTicksCore1;
            uint64_t delta0 = curIdle0 - lastIdle0;
            uint64_t delta1 = curIdle1 - lastIdle1;
            lastIdle0 = curIdle0;
            lastIdle1 = curIdle1;

            // Period is 1000ms, tick rate is 1000Hz (1000 ticks/sec), configTICK_RATE_HZ = 1000
            int cpu0Load = 100 - (delta0 * 100 / 1000);
            int cpu1Load = 100 - (delta1 * 100 / 1000);
            if (cpu0Load < 0) cpu0Load = 0;
            if (cpu0Load > 100) cpu0Load = 100;
            if (cpu1Load < 0) cpu1Load = 0;
            if (cpu1Load > 100) cpu1Load = 100;

            // Fetch OTA stack diagnostics
            unsigned int otaDownW = 9999, otaSchedW = 9999, otaWatchW = 9999;
            getOTATaskHighWaterMarks(otaDownW, otaSchedW, otaWatchW);

            unsigned int safetyW = (safetySupervisorTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(safetySupervisorTaskHandle) : 9999;
            unsigned int pollW   = (sensorPollTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(sensorPollTaskHandle) : 9999;
            unsigned int gpsW    = (gpsTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(gpsTaskHandle) : 9999;
            unsigned int tempW   = (tempTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(tempTaskHandle) : 9999;
            unsigned int netW    = (networkTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(networkTaskHandle) : 9999;
            unsigned int telW    = (uploadTelemetryTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(uploadTelemetryTaskHandle) : 9999;

            Serial.printf("[Heartbeat] Version: %s | Uptime: %ds | Free Heap: %d bytes | RSSI: %d | Last HTTP: %d | GPS: %s\n",
                          FW_VERSION, localData.uptime_s, ESP.getFreeHeap(), localData.wifi_rssi, lastUploadCode,
                          localData.gps_fix ? "FIX" : "NO_FIX");
            Serial.printf("[Battery] Voltage: %.2fV | Percent: %d%%\n", localData.batt_v, localData.batt_pct);
            Serial.printf("[CPU Load] Core 0 (Net/IO): %d%% | Core 1 (App/RT): %d%%\n", cpu0Load, cpu1Load);
            Serial.printf("[Stack HighWater] SafetySup: %u | SensPoll: %u | GPS: %u | Temp: %u | Net: %u | Telemetry: %u | OTADown: %u | OTASched: %u | OTAWatch: %u (words)\n",
                          safetyW, pollW, gpsW, tempW, netW, telW, otaDownW, otaSchedW, otaWatchW);

            // Tamper diagnostic
            Serial.printf("[TamperDbg] state:%s locked:%d | vibration:%d | warns:%d alarm:%d\n",
                          localData.session_state.c_str(), localData.locked_state ? 1 : 0,
                          localData.vibration_state ? 1 : 0,
                          localData.tamper_warn_count, localData.tamper_alarm ? 1 : 0);
        }

        vTaskDelayUntil(&lastWakeTime, period);
    }
}

// Shared command execution and acknowledgement engine
void processCommands(const String &jsonResponse) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, jsonResponse);
    if (err) {
        return;
    }

    JsonArray arr;
    if (doc["commands"].is<JsonArray>()) {
        arr = doc["commands"].as<JsonArray>();
    } else if (doc.is<JsonArray>()) {
        arr = doc.as<JsonArray>();
    } else {
        return;
    }

    if (arr.size() == 0) return;

    std::vector<LocalCommand> pendingCmds;
    for (JsonObject cmdObj : arr) {
        String cmdId = cmdObj["id"].as<String>();

        // Deduplicate: check if this command ID has already been executed
        bool alreadyProcessed = false;
        for (const auto &id : processedCmdIds) {
            if (id == cmdId) {
                alreadyProcessed = true;
                break;
            }
        }
        if (alreadyProcessed) {
            continue; // Skip re-running duplicated command
        }

        LocalCommand lc;
        lc.id = cmdId;
        lc.cmd = cmdObj["cmd"].as<String>();
        lc.reqId = cmdObj["req_id"].as<String>();

        JsonObject args = cmdObj["args"].as<JsonObject>();
        lc.duration_s = args["duration_s"] | 1200;
        lc.time_left = args["time_left"] | 120;
        lc.radius = args["radius"] | GEOFENCE_RADIUS_M;
        lc.lat = args["lat"] | 24.860048;
        lc.lng = args["lng"] | 67.063734;
        lc.use_current_location = args["use_current_location"] | false;
        lc.ota_url = args["url"].as<String>();
        lc.ota_version = args["version"].as<String>();
        lc.ota_size = args["size"] | 0;

        pendingCmds.push_back(lc);
    }

    // Rental companion commands are only valid after a successful UNLOCK, so
    // process UNLOCK first even if the queue response arrives in DB order that
    // would otherwise apply speed/geofence while the device is still locked.
    std::stable_sort(pendingCmds.begin(), pendingCmds.end(), [](const LocalCommand &a, const LocalCommand &b) {
        return commandPriority(a.cmd) < commandPriority(b.cmd);
    });

    for (const auto &lc : pendingCmds) {
        String cmdId = lc.id;
        String cmd = lc.cmd;
        String reqId = lc.reqId;

        Serial.printf("[Network] Processing command: %s\n", cmd.c_str());

        // Cache the processed command ID to block duplicates on the next loop
        processedCmdIds.push_back(cmdId);
        if (processedCmdIds.size() > 20) {
            processedCmdIds.erase(processedCmdIds.begin());
        }

        bool ok = false;
        String commandError;
        uint32_t sessionStartTs = 0;
        uint32_t sessionEndTs = 0;

        xSemaphoreTake(stateMutex, portMAX_DELAY);
        float tempBatt = sharedTelemetry.temp_battery;
        float tilt = sharedTelemetry.tilt;

        bool hazardActive = (tempBatt > TEMP_HOT_C || tilt > TILT_FALL_DEG);
        bool isSafeFault = (sharedTelemetry.session_state == "SAFE_FAULT");

        if (cmd == "POWER_ON") {
            if (isSafeFault && hazardActive) {
                Serial.println("[Network] Rejected POWER_ON: Safety hazard still active!");
                ok = false;
            } else {
                sharedTelemetry.power_state = true;
                if (sharedTelemetry.session_state == "SAFE_FAULT") {
                    sharedTelemetry.session_state = "LOCKED";
                }
                ok = true;
            }
        } else if (cmd == "POWER_OFF") {
            sharedTelemetry.power_state = false;
            sharedTelemetry.locked_state = true;
            sharedTelemetry.session_state = "LOCKED";
            ok = true;
        } else if (cmd == "LOCK") {
            sharedTelemetry.locked_state = true;
            sharedTelemetry.session_state = "LOCKED";
            ok = true;
        } else if (cmd == "UNLOCK") {
            if (isSafeFault && hazardActive) {
                Serial.println("[Network] Rejected UNLOCK: Safety hazard still active!");
                ok = false;
            } else {
                sharedTelemetry.locked_state = false;
                sharedTelemetry.session_state = "ACTIVE";
                sharedTelemetry.time_left_s = lc.duration_s;
                if (timeIsSynced()) {
                    sessionStartTs = (uint32_t)time(nullptr);
                }
                ok = true;
            }
        } else if (cmd == "SOS") {
            sharedTelemetry.session_state = "SAFE_FAULT";
            sharedTelemetry.locked_state = true;
            triggerManualSOS();
            ok = true;
        } else if (cmd == "CLEAR_SOS") {
            sharedTelemetry.session_state = "LOCKED";
            sharedTelemetry.locked_state = true;
            clearManualSOS();
            ok = true;
        } else if (cmd == "CLEAR_TAMPER") {
            // Acknowledge and silence the anti-tamper alarm; chair stays LOCKED.
            sharedTelemetry.tamper_alarm = false;
            sharedTelemetry.tamper_warn_count = 0;
            clearTamper();
            ok = true;
        } else if (cmd == "DIAGNOSTIC_RUN") {
            const TelemetryData diagnostic = sharedTelemetry;
            const bool imuConnected = mpuOK && diagnostic.imu_last_sample_ms > 0;
            const int32_t gpsAgeMs = diagnostic.gps_last_data_ms > 0
                ? static_cast<int32_t>(millis() - diagnostic.gps_last_data_ms)
                : -1;
            const int32_t imuAgeMs = diagnostic.imu_last_sample_ms > 0
                ? static_cast<int32_t>(millis() - diagnostic.imu_last_sample_ms)
                : -1;
            const bool gpsConnected = gpsAgeMs >= 0 && gpsAgeMs <= 3000;

            // Release the state lock before JSON allocation and HTTPS upload.
            xSemaphoreGive(stateMutex);

            JsonDocument detailDoc;
            detailDoc["schema_version"] = 4;
            detailDoc["source"] = "esp32s3";
            detailDoc["captured_uptime_s"] = diagnostic.uptime_s;
            detailDoc["imu_status"] = imuConnected ? "OK" : "FAIL";
            detailDoc["gps_status"] = !gpsConnected ? "NO_DATA" : (diagnostic.gps_fix ? "FIX" : "NO_FIX");
            detailDoc["gps_sats"] = diagnostic.gps_sats;
            if (isnan(diagnostic.gps_hdop)) detailDoc["gps_hdop"] = nullptr;
            else detailDoc["gps_hdop"] = diagnostic.gps_hdop;

            JsonObject gpsDetail = detailDoc["gps"].to<JsonObject>();
            gpsDetail["model"] = "NEO-M8N";
            gpsDetail["connected"] = gpsConnected;
            gpsDetail["fix"] = diagnostic.gps_fix;
            gpsDetail["source"] = "neo_m8n";
            gpsDetail["data_age_ms"] = gpsAgeMs;
            gpsDetail["satellites"] = diagnostic.gps_sats;
            gpsDetail["chars_processed"] = diagnostic.gps_chars_processed;
            gpsDetail["sentences_valid"] = diagnostic.gps_sentences_valid;
            gpsDetail["checksum_failures"] = diagnostic.gps_checksum_failures;
            if (isnan(diagnostic.gps_physical_lat)) gpsDetail["latitude"] = nullptr;
            else gpsDetail["latitude"] = diagnostic.gps_physical_lat;
            if (isnan(diagnostic.gps_physical_lng)) gpsDetail["longitude"] = nullptr;
            else gpsDetail["longitude"] = diagnostic.gps_physical_lng;
            gpsDetail["speed_kmh"] = diagnostic.gps_physical_speed_kmh;
            if (isnan(diagnostic.gps_hdop)) gpsDetail["hdop"] = nullptr;
            else gpsDetail["hdop"] = diagnostic.gps_hdop;
            if (isnan(diagnostic.gps_physical_course_deg)) gpsDetail["course_deg"] = nullptr;
            else gpsDetail["course_deg"] = diagnostic.gps_physical_course_deg;
            if (isnan(diagnostic.gps_physical_altitude_m)) gpsDetail["altitude_m"] = nullptr;
            else gpsDetail["altitude_m"] = diagnostic.gps_physical_altitude_m;

            JsonArray nmeaDetail = gpsDetail["nmea"].to<JsonArray>();
            if (diagnostic.gps_nmea_gga[0] != '\0') nmeaDetail.add(diagnostic.gps_nmea_gga);
            if (diagnostic.gps_nmea_rmc[0] != '\0') nmeaDetail.add(diagnostic.gps_nmea_rmc);

            JsonObject imuDetail = detailDoc["imu"].to<JsonObject>();
            imuDetail["model"] = "MPU6500";
            imuDetail["connected"] = imuConnected;
            imuDetail["data_age_ms"] = imuAgeMs;
            imuDetail["motion"] = diagnostic.vibration_state;

            JsonObject accelDetail = imuDetail["accel_g"].to<JsonObject>();
            if (isnan(diagnostic.imu_accel_x_g)) accelDetail["x"] = nullptr;
            else accelDetail["x"] = diagnostic.imu_accel_x_g;
            if (isnan(diagnostic.imu_accel_y_g)) accelDetail["y"] = nullptr;
            else accelDetail["y"] = diagnostic.imu_accel_y_g;
            if (isnan(diagnostic.imu_accel_z_g)) accelDetail["z"] = nullptr;
            else accelDetail["z"] = diagnostic.imu_accel_z_g;

            JsonObject gyroDetail = imuDetail["gyro_dps"].to<JsonObject>();
            if (isnan(diagnostic.imu_gyro_x_dps)) gyroDetail["x"] = nullptr;
            else gyroDetail["x"] = diagnostic.imu_gyro_x_dps;
            if (isnan(diagnostic.imu_gyro_y_dps)) gyroDetail["y"] = nullptr;
            else gyroDetail["y"] = diagnostic.imu_gyro_y_dps;
            if (isnan(diagnostic.imu_gyro_z_dps)) gyroDetail["z"] = nullptr;
            else gyroDetail["z"] = diagnostic.imu_gyro_z_dps;

            JsonObject orientationDetail = imuDetail["orientation_deg"].to<JsonObject>();
            if (isnan(diagnostic.pitch)) orientationDetail["pitch"] = nullptr;
            else orientationDetail["pitch"] = diagnostic.pitch;
            if (isnan(diagnostic.roll)) orientationDetail["roll"] = nullptr;
            else orientationDetail["roll"] = diagnostic.roll;
            if (isnan(diagnostic.yaw)) orientationDetail["yaw"] = nullptr;
            else orientationDetail["yaw"] = diagnostic.yaw;
            if (isnan(diagnostic.tilt)) orientationDetail["tilt"] = nullptr;
            else orientationDetail["tilt"] = diagnostic.tilt;

            String detailJson;
            serializeJson(detailDoc, detailJson);
            uploadSafetyEvent("DIAGNOSTIC_RESULT", detailJson.c_str());
            xSemaphoreTake(stateMutex, portMAX_DELAY);
            ok = true;
        } else if (cmd == "WARN_EXPIRY") {
            if (sharedTelemetry.session_state == "ACTIVE") {
                sharedTelemetry.session_state = "EXPIRING";
                sharedTelemetry.time_left_s = lc.time_left;
                Serial.printf("[Network] Cloud forced state to EXPIRING (time_left: %d)\n", lc.time_left);
            } else {
                Serial.println("[Network] Ignored late WARN_EXPIRY command.");
            }
            ok = true;
        } else if (cmd == "END_SESSION") {
            if (sharedTelemetry.session_state == "ACTIVE" ||
                sharedTelemetry.session_state == "EXPIRING" ||
                sharedTelemetry.session_state == "ENDING") {
                sharedTelemetry.session_state = "ENDING";
                sharedTelemetry.time_left_s = 0;
                if (timeIsSynced()) {
                    sessionEndTs = (uint32_t)time(nullptr);
                }
                Serial.println("[Network] Cloud forced state to ENDING.");
            } else {
                Serial.println("[Network] Ignored late END_SESSION command.");
            }
            ok = true;
        } else if (cmd == "SET_GEOFENCE") {
            double centerLat = lc.lat;
            double centerLng = lc.lng;

            if (lc.use_current_location) {
                if (sharedTelemetry.gps_fix) {
                    // Resolve the center on-device at execution time. This
                    // avoids network travel error while the chair is moving.
                    centerLat = sharedTelemetry.gps_lat;
                    centerLng = sharedTelemetry.gps_lng;
                } else {
                    commandError = "gps_fix_required";
                }
            }

            const bool coordinatesValid =
                isfinite(centerLat) &&
                isfinite(centerLng) &&
                centerLat >= -90.0 &&
                centerLat <= 90.0 &&
                centerLng >= -180.0 &&
                centerLng <= 180.0;
            const bool radiusValid =
                isfinite(lc.radius) &&
                lc.radius >= 50.0f &&
                lc.radius <= 2000.0f;

            if (!coordinatesValid) {
                commandError = "invalid_coordinates";
            } else if (!radiusValid) {
                commandError = "invalid_radius";
            }

            if (commandError.length() == 0) {
                sharedTelemetry.gf.center_lat = centerLat;
                sharedTelemetry.gf.center_lng = centerLng;
                sharedTelemetry.gf.radius_m = lc.radius;
                sharedTelemetry.gf.on = true;

                // A fallback coordinate is display continuity, not geofence
                // evidence. Defer enforcement until the next physical GPS fix.
                if (sharedTelemetry.gps_fix) {
                    const double dist = calculateDistance(
                        sharedTelemetry.gps_lat,
                        sharedTelemetry.gps_lng,
                        centerLat,
                        centerLng
                    );
                    sharedTelemetry.gf.dist_m = dist;
                    sharedTelemetry.gf.inside = (dist <= lc.radius);
                } else {
                    sharedTelemetry.gf.dist_m = 0.0f;
                    sharedTelemetry.gf.inside = true;
                    // Keep the non-authoritative display position beside the
                    // requested fence while the physical receiver has no fix.
                    sharedTelemetry.gps_fallback_anchor_lat = centerLat;
                    sharedTelemetry.gps_fallback_anchor_lng = centerLng;
                    sharedTelemetry.gps_fallback_anchor_revision++;
                    if (sharedTelemetry.gps_fallback_anchor_revision == 0) {
                        sharedTelemetry.gps_fallback_anchor_revision = 1;
                    }
                    sharedTelemetry.gps_lat = centerLat;
                    sharedTelemetry.gps_lng = centerLng;
                    sharedTelemetry.gps_speed_kmh = 0.3f;
                    sharedTelemetry.gps_simulated = true;
                }
                ok = true;
            } else {
                Serial.printf(
                    "[Network] Rejected SET_GEOFENCE: %s\n",
                    commandError.c_str()
                );
            }
        } else if (cmd == "OTA") {
            xSemaphoreGive(stateMutex);
            ok = handleOTACommand(lc.ota_url, lc.ota_version, lc.ota_size);
            xSemaphoreTake(stateMutex, portMAX_DELAY);
        } else if (cmd == "PING") {
            ok = true;
        } else {
            Serial.printf("[Network] Unknown command: %s\n", cmd.c_str());
        }

        bool currentPower = sharedTelemetry.power_state;
        bool currentLocked = sharedTelemetry.locked_state;
        String currentSessionState = sharedTelemetry.session_state;
        bool currentGeofenceOn = sharedTelemetry.gf.on;
        bool currentGeofenceInside = sharedTelemetry.gf.inside;
        double currentGeofenceLat = sharedTelemetry.gf.center_lat;
        double currentGeofenceLng = sharedTelemetry.gf.center_lng;
        float currentGeofenceRadius = sharedTelemetry.gf.radius_m;
        xSemaphoreGive(stateMutex);

        // Apply changes to relays IMMEDIATELY (sub-millisecond actuation)
        if (ok && (cmd == "POWER_ON" || cmd == "POWER_OFF" || cmd == "LOCK" || cmd == "UNLOCK" || cmd == "SOS" || cmd == "CLEAR_SOS")) {
            applyActuatorStates();
        }

        if (ok) {
            buzzerChirp(1, 80);
        } else {
            buzzerChirp(3, 40); // error chirp
        }

        // 3. Send execution ACK POST immediately
        JsonDocument ackDoc;
        ackDoc["id"] = cmdId;
        ackDoc["req_id"] = reqId;
        ackDoc["ok"] = ok;
        if (commandError.length() > 0) {
            ackDoc["error"] = commandError;
        }
        if (sessionStartTs > 0) {
            ackDoc["session_start_ts"] = sessionStartTs;
        }
        if (sessionEndTs > 0) {
            ackDoc["session_end_ts"] = sessionEndTs;
        }

        JsonObject stateObj = ackDoc["state"].to<JsonObject>();
        stateObj["power"] = currentPower;
        stateObj["locked"] = currentLocked;
        stateObj["session_state"] = currentSessionState;
        if (cmd == "SET_GEOFENCE") {
            JsonObject geofenceObj = stateObj["geofence"].to<JsonObject>();
            geofenceObj["on"] = currentGeofenceOn;
            geofenceObj["inside"] = currentGeofenceInside;
            geofenceObj["lat"] = currentGeofenceLat;
            geofenceObj["lng"] = currentGeofenceLng;
            geofenceObj["radius"] = currentGeofenceRadius;
        }

        String ackPayload;
        serializeJson(ackDoc, ackPayload);
        String ackSig = calculateHMAC(ackPayload, DEVICE_KEY);

        String ackUrl = String(SUPABASE_URL) + COMMANDS_PATH + "/ack";
        String ackResponse;
        performHTTPSRequest(ackUrl, "POST", ackPayload, ackSig, ackResponse);
    }
}

// Send safety alert event to Supabase queue (fully decoupled to prevent supervisor stalling)
void reportSafetyEvent(const String &eventType, const String &detailJson) {
    if (safetyEventQueue == NULL) return;

    SafetyEvent ev;
    strncpy(ev.eventType, eventType.c_str(), sizeof(ev.eventType) - 1);
    ev.eventType[sizeof(ev.eventType) - 1] = '\0';

    if (detailJson.length() >= sizeof(ev.detailJson)) {
        // Never enqueue truncated JSON — a chopped object arrives at the cloud
        // as a bare string and corrupts the events.detail jsonb contract.
        // Send a small, valid marker object instead.
        snprintf(ev.detailJson, sizeof(ev.detailJson),
                 "{\"truncated\":true,\"orig_len\":%u}", (unsigned)detailJson.length());
        Serial.printf("[Network] Safety event detail too long (%u bytes) — sent truncation marker.\n",
                      (unsigned)detailJson.length());
    } else {
        strcpy(ev.detailJson, detailJson.c_str());
    }

    if (xQueueSend(safetyEventQueue, &ev, 0) != pdTRUE) {
        Serial.println("[Network] Safety event queue full! Event dropped.");
    }
}
