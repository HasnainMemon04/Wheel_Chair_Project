#include "ota.h"
#include "sensors.h"
#include "actuators.h"
#include "network.h"
#include "config.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include "nvs_flash.h"
#include "nvs.h"

// Helper status tracking
static bool otaRunning = false;
static int otaProgressPercent = 0;

struct PendingOTADef {
    bool pending;
    String url;
    String version;
    size_t size;
};

static PendingOTADef pendingOTA = {false, "", "", 0};

static void setOTAStatus(const String &status, int progress, const String &lastError = "") {
    xSemaphoreTake(stateMutex, portMAX_DELAY);
    sharedTelemetry.ota_status = status;
    sharedTelemetry.ota_progress = progress;
    sharedTelemetry.ota_last_error = lastError;
    xSemaphoreGive(stateMutex);
}

static void reportOTAStage(const String &stage, const String &message, int progress, const String &version = "") {
    String detail = "{\"stage\":\"" + stage + "\",\"message\":\"" + message + "\",\"progress\":" + String(progress);
    if (version.length() > 0) {
        detail += ",\"version\":\"" + version + "\"";
    }
    detail += "}";

    Serial.printf("[OTA] %s (%d%%)%s%s\n",
                  message.c_str(),
                  progress,
                  version.length() > 0 ? " version " : "",
                  version.length() > 0 ? version.c_str() : "");
    reportSafetyEvent("OTA_STAGE", detail);
}

static void enterOTAMaintenanceMode(const String &version) {
    xSemaphoreTake(stateMutex, portMAX_DELAY);
    sharedTelemetry.power_state = false;
    sharedTelemetry.locked_state = true;
    sharedTelemetry.session_state = "LOCKED";
    sharedTelemetry.time_left_s = 0;
    sharedTelemetry.ota_status = "preparing";
    sharedTelemetry.ota_progress = 0;
    sharedTelemetry.ota_last_error = "";
    xSemaphoreGive(stateMutex);

    // Keep ESP32/WiFi alive, but close the wheelchair actuation system.
    // Motion relay is locked and power state is off until the OTA completes.
    setMotionRelay(false);
    buzzerWrite(false);
    updateRGBLED(0, 0, 0);
    applyActuatorStates();

    reportOTAStage("system_closed", "All system closed for firmware update", 0, version);
}

static void failOTA(const String &reason, const String &message, const String &version = "", int code = 0) {
    setOTAStatus("failed", otaProgressPercent, message);

    String detail = "{\"reason\":\"" + reason + "\"";
    if (code != 0) detail += ",\"code\":" + String(code);
    if (version.length() > 0) detail += ",\"version\":\"" + version + "\"";
    detail += "}";

    reportSafetyEvent("OTA_FAIL", detail);
    reportOTAStage("failed", message, otaProgressPercent, version);
}

bool isOTABusy() {
    return otaRunning;
}

int getOTAPercent() {
    return otaProgressPercent;
}

// Task handles for high-water mark reporting
TaskHandle_t otaDownloadTaskHandle = NULL;
TaskHandle_t otaSchedulerTaskHandle = NULL;
TaskHandle_t otaValWatchdogTaskHandle = NULL;

