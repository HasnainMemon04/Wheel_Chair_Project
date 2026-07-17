#pragma once
#include <Arduino.h>

struct TelemetryData {
    uint32_t uptime_s;
    bool gps_fix;
    double gps_lat;
    double gps_lng;
    float gps_speed_kmh;
    int gps_sats;
    float gps_hdop;

    float pitch;
    float roll;
    float tilt;
    float yaw;

    float temp_battery;

    float batt_v;
    int batt_pct;
    bool in_motion;
    bool vibration_state;
    int wifi_rssi;

    // OTA State tracking variables
    String ota_status;
    int ota_progress;
    String ota_last_error;

    // Anti-tamper (MPU6500 accelerometer-based shock monitoring, armed while LOCKED)
    bool tamper_alarm;       // true = continuous siren latched (4th strike)
    int  tamper_warn_count;  // number of tamper disturbances counted so far

    bool power_state;
    bool locked_state;
    String session_state;
    int time_left_s;

    // Geofence status
    struct Geofence {
        bool on;
        bool inside;
        float dist_m;
        float radius_m;
        double center_lat;
        double center_lng;
    } gf;
};

// Global shared state and synchronization
extern TelemetryData sharedTelemetry;
extern SemaphoreHandle_t stateMutex;
extern bool mpuOK;

// Initialization and FreeRTOS tasks
void initSensors();
void gpsTask(void *pvParameters);
void sensorPollTask(void *pvParameters);
void tempTask(void *pvParameters);

// Utility functions
double calculateDistance(double lat1, double lng1, double lat2, double lng2);
void configureM8NGPS();
