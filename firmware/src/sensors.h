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

    // Anti-tamper (SW-520D edge counting, armed while LOCKED)
    bool tamper_alarm;       // true = continuous siren latched (4th strike)
    int  tamper_warn_count;  // number of tamper disturbances counted so far

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
extern bool mpuOK;

// Initialization and FreeRTOS tasks
void initSensors();
void gpsTask(void *pvParameters);
void sensorPollTask(void *pvParameters);
void tempTask(void *pvParameters);

// Utility functions
double calculateDistance(double lat1, double lng1, double lat2, double lng2);

// Anti-tamper edge counter (SW-520D). initSensors() attaches the ISR.
// tamperRecentEdges() returns how many switch transitions occurred within
// TAMPER_EDGE_WINDOW_MS; resetTamperEdges() clears the history (call when
// arming, or after consuming a tamper burst).
int  tamperRecentEdges(unsigned long now);
void resetTamperEdges();
// Cumulative count of tilt-switch edges ever recorded (diagnostic).
uint32_t tamperTotalEdges();
