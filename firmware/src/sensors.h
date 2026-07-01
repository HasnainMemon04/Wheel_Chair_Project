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
    
    float temp_motor;
    float temp_battery;
    float temp_ambient;
    float humidity;
    
    float batt_v;
    int batt_pct;
    bool occupied;
    bool tilt_switch_state;
    bool vibration_state;
    int wifi_rssi;
    
    bool power_state;
    bool locked_state;
    String session_state;
    int time_left_s;
    int speed_limit_kmh;
    bool over_speed;
    
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

// Initialization and FreeRTOS tasks
void initSensors();
void gpsTask(void *pvParameters);
void sensorPollTask(void *pvParameters);
void tempTask(void *pvParameters);

// Utility functions
double calculateDistance(double lat1, double lng1, double lat2, double lng2);
