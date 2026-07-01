#include "sensors.h"
#include "config.h"
#include <TinyGPS++.h>
#include <Adafruit_MPU6050.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <math.h>
#include <stdlib.h>

// Global structures
TelemetryData sharedTelemetry;
SemaphoreHandle_t stateMutex = NULL;

// Drivers
HardwareSerial GPSSerial(1);
TinyGPSPlus gps;

Adafruit_MPU6050 mpu;
bool mpuOK = false;

DHT dht(DHT_PIN, DHT_TYPE);
bool dhtOK = false;

OneWire oneWire(ONEWIRE_PIN);
DallasTemperature tempSensors(&oneWire);
bool dsOK = false;
DeviceAddress motorAddress, battAddress;

// Complementary filter variables
const float alpha = 0.96f;
float filterPitch = 0.0f;
float filterRoll = 0.0f;
unsigned long lastIMUTime = 0;

// ---------------- Anti-tamper edge counter (SW-520D) ----------------
// Ring buffer of recent tilt-switch edge timestamps, filled by the ISR.
// Ported from hardware_test_lab/tamper_detection_sw520d.ino.
static volatile unsigned long tamperEdgeTimestamps[TAMPER_MAX_EDGE_BUFFER];
static volatile int tamperEdgeHead = 0;
static volatile int tamperEdgeCountTotal = 0;
static volatile uint32_t tamperEdgeCountEver = 0; // diagnostic, never reset
static volatile unsigned long tamperLastEdgeMillis = 0;

void IRAM_ATTR onTiltSwitchChange() {
    unsigned long now = millis();
    // Minimal debounce: filters only true electrical contact chatter (<15ms),
    // NOT the real mechanical bounce produced by genuine shaking/movement.
    if (now - tamperLastEdgeMillis >= TAMPER_EDGE_DEBOUNCE_MS) {
        tamperEdgeTimestamps[tamperEdgeHead] = now;
        tamperEdgeHead = (tamperEdgeHead + 1) % TAMPER_MAX_EDGE_BUFFER;
        tamperEdgeCountTotal++;
        tamperEdgeCountEver++;
        tamperLastEdgeMillis = now;
    }
}

// Count how many recorded edges fall within the last TAMPER_EDGE_WINDOW_MS.
int tamperRecentEdges(unsigned long now) {
    int count = 0;
    noInterrupts();
    int total = tamperEdgeCountTotal;
    int samples = total < TAMPER_MAX_EDGE_BUFFER ? total : TAMPER_MAX_EDGE_BUFFER;
    int idx = tamperEdgeHead;
    unsigned long snapshot[TAMPER_MAX_EDGE_BUFFER];
    for (int i = 0; i < samples; i++) {
        idx = (idx - 1 + TAMPER_MAX_EDGE_BUFFER) % TAMPER_MAX_EDGE_BUFFER;
        snapshot[i] = tamperEdgeTimestamps[idx];
    }
    interrupts();

    for (int i = 0; i < samples; i++) {
        if (now - snapshot[i] <= TAMPER_EDGE_WINDOW_MS) {
            count++;
        } else {
            break; // timestamps are in descending recency order
        }
    }
    return count;
}

// Clear edge history so stale bumps can't trip a fresh alert (call on arm).
void resetTamperEdges() {
    noInterrupts();
    tamperEdgeCountTotal = 0;
    tamperEdgeHead = 0;
    interrupts();
}

// Cumulative edge count that is never reset (diagnostic: proves the ISR fires).
uint32_t tamperTotalEdges() {
    noInterrupts();
    uint32_t v = tamperEdgeCountEver;
    interrupts();
    return v;
}

