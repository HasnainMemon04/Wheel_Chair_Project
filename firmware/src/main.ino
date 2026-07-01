#include <Arduino.h>
#include "sensors.h"
#include "network.h"
#include "actuators.h"

void setup() {
    // Initialize Serial Debug Monitor
    Serial.begin(115200);
    delay(1000);
    Serial.println("=================================================");
    Serial.println("   Smart Rental Wheelchair IoT System (M1)      ");
    Serial.println("=================================================");

    // Initialize Subsystems
    initSensors();
    initActuators();
    initNetwork();

    // Create FreeRTOS Tasks
    xTaskCreate(
        sensorPollTask,
        "SensorPollTask",
        4096,
        NULL,
        4,              // High priority
        NULL
    );

    xTaskCreate(
        tempTask,
        "TempTask",
        3072,
        NULL,
        2,              // Medium priority
        NULL
    );

    xTaskCreate(
        gpsTask,
        "GPSTask",
        4096,
        NULL,
        3,              // Medium-high priority
        NULL
    );

    xTaskCreate(
        safetySupervisorTask,
        "SafetySupervisor",
        3072,
        NULL,
        5,              // Highest priority
        NULL
    );

    xTaskCreate(
        networkTask,
        "NetworkTask",
        4096,
        NULL,
        2,              // Medium priority
        NULL
    );

    xTaskCreate(
        uploadTelemetryTask,
        "UploadTelemetry",
        8192,           // Needs larger stack for SSL/TLS and JSON
        NULL,
        3,              // Medium-high priority
        NULL
    );

    Serial.println("[System] All FreeRTOS Tasks initialized.");
}

void loop() {
    // Nothing to do here; FreeRTOS scheduler handles all tasks
    vTaskDelay(pdMS_TO_TICKS(10000));
}