void getOTATaskHighWaterMarks(unsigned int &downloadWatermark, unsigned int &schedulerWatermark, unsigned int &watchdogWatermark) {
    downloadWatermark = (otaDownloadTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(otaDownloadTaskHandle) : 9999;
    schedulerWatermark = (otaSchedulerTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(otaSchedulerTaskHandle) : 9999;
    watchdogWatermark = (otaValWatchdogTaskHandle != NULL) ? uxTaskGetStackHighWaterMark(otaValWatchdogTaskHandle) : 9999;
}

static uint8_t readNVSBootState() {
    nvs_handle_t handle;
    uint8_t state = 0;
    if (nvs_open("ota_nvs", NVS_READWRITE, &handle) == ESP_OK) {
        nvs_get_u8(handle, "boot_state", &state);
        nvs_close(handle);
    }
    return state;
}

static void writeNVSBootState(uint8_t state) {
    nvs_handle_t handle;
    if (nvs_open("ota_nvs", NVS_READWRITE, &handle) == ESP_OK) {
        nvs_set_u8(handle, "boot_state", state);
        nvs_commit(handle);
        nvs_close(handle);
    }
}

static uint8_t readNVSBootAttempts() {
    nvs_handle_t handle;
    uint8_t attempts = 0;
    if (nvs_open("ota_nvs", NVS_READWRITE, &handle) == ESP_OK) {
        nvs_get_u8(handle, "boot_attempts", &attempts);
        nvs_close(handle);
    }
    return attempts;
}

static void writeNVSBootAttempts(uint8_t attempts) {
    nvs_handle_t handle;
    if (nvs_open("ota_nvs", NVS_READWRITE, &handle) == ESP_OK) {
        nvs_set_u8(handle, "boot_attempts", attempts);
        nvs_commit(handle);
        nvs_close(handle);
    }
}

// Timeout task to trigger rollback if the app hangs or fails to reach network/telemetry validation within 20 seconds
static void otaValidationTimeoutTask(void *pvParameters) {
    vTaskDelay(pdMS_TO_TICKS(20000));
    
    if (readNVSBootState() == 1) {
        Serial.println("[OTA] Telemetry validation timeout reached! Rolling back new firmware...");
        // Best effort warning event upload before rollback reboot
        reportSafetyEvent("OTA_ROLLED_BACK", "{\"reason\":\"validation_timeout\"}");
        vTaskDelay(pdMS_TO_TICKS(1500));
        
        // Clear NVS state
        writeNVSBootState(0);
        writeNVSBootAttempts(0);
        
        // Point bootloader back to the other slot and reboot
        const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
        if (update_partition != NULL) {
            esp_ota_set_boot_partition(update_partition);
        }
        esp_restart();
    } else {
        Serial.println("[OTA] Watchdog: App validated successfully. Watchdog exiting.");
    }
    otaValWatchdogTaskHandle = NULL;
    vTaskDelete(NULL);
}

void initOTA() {
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *boot = esp_ota_get_boot_partition();
    if (running && boot) {
        Serial.printf("[OTA] Running partition: %s, Configured boot partition: %s\n", running->label, boot->label);
    }
    const esp_partition_t *p0 = esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_0, NULL);
    const esp_partition_t *p1 = esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_1, NULL);
    esp_ota_img_states_t s0, s1;
    if (p0 && esp_ota_get_state_partition(p0, &s0) == ESP_OK) {
        Serial.printf("[OTA] Partition app0 (%s) state: %d\n", p0->label, s0);
    }
    if (p1 && esp_ota_get_state_partition(p1, &s1) == ESP_OK) {
        Serial.printf("[OTA] Partition app1 (%s) state: %d\n", p1->label, s1);
    }

    // Custom NVS boot attempt and rollback tracking
    uint8_t boot_state = readNVSBootState();
    if (boot_state == 1) {
        uint8_t attempts = readNVSBootAttempts();
        Serial.printf("[OTA] App booted in validation mode. Attempt: %d\n", attempts);
        if (attempts > 1) {
            Serial.println("[OTA] Critical: App failed to validate on previous boot! Rolling back immediately...");
            const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
            if (update_partition != NULL) {
                esp_ota_set_boot_partition(update_partition);
            }
            writeNVSBootState(0);
            writeNVSBootAttempts(0);
            esp_restart();
        } else {
            writeNVSBootAttempts(attempts + 1);
            Serial.println("[OTA] Starting 20s validation watchdog...");
            xTaskCreatePinnedToCore(otaValidationTimeoutTask, "ota_val_watchdog", 8192, NULL, 2, &otaValWatchdogTaskHandle, 0);
        }
    } else {
        Serial.println("[OTA] App booted with active/verified firmware slot.");
    }

    // Task scheduler loop to process deferred updates when the wheelchair is fully stopped
    // Run on Core 0 at priority 1 (lowest)
    xTaskCreatePinnedToCore([](void *param) {
        while (true) {
            vTaskDelay(pdMS_TO_TICKS(2000));
            if (pendingOTA.pending && !otaRunning) {
                xSemaphoreTake(stateMutex, portMAX_DELAY);
                float speed = sharedTelemetry.gps_speed_kmh;
                String sessionState = sharedTelemetry.session_state;
                int batt = sharedTelemetry.batt_pct;
                xSemaphoreGive(stateMutex);

                bool faults = isOTASafetyFaultActive();

                if (speed <= 0.1f && (sessionState == "LOCKED" || sessionState == "IDLE") && !faults) {
                    if (batt >= 30) {
                        Serial.println("[OTA] Deferred OTA safety conditions met. Starting download...");
                        pendingOTA.pending = false;
                        handleOTACommand(pendingOTA.url, pendingOTA.version, pendingOTA.size);
                    } else {
                        xSemaphoreTake(stateMutex, portMAX_DELAY);
                        sharedTelemetry.ota_status = "deferred";
                        sharedTelemetry.ota_last_error = "Battery too low (<30%)";
                        xSemaphoreGive(stateMutex);
                        reportOTAStage("deferred", "Battery too low for OTA", 0, pendingOTA.version);
                    }
                }
            }
        }
    }, "ota_scheduler", 4096, NULL, 1, &otaSchedulerTaskHandle, 0);
}

