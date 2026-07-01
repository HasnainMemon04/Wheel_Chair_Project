#include "network.h"
#include "sensors.h"
#include "actuators.h"
#include "config.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>
#include <vector>

// Global connection state
bool wifiConnected = false;

// Shared Secure client and serialization mutex to prevent memory starvation
WiFiClientSecure secureClient;
HTTPClient httpClient; // Global reused HTTP client to enable keep-alive
SemaphoreHandle_t wifiClientMutex = NULL;

// Decoupled safety event queue structure
struct SafetyEvent {
    char eventType[16];
    char detailJson[128];
};
QueueHandle_t safetyEventQueue = NULL;

// Cache of recently processed command IDs to deduplicate incoming backlogs
static std::vector<String> processedCmdIds;

// Local command representation for parsing
struct LocalCommand {
    String id;
    String cmd;
    String reqId;
    int duration_s;
    int time_left;
    int kmh;
    float radius;
    double lat;
    double lng;
};

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
    
    // Disable certificate verification to save ~30KB of heap
    secureClient.setInsecure();
    
    // Enable keep-alive on the global HTTP client
    httpClient.setReuse(true);
    
    // Create the mutex to serialize all HTTPS transactions
    wifiClientMutex = xSemaphoreCreateMutex();
    
    // Decoupled queue for safety supervisor events (size 5, non-blocking writes)
    safetyEventQueue = xQueueCreate(5, sizeof(SafetyEvent));
}

