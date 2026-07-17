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

    xSemaphoreTake(stateMutex, portMAX_DELAY);
    sharedTelemetry.ota_status = "downloading";
    sharedTelemetry.ota_progress = 0;
    sharedTelemetry.ota_last_error = "";
    xSemaphoreGive(stateMutex);

    Serial.printf("[OTA] Starting stream OTA. Target URL: %s, version: %s\n", url.c_str(), version.c_str());

    const esp_partition_t *update_partition = esp_ota_get_next_update_partition(NULL);
    if (update_partition == NULL) {
        Serial.println("[OTA] Error: Update partition target not found!");
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "failed";
        sharedTelemetry.ota_last_error = "Partition not found";
        xSemaphoreGive(stateMutex);
        reportSafetyEvent("OTA_FAIL", "{\"reason\":\"partition_not_found\"}");
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
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "failed";
        sharedTelemetry.ota_last_error = "HTTP code " + String(httpCode);
        xSemaphoreGive(stateMutex);
        reportSafetyEvent("OTA_FAIL", "{\"reason\":\"http_error\",\"code\":" + String(httpCode) + "}");
        http.end();
        otaRunning = false;
        vTaskDelete(NULL);
        return;
    }

    int contentLength = http.getSize();
    if (expectedSize > 0 && contentLength > 0 && (size_t)contentLength != expectedSize) {
        Serial.printf("[OTA] Content-Length mismatch: got %d, expected %d\n", contentLength, expectedSize);
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "failed";
        sharedTelemetry.ota_last_error = "Size mismatch";
        xSemaphoreGive(stateMutex);
        reportSafetyEvent("OTA_FAIL", "{\"reason\":\"size_mismatch\"}");
        http.end();
        otaRunning = false;
        vTaskDelete(NULL);
        return;
    }

    esp_ota_handle_t ota_handle;
    esp_err_t err = esp_ota_begin(update_partition, contentLength, &ota_handle);
    if (err != ESP_OK) {
        Serial.printf("[OTA] esp_ota_begin failed: %s\n", esp_err_to_name(err));
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "failed";
        sharedTelemetry.ota_last_error = "OTA start fail";
        xSemaphoreGive(stateMutex);
        reportSafetyEvent("OTA_FAIL", "{\"reason\":\"ota_begin_fail\",\"code\":" + String(err) + "}");
        http.end();
        otaRunning = false;
        otaDownloadTaskHandle = NULL;
        vTaskDelete(NULL);
        return;
    }

    WiFiClient *stream = http.getStreamPtr();
    uint8_t buffer[4096]; // Increased read buffer from 1KB to 4KB for increased OTA throughput
    size_t total_written = 0;
    
    // Stream directly into flash (low RAM consumption)
    while (http.connected() && (total_written < (size_t)contentLength || contentLength == -1)) {
        int available = stream->available();
        if (available > 0) {
            int read_len = stream->readBytes(buffer, min(available, (int)sizeof(buffer)));
            if (read_len > 0) {
                esp_err_t write_err = esp_ota_write(ota_handle, buffer, read_len);
                if (write_err != ESP_OK) {
                    Serial.printf("[OTA] esp_ota_write failed: %s\n", esp_err_to_name(write_err));
                    xSemaphoreTake(stateMutex, portMAX_DELAY);
                    sharedTelemetry.ota_status = "failed";
                    sharedTelemetry.ota_last_error = "Write failure";
                    xSemaphoreGive(stateMutex);
                    reportSafetyEvent("OTA_FAIL", "{\"reason\":\"flash_write_fail\"}");
                    break;
                }
                total_written += read_len;
                if (contentLength > 0) {
                    otaProgressPercent = (total_written * 100) / contentLength;
                    xSemaphoreTake(stateMutex, portMAX_DELAY);
                    sharedTelemetry.ota_progress = otaProgressPercent;
                    xSemaphoreGive(stateMutex);

                    // Send periodic progress telemetry updates (approx every 10%)
                    if (otaProgressPercent % 10 == 0) {
                        reportSafetyEvent("OTA_PROGRESS", "{\"progress\":" + String(otaProgressPercent) + "}");
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
        esp_err_t end_err = esp_ota_end(ota_handle);
        if (end_err == ESP_OK) {
            esp_err_t boot_err = esp_ota_set_boot_partition(update_partition);
            if (boot_err == ESP_OK) {
                success = true;
            } else {
                Serial.printf("[OTA] Failed to set boot partition: %s\n", esp_err_to_name(boot_err));
                xSemaphoreTake(stateMutex, portMAX_DELAY);
                sharedTelemetry.ota_status = "failed";
                sharedTelemetry.ota_last_error = "Boot target swap failed";
                xSemaphoreGive(stateMutex);
            }
        } else {
            Serial.printf("[OTA] esp_ota_end failed: %s\n", esp_err_to_name(end_err));
            xSemaphoreTake(stateMutex, portMAX_DELAY);
            sharedTelemetry.ota_status = "failed";
            sharedTelemetry.ota_last_error = "End verify fail";
            xSemaphoreGive(stateMutex);
        }
    } else {
        Serial.println("[OTA] Download truncated or aborted!");
        esp_ota_end(ota_handle);
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "failed";
        sharedTelemetry.ota_last_error = "Download aborted";
        xSemaphoreGive(stateMutex);
    }

    if (success) {
        Serial.println("[OTA] OTA upgrade complete! Rebooting into target partition in 2 seconds...");
        writeNVSBootState(1);
        writeNVSBootAttempts(1);
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.ota_status = "rebooting";
        sharedTelemetry.ota_progress = 100;
        xSemaphoreGive(stateMutex);
        reportSafetyEvent("OTA_READY", "{\"version\":\"" + version + "\"}");
        vTaskDelay(pdMS_TO_TICKS(2000));
        esp_restart();
    } else {
        otaRunning = false;
        otaDownloadTaskHandle = NULL;
    }

    vTaskDelete(NULL);
}

void handleOTACommand(const String &url, const String &version, size_t size) {
    if (otaRunning) {
        Serial.println("[OTA] Rejected command: OTA task is actively downloading.");
        return;
    }

    // Refuse upgrade if target version matches running version (minimal validation)
    if (version == FW_VERSION) {
        Serial.println("[OTA] Rejected command: already running version " FW_VERSION);
        return;
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
        return;
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
        return;
    }

    // Spawn download stream task at lowest priority (priority 1) pinned to Core 0 (Network/IO)
    pendingOTA.pending = false;
    xTaskCreatePinnedToCore(otaDownloadTask, "ota_task", 12288, NULL, 1, &otaDownloadTaskHandle, 0);
    
    reportSafetyEvent("OTA_STARTED", "{\"target_version\":\"" + version + "\"}");
}