void initSensors() {
    stateMutex = xSemaphoreCreateMutex();
    
    // Initialize default states
    xSemaphoreTake(stateMutex, portMAX_DELAY);
    sharedTelemetry.uptime_s = 0;
    sharedTelemetry.gps_fix = false;
    sharedTelemetry.gps_lat = 0.0;
    sharedTelemetry.gps_lng = 0.0;
    sharedTelemetry.gps_speed_kmh = 0.0;
    sharedTelemetry.gps_sats = 0;
    sharedTelemetry.gps_hdop = 99.0;
    sharedTelemetry.pitch = 0.0;
    sharedTelemetry.roll = 0.0;
    sharedTelemetry.tilt = 0.0;
    sharedTelemetry.temp_motor = 25.0;
    sharedTelemetry.temp_battery = 25.0;
    sharedTelemetry.temp_ambient = 25.0;
    sharedTelemetry.humidity = 50.0;
    sharedTelemetry.batt_v = 3.7;
    sharedTelemetry.batt_pct = 50;
    sharedTelemetry.occupied = false;
    sharedTelemetry.tilt_switch_state = false;
    sharedTelemetry.vibration_state = false;
    sharedTelemetry.tamper_alarm = false;
    sharedTelemetry.tamper_warn_count = 0;
    sharedTelemetry.wifi_rssi = -100;
    sharedTelemetry.power_state = true;
    sharedTelemetry.locked_state = true; // Fail-safe default
    sharedTelemetry.session_state = "LOCKED";
    sharedTelemetry.time_left_s = 0;
    sharedTelemetry.speed_limit_kmh = SPEED_LIMIT_KMH;
    sharedTelemetry.over_speed = false;
    
    sharedTelemetry.gf.on = true;
    sharedTelemetry.gf.inside = true;
    sharedTelemetry.gf.dist_m = 0.0;
    sharedTelemetry.gf.radius_m = GEOFENCE_RADIUS_M;
    sharedTelemetry.gf.center_lat = 24.860731;
    sharedTelemetry.gf.center_lng = 67.001142;
    xSemaphoreGive(stateMutex);

    // Initialize GPS UART
    GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    Serial.println("[Sensors] GPS Serial initialized.");

    // Initialize I2C and MPU6050
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 400000);
    if (mpu.begin(MPU6050_ADDR, &Wire)) {
        mpuOK = true;
        mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
        mpu.setGyroRange(MPU6050_RANGE_250_DEG);
        mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
        lastIMUTime = millis();
        Serial.println("[Sensors] MPU6050 initialized.");
    } else {
        Serial.println("[Sensors] MPU6050 initialization FAILED. Proceeding with mock IMU.");
    }

    // Initialize DHT22 with retries
    dht.begin();
    for (int retry = 0; retry < 5; retry++) {
        delay(500); // DHT22 requires power-on stabilization delay
        float tempTest = dht.readTemperature();
        if (!isnan(tempTest)) {
            dhtOK = true;
            Serial.printf("[Sensors] DHT22 initialized on attempt %d.\n", retry + 1);
            break;
        }
    }
    if (!dhtOK) {
        Serial.println("[Sensors] DHT22 check FAILED. Proceeding with mock DHT.");
    }

    // Initialize OneWire DS18B20
    tempSensors.begin();
    int dsDeviceCount = tempSensors.getDeviceCount();
    if (dsDeviceCount > 0) {
        dsOK = true;
        Serial.printf("[Sensors] Found %d OneWire DS18B20 devices.\n", dsDeviceCount);
        
        // Search and assign addresses (index 0 = Motor, index 1 = Battery)
        if (tempSensors.getAddress(motorAddress, 0)) {
            Serial.print("  Motor Temp Sensor address: ");
            for (uint8_t i = 0; i < 8; i++) Serial.printf("%02X", motorAddress[i]);
            Serial.println();
        }
        if (dsDeviceCount > 1 && tempSensors.getAddress(battAddress, 1)) {
            Serial.print("  Battery Temp Sensor address: ");
            for (uint8_t i = 0; i < 8; i++) Serial.printf("%02X", battAddress[i]);
            Serial.println();
        }
    } else {
        Serial.println("[Sensors] No OneWire DS18B20 sensors found. Proceeding with mock temps.");
    }

    // Pin Modes
    pinMode(TILT_SWITCH_PIN, INPUT_PULLUP);
    // Attach the anti-tamper edge-counting ISR to the SW-520D tilt switch.
    // The same pin is still polled (debounced) in sensorPollTask for the fall
    // backup; the interrupt just additionally records edges for tamper bursts.
    attachInterrupt(digitalPinToInterrupt(TILT_SWITCH_PIN), onTiltSwitchChange, CHANGE);
    resetTamperEdges();
    // ADC pins do not strictly require pinMode, but we set them
    pinMode(BATT_ADC_PIN, INPUT);
}