void markFirmwareValid() {
    // Keep standard Espressif verification API just in case
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(running, &state) == ESP_OK) {
        if (state == ESP_OTA_IMG_PENDING_VERIFY) {
            esp_ota_mark_app_valid_cancel_rollback();
        }
    }
    // Update custom NVS verification state
    uint8_t boot_state = readNVSBootState();
    if (boot_state == 1) {
        writeNVSBootState(0);
        writeNVSBootAttempts(0);
        Serial.println("[OTA] New app validated successfully! Rollback cancelled.");
        setOTAStatus("success", 100);
        reportOTAStage("validated", "New firmware validated successfully", 100, String(FW_VERSION));
        reportSafetyEvent("OTA_SUCCESS", "{\"version\":\"" + String(FW_VERSION) + "\"}");
    }
}

// Background OTA download and flash streaming task (Lowest task priority)
static void otaDownloadTask(void *pvParameters) {
    otaRunning = true;
    otaProgressPercent = 0;

    String url = pendingOTA.url;
    String version = pendingOTA.version;
    size_t expectedSize = pendingOTA.size;

    setOTAStatus("downloading", 0);
    reportOTAStage("download_initiated", "Download initiated", 0, version);

    Serial.printf("[OTA] Starting stream OTA. Target URL: %s, version: %s\n", url.c_str(), version.c_str());

    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        Serial.println("[OTA] Error: Update partition target not found!");
        failOTA("partition_not_found", "OTA partition not found", version);
        otaRunning = false;
        vTaskDelete(NULL);
        return;
    }

    bool isHttps = url.startsWith("https://");
    HTTPClient http;
    WiFiClientSecure secureClient;
    WiFiClient plainClient;

    if (isHttps) {
        secureClient.setInsecure(); // No certificate checking for dev stage OTA updates
        http.begin(secureClient, url);
    } else {
        http.begin(plainClient, url);
    }
    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[OTA] HTTP GET Failed: %s\n", http.errorToString(httpCode).c_str());
        failOTA("network_issue", "Network issue while downloading firmware", version, httpCode);
        http.end();
        otaRunning = false;
        vTaskDelete(NULL);
        return;
    }

    int contentLength = http.getSize();
    if (expectedSize > 0 && contentLength > 0 && (size_t)contentLength != expectedSize) {
        Serial.printf("[OTA] Content-Length mismatch: got %d, expected %d\n", contentLength, expectedSize);
        failOTA("size_mismatch", "Firmware size mismatch", version);
        http.end();
        otaRunning = false;
        vTaskDelete(NULL);
        return;
    }

    esp_ota_handle_t ota_handle;
    esp_err_t err = esp_ota_begin(update_partition, contentLength, &ota_handle);
    if (err != ESP_OK) {
        Serial.printf("[OTA] esp_ota_begin failed: %s\n", esp_err_to_name(err));
        failOTA("ota_begin_fail", "OTA install could not start", version, (int)err);
        http.end();
        otaRunning = false;
        otaDownloadTaskHandle = NULL;
        vTaskDelete(NULL);
        return;
    }

    WiFiClient *stream = http.getStreamPtr();
    uint8_t buffer[4096]; // Increased read buffer from 1KB to 4KB for increased OTA throughput
    size_t total_written = 0;
    int lastReportedProgress = -5;
    bool streamFailed = false;
    
    // Stream directly into flash (low RAM consumption)
    while (http.connected() && (total_written < (size_t)contentLength || contentLength == -1)) {
        int available = stream->available();
        if (available > 0) {
            int read_len = stream->readBytes(buffer, min(available, (int)sizeof(buffer)));
            if (read_len > 0) {
                esp_err_t write_err = esp_ota_write(ota_handle, buffer, read_len);
                if (write_err != ESP_OK) {
                    Serial.printf("[OTA] esp_ota_write failed: %s\n", esp_err_to_name(write_err));
                    failOTA("flash_write_fail", "Flash write failed", version);
                    streamFailed = true;
                    break;
                }
                total_written += read_len;
                if (contentLength > 0) {
                    otaProgressPercent = (total_written * 100) / contentLength;
                    setOTAStatus("downloading", otaProgressPercent);

                    // Send periodic real progress updates without flooding the cloud.
                    if (otaProgressPercent >= lastReportedProgress + 5 || otaProgressPercent == 100) {
                        lastReportedProgress = otaProgressPercent;
                        reportSafetyEvent("OTA_PROGRESS", "{\"progress\":" + String(otaProgressPercent) + ",\"version\":\"" + version + "\"}");
                        reportOTAStage("downloading", "Downloading firmware", otaProgressPercent, version);
                    }
                }
            }
        } else {
            // Only yield when the stream is EMPTY to maximize raw bandwidth throughput
            vTaskDelay(pdMS_TO_TICKS(5));
        }
    }

    http.end();

    bool success = false;
    if (contentLength > 0 && total_written == (size_t)contentLength) {
        setOTAStatus("installing", 95);
        reportOTAStage("downloaded", "Firmware downloaded", 100, version);
        reportOTAStage("installing", "Installing firmware image", 95, version);
        esp_err_t end_err = esp_ota_end(ota_handle);
        if (end_err == ESP_OK) {
            esp_err_t boot_err = esp_ota_set_boot_partition(update_partition);
            if (boot_err == ESP_OK) {
                success = true;
            } else {
                Serial.printf("[OTA] Failed to set boot partition: %s\n", esp_err_to_name(boot_err));
                failOTA("boot_target_swap_failed", "Boot target swap failed", version, (int)boot_err);
            }
        } else {
            Serial.printf("[OTA] esp_ota_end failed: %s\n", esp_err_to_name(end_err));
            failOTA("corrupted_firmware", "Firmware image verification failed", version, (int)end_err);
        }
    } else if (!streamFailed) {
        Serial.println("[OTA] Download truncated or aborted!");
        esp_ota_end(ota_handle);
        failOTA("download_aborted", "Download truncated or aborted", version);
    }

    if (success) {
        Serial.println("[OTA] OTA upgrade complete! Rebooting into target partition in 2 seconds...");
        writeNVSBootState(1);
        writeNVSBootAttempts(1);
        setOTAStatus("rebooting", 100);
        reportOTAStage("installed", "Firmware installed", 100, version);
        reportOTAStage("reboot", "Rebooting into new firmware", 100, version);
        reportSafetyEvent("OTA_READY", "{\"version\":\"" + version + "\"}");
        vTaskDelay(pdMS_TO_TICKS(2000));
        esp_restart();
    } else {
        otaRunning = false;
        otaDownloadTaskHandle = NULL;
    }

    vTaskDelete(NULL);
}