// WiFi Monitor Task with Exponential Backoff
void networkTask(void *pvParameters) {
    uint32_t backoffMs = 2000;
    const uint32_t maxBackoffMs = 60000;

    Serial.println("[Tasks] WiFi Task started.");
    
    while (true) {
        if (WiFi.status() != WL_CONNECTED) {
            wifiConnected = false;
            Serial.printf("[Network] WiFi not connected. Connecting to SSID: %s...\n", WIFI_SSID);
            WiFi.begin(WIFI_SSID, WIFI_PASS);
            
            // Wait up to 10s for connection
            int retries = 0;
            while (WiFi.status() != WL_CONNECTED && retries < 20) {
                vTaskDelay(pdMS_TO_TICKS(500));
                retries++;
            }
            
            if (WiFi.status() == WL_CONNECTED) {
                wifiConnected = true;
                backoffMs = 2000; // Reset backoff
                Serial.printf("[Network] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
            } else {
                Serial.printf("[Network] Connection failed. Backing off for %d ms...\n", backoffMs);
                vTaskDelay(pdMS_TO_TICKS(backoffMs));
                backoffMs = min(backoffMs * 2, maxBackoffMs);
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
        if (!secureClient.connected()) {
            Serial.printf("[TLS] Opening fresh TLS session. Free Heap: %d bytes\n", ESP.getFreeHeap());
        }
        
        httpClient.begin(secureClient, url);
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
            secureClient.stop();
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
    
    doc["ts"] = uptime + 1730000000;
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
    }
}

// Ingestion Uploader Task (1 Hz)
void uploadTelemetryTask(void *pvParameters) {
    TickType_t lastWakeTime = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(1000 / TELEMETRY_HZ);
    
    Serial.println("[Tasks] Telemetry Upload Task started.");
    
    int lastUploadCode = -1;
    
    while (true) {
        if (wifiConnected) {
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
            doc["ts"] = localData.uptime_s + 1730000000; // Mock current epoch time
            doc["fw"] = FW_VERSION;
            doc["up"] = localData.uptime_s;
            doc["fix"] = localData.gps_fix ? 1 : 0;
            doc["lat"] = localData.gps_lat;
            doc["lng"] = localData.gps_lng;
            doc["spd"] = localData.gps_speed_kmh;
            doc["sats"] = localData.gps_sats;
            doc["hdop"] = localData.gps_hdop;
            doc["pitch"] = localData.pitch;
            doc["roll"] = localData.roll;
            doc["tilt"] = localData.tilt;
            doc["temp_motor"] = localData.temp_motor;
            doc["temp_batt"] = localData.temp_battery;
            doc["temp_amb"] = localData.temp_ambient;
            doc["humidity"] = localData.humidity;
            doc["batt_v"] = localData.batt_v;
            doc["batt_pct"] = localData.batt_pct;
            doc["occupied"] = localData.occupied ? 1 : 0;
            doc["rssi"] = localData.wifi_rssi;
            doc["power"] = localData.power_state ? 1 : 0;
            doc["locked"] = localData.locked_state ? 1 : 0;
            doc["session_state"] = localData.session_state;
            doc["time_left"] = localData.time_left_s;
            doc["speed_limit"] = localData.speed_limit_kmh;
            doc["over_speed"] = localData.over_speed ? 1 : 0;
            
            JsonObject gfObj = doc["gf"].to<JsonObject>();
            gfObj["on"] = localData.gf.on ? 1 : 0;
            gfObj["in"] = localData.gf.inside ? 1 : 0;
            gfObj["dist"] = localData.gf.dist_m;
            gfObj["r"] = localData.gf.radius_m;

            String jsonPayload;
            serializeJson(doc, jsonPayload);

            // 3. Compute HMAC-SHA256 signature
            String signature = calculateHMAC(jsonPayload, DEVICE_KEY);

            // 4. HTTP POST request
            String url = String(SUPABASE_URL) + INGEST_PATH;
            String response;
            lastUploadCode = performHTTPSRequest(url, "POST", jsonPayload, signature, response);
            
            // 5. Parse and execute piggybacked commands from the telemetry response (near-instant execution)
            if (lastUploadCode == 200 && response.length() > 0) {
                processCommands(response);
            }
            
            // 6. Lightweight once-per-second heartbeat log
            Serial.printf("[Heartbeat] Uptime: %ds | Free Heap: %d bytes | RSSI: %d | Last HTTP: %d | GPS Fix: %s\n",
                          localData.uptime_s, ESP.getFreeHeap(), localData.wifi_rssi, lastUploadCode, localData.gps_fix ? "YES" : "NO");
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
        lc.kmh = args["kmh"] | SPEED_LIMIT_KMH;
        lc.radius = args["radius"] | GEOFENCE_RADIUS_M;
        lc.lat = args["lat"] | 24.860048;
        lc.lng = args["lng"] | 67.063734;
        
        pendingCmds.push_back(lc);
    }
    
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
        
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        float tempMotor = sharedTelemetry.temp_motor;
        float tempBatt = sharedTelemetry.temp_battery;
        float tilt = sharedTelemetry.tilt;
        bool tiltSwActive = sharedTelemetry.tilt_switch_state;
        
        bool hazardActive = (tempMotor > TEMP_HOT_C || tempBatt > TEMP_HOT_C || tilt > TILT_FALL_DEG || tiltSwActive);
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
                Serial.println("[Network] Cloud forced state to ENDING.");
            } else {
                Serial.println("[Network] Ignored late END_SESSION command.");
            }
            ok = true;
        } else if (cmd == "SET_SPEED_LIMIT") {
            sharedTelemetry.speed_limit_kmh = lc.kmh;
            ok = true;
        } else if (cmd == "SET_GEOFENCE") {
            sharedTelemetry.gf.center_lat = lc.lat;
            sharedTelemetry.gf.center_lng = lc.lng;
            sharedTelemetry.gf.radius_m = lc.radius;
            sharedTelemetry.gf.on = true;
            // Recalculate inside/outside status immediately
            double dist = calculateDistance(sharedTelemetry.gps_lat, sharedTelemetry.gps_lng, lc.lat, lc.lng);
            sharedTelemetry.gf.dist_m = dist;
            sharedTelemetry.gf.inside = (dist <= lc.radius);
            ok = true;
        } else if (cmd == "PING") {
            ok = true;
        } else {
            Serial.printf("[Network] Unknown command: %s\n", cmd.c_str());
        }
        
        bool currentPower = sharedTelemetry.power_state;
        bool currentLocked = sharedTelemetry.locked_state;
        int currentSpeedLimit = sharedTelemetry.speed_limit_kmh;
        String currentSessionState = sharedTelemetry.session_state;
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
        
        JsonObject stateObj = ackDoc["state"].to<JsonObject>();
        stateObj["power"] = currentPower;
        stateObj["locked"] = currentLocked;
        stateObj["speed_limit"] = currentSpeedLimit;
        stateObj["session_state"] = currentSessionState;
        
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
    
    strncpy(ev.detailJson, detailJson.c_str(), sizeof(ev.detailJson) - 1);
    ev.detailJson[sizeof(ev.detailJson) - 1] = '\0';
    
    if (xQueueSend(safetyEventQueue, &ev, 0) != pdTRUE) {
        Serial.println("[Network] Safety event queue full! Event dropped.");
    }
}