// GPS task: Continuous read, parse NMEA
void gpsTask(void *pvParameters) {
    Serial.println("[Tasks] GPS Task started.");
    
    // GPS simulation variables
    unsigned long lastSimulateTime = 0;
    double simLat = 24.860048;
    double simLng = 67.063734;

    // Track when we last saw a VALID hardware fix. If the real GPS goes silent or loses
    // its fix for longer than this, we clear gps_fix so simulation resumes (fixes the
    // "stuck on last real coordinate after GPS desync" bug).
    unsigned long lastHardwareFixTime = 0;
    const unsigned long GPS_FIX_TIMEOUT_MS = 10000; // 10s without a valid fix => lost

    while (true) {
        while (GPSSerial.available() > 0) {
            gps.encode(GPSSerial.read());
        }

        bool hasHardwareFix = false;

        if (gps.location.isUpdated()) {
            if (gps.location.isValid()) {
                hasHardwareFix = true;
                lastHardwareFixTime = millis();
                double lat = gps.location.lat();
                double lng = gps.location.lng();
                
                xSemaphoreTake(stateMutex, portMAX_DELAY);
                sharedTelemetry.gps_fix = true;
                sharedTelemetry.gps_lat = lat;
                sharedTelemetry.gps_lng = lng;
                sharedTelemetry.gps_speed_kmh = gps.speed.kmph();
                sharedTelemetry.gps_sats = gps.satellites.value();
                sharedTelemetry.gps_hdop = gps.hdop.hdop();
                
                // Calculate geofence distance locally
                if (sharedTelemetry.gf.on) {
                    double dist = calculateDistance(lat, lng, sharedTelemetry.gf.center_lat, sharedTelemetry.gf.center_lng);
                    sharedTelemetry.gf.dist_m = dist;
                    sharedTelemetry.gf.inside = (dist <= sharedTelemetry.gf.radius_m);
                }
                xSemaphoreGive(stateMutex);
            }
        }

        // If we currently believe we have a fix but haven't seen a valid one recently,
        // declare the fix lost so the simulation path below can take over again.
        if (!hasHardwareFix) {
            bool fixExpired = false;
            xSemaphoreTake(stateMutex, portMAX_DELAY);
            if (sharedTelemetry.gps_fix &&
                (lastHardwareFixTime == 0 || (millis() - lastHardwareFixTime) > GPS_FIX_TIMEOUT_MS)) {
                sharedTelemetry.gps_fix = false;
                fixExpired = true;
            }
            xSemaphoreGive(stateMutex);
            if (fixExpired) {
                Serial.println("[Sensors] GPS fix lost (timeout). Resuming simulated location.");
                // Seed the simulator from the last known real position for a smooth handover.
                xSemaphoreTake(stateMutex, portMAX_DELAY);
                simLat = sharedTelemetry.gps_lat;
                simLng = sharedTelemetry.gps_lng;
                xSemaphoreGive(stateMutex);
                lastSimulateTime = 0; // force an immediate simulated update
            }
        }

        // If no hardware fix, simulate coordinates with random micro-movements every 5 seconds
        if (!hasHardwareFix) {
            unsigned long now = millis();
            if (now - lastSimulateTime >= 5000) {
                lastSimulateTime = now;
                
                // Generate a random step (between 0.1 to 1.0 meters displacement)
                // 1 meter = 0.000009 degrees.
                float latOffsetMeters = ((rand() % 200) - 100) / 100.0f; // -1.0 to 1.0
                float lngOffsetMeters = ((rand() % 200) - 100) / 100.0f; // -1.0 to 1.0
                
                simLat += latOffsetMeters * 0.000009;
                simLng += lngOffsetMeters * 0.000009;
                
                xSemaphoreTake(stateMutex, portMAX_DELAY);
                // Only write if a real hardware fix hasn't taken over in the meantime
                if (!sharedTelemetry.gps_fix) {
                    sharedTelemetry.gps_lat = simLat;
                    sharedTelemetry.gps_lng = simLng;
                    // Simulate a slow speed (e.g. 1.2 to 2.4 kmh) if moving, or 0 if stationary
                    sharedTelemetry.gps_speed_kmh = 1.2 + (rand() % 12) / 10.0f; 
                    sharedTelemetry.gps_sats = 8;
                    sharedTelemetry.gps_hdop = 1.1;
                    
                    // Calculate geofence distance locally
                    if (sharedTelemetry.gf.on) {
                        double dist = calculateDistance(simLat, simLng, sharedTelemetry.gf.center_lat, sharedTelemetry.gf.center_lng);
                        sharedTelemetry.gf.dist_m = dist;
                        sharedTelemetry.gf.inside = (dist <= sharedTelemetry.gf.radius_m);
                    }
                }
                xSemaphoreGive(stateMutex);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

// Complementary filter for IMU at 50 Hz
void readIMU() {
    if (!mpuOK) {
        // Simulated slow tilt change for mock/bench testing
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.pitch = 0.5f * sin(millis() / 5000.0f);
        sharedTelemetry.roll = 0.5f * cos(millis() / 5000.0f);
        sharedTelemetry.tilt = sqrt(sharedTelemetry.pitch * sharedTelemetry.pitch + sharedTelemetry.roll * sharedTelemetry.roll);
        xSemaphoreGive(stateMutex);
        return;
    }

    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    unsigned long now = millis();
    float dt = (now - lastIMUTime) / 1000.0f;
    lastIMUTime = now;
    if (dt <= 0.0f || dt > 0.5f) dt = 0.02f;

    // Calculate angles from accel
    float accPitch = atan2(a.acceleration.y, sqrt(a.acceleration.x * a.acceleration.x + a.acceleration.z * a.acceleration.z)) * 180.0f / PI;
    float accRoll = atan2(-a.acceleration.x, sqrt(a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z)) * 180.0f / PI;

    // Convert gyro rate to deg/s (MPU6050 returns rad/s)
    float gyroPitchRate = g.gyro.x * 180.0f / PI;
    float gyroRollRate = g.gyro.y * 180.0f / PI;
    float gyroYawRate = g.gyro.z * 180.0f / PI;
    float gyroMaxRate = max(abs(gyroPitchRate), max(abs(gyroRollRate), abs(gyroYawRate)));

    // Complementary filter
    filterPitch = alpha * (filterPitch + gyroPitchRate * dt) + (1.0f - alpha) * accPitch;
    filterRoll = alpha * (filterRoll + gyroRollRate * dt) + (1.0f - alpha) * accRoll;

    // Calculate total tilt from vertical
    float gMag = sqrt(a.acceleration.x * a.acceleration.x + a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z);
    float tiltAngle = 0.0f;
    if (gMag > 0.0f) {
        float val = a.acceleration.z / gMag;
        if (val > 1.0f) val = 1.0f;
        else if (val < -1.0f) val = -1.0f;
        tiltAngle = acos(val) * 180.0f / PI;
    }

    // Accelerometer magnitude deviation from gravity (approx 9.80665 m/s^2)
    float accelDev = abs(gMag - 9.80665f);
    bool imuMotionDetected = false;
    if (mpuOK) {
        if (accelDev >= TAMPER_MPU_ACCEL_THRESH || gyroMaxRate >= TAMPER_MPU_GYRO_THRESH) {
            imuMotionDetected = true;
        }
    }

    xSemaphoreTake(stateMutex, portMAX_DELAY);
    sharedTelemetry.pitch = filterPitch;
    sharedTelemetry.roll = filterRoll;
    sharedTelemetry.tilt = tiltAngle;
    sharedTelemetry.vibration_state = imuMotionDetected;
    xSemaphoreGive(stateMutex);
}

// 20 Hz poll task (IMU + Analog + Switches)
void sensorPollTask(void *pvParameters) {
    TickType_t lastWakeTime = xTaskGetTickCount();
    uint32_t loopCount = 0;
    Serial.println("[Tasks] Sensor Poll Task (50Hz/20Hz) started.");

    while (true) {
        // Read IMU at 50 Hz (every cycle)
        readIMU();

        // Read other inputs at 20 Hz (every 2.5 cycles, approx 50 ms)
        if (++loopCount >= 2) {
            loopCount = 0;

            // Simulate realistic battery discharge without hardware (drop 1% every 6 minutes)
            int battPct = 98 - (int)(millis() / 360000);
            if (battPct < 0) battPct = 0;
            float battV = 3.2f + (battPct / 100.0f) * (4.2f - 3.2f);

            static int tiltSwDebounceTicks = 0;
            bool tiltSw = false;
            bool rawTiltSw = (digitalRead(TILT_SWITCH_PIN) == HIGH); // HIGH = Tilted (active/open), LOW = Upright (idle/closed)
            if (rawTiltSw) {
                tiltSwDebounceTicks++;
                if (tiltSwDebounceTicks >= 4) { // ~200ms at 20Hz
                    tiltSw = true;
                }
            } else {
                tiltSwDebounceTicks = 0;
                tiltSw = false;
            }

            xSemaphoreTake(stateMutex, portMAX_DELAY);
            sharedTelemetry.occupied = false; // FSR seat sensor removed
            sharedTelemetry.tilt_switch_state = tiltSw;
            // sharedTelemetry.vibration_state is set dynamically inside readIMU() at 50Hz
            sharedTelemetry.batt_v = battV;
            sharedTelemetry.batt_pct = battPct;
            sharedTelemetry.uptime_s = millis() / 1000;
            xSemaphoreGive(stateMutex);
        }

        vTaskDelayUntil(&lastWakeTime, pdMS_TO_TICKS(20)); // Exact 50 Hz period
    }
}

// 0.5 Hz temperature poll task (runs every 2000 ms)
void tempTask(void *pvParameters) {
    Serial.println("[Tasks] Temperature Task (0.5Hz) started.");
    while (true) {
        float motorT = 25.0f;
        float battT = 25.0f;
        float ambT = 25.0f;
        float humVal = 50.0f;

        // DS18B20 waterproof sensors
        if (dsOK) {
            tempSensors.requestTemperatures();
            float tMotor = tempSensors.getTempC(motorAddress);
            if (tMotor != DEVICE_DISCONNECTED_C) {
                motorT = tMotor;
            }
            float tBatt = tempSensors.getTempC(battAddress);
            if (tBatt != DEVICE_DISCONNECTED_C) {
                battT = tBatt;
            } else {
                // If only one sensor is connected, default battery to ambient/safe
                battT = motorT; 
            }
        }

        // DHT22 ambient sensor
        if (dhtOK) {
            float tAmb = dht.readTemperature();
            float hAmb = dht.readHumidity();
            if (!isnan(tAmb)) ambT = tAmb;
            if (!isnan(hAmb)) humVal = hAmb;
        }

        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.temp_motor = motorT;
        sharedTelemetry.temp_battery = battT;
        sharedTelemetry.temp_ambient = ambT;
        sharedTelemetry.humidity = humVal;
        xSemaphoreGive(stateMutex);

        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

// Haversine distance calculation in meters
double calculateDistance(double lat1, double lng1, double lat2, double lng2) {
    double dLat = (lat2 - lat1) * PI / 180.0;
    double dLng = (lng2 - lng1) * PI / 180.0;
    double a = sin(dLat/2) * sin(dLat/2) +
               cos(lat1 * PI / 180.0) * cos(lat2 * PI / 180.0) *
               sin(dLng/2) * sin(dLng/2);
    double c = 2 * atan2(sqrt(a), sqrt(1-a));
    return 6371000.0 * c;
}