bool handleOTACommand(const String &url, const String &version, size_t size) {
    if (otaRunning) {
        Serial.println("[OTA] Rejected command: OTA task is actively downloading.");
        reportSafetyEvent("OTA_DEFERRED", "{\"reason\":\"already_in_progress\",\"target_version\":\"" + version + "\"}");
        return false;
    }

    // Refuse a no-op upgrade. This is reported through the same real device
    // event stream as every other OTA outcome, so the operator never sees a
    // browser-created "started" event without a matching device action.
    if (version == FW_VERSION) {
        Serial.println("[OTA] Rejected command: already running version " FW_VERSION);
        const String message = "Already running firmware v" + version;
        setOTAStatus("deferred", 0, message);
        reportOTAStage("skipped", message, 0, version);
        reportSafetyEvent("OTA_DEFERRED", "{\"reason\":\"already_on_version\",\"target_version\":\"" + version + "\"}");
        return false;
    }

    pendingOTA.url = url;
    pendingOTA.version = version;
    pendingOTA.size = size;

    xSemaphoreTake(stateMutex, portMAX_DELAY);
    float speed = sharedTelemetry.gps_speed_kmh;
    String sessionState = sharedTelemetry.session_state;
    int batt = sharedTelemetry.batt_pct;
    xSemaphoreGive(stateMutex);

    bool faults = isOTASafetyFaultActive();

    // Check wheelchair safety interlocks (only run when stationary, locked/idle, no alarms)
    if (speed > 0.1f || (sessionState != "LOCKED" && sessionState != "IDLE") || faults) {
        Serial.println("[OTA] Safety interlocks active. Deferring OTA command.");
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "deferred";
        sharedTelemetry.ota_last_error = "In motion or active session";
        xSemaphoreGive(stateMutex);
        pendingOTA.pending = true;

        reportSafetyEvent("OTA_DEFERRED", "{\"reason\":\"safety_interlocks\",\"target_version\":\"" + version + "\"}");
        return true;
    }

    // Enforce battery charge rule (>30% required to write to flash safely)
    if (batt < 30) {
        Serial.println("[OTA] Battery level too low (<30%). Deferring OTA command.");
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "deferred";
        sharedTelemetry.ota_last_error = "Battery too low (<30%)";
        xSemaphoreGive(stateMutex);
        pendingOTA.pending = true;

        reportSafetyEvent("OTA_DEFERRED", "{\"reason\":\"battery_low\",\"target_version\":\"" + version + "\"}");
        return true;
    }

    // Spawn download stream task at lowest priority (priority 1) pinned to Core 0 (Network/IO)
    pendingOTA.pending = false;
    enterOTAMaintenanceMode(version);
    const BaseType_t taskCreated = xTaskCreatePinnedToCore(
        otaDownloadTask, "ota_task", 12288, NULL, 1, &otaDownloadTaskHandle, 0
    );
    if (taskCreated != pdPASS) {
        otaDownloadTaskHandle = NULL;
        failOTA("task_start_failed", "OTA task could not start", version);
        return false;
    }
    
    reportSafetyEvent("OTA_STARTED", "{\"target_version\":\"" + version + "\"}");
    return true;
}
