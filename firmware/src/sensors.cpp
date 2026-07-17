#include "sensors.h"
#include "config.h"
#include <Wire.h>
#include <TinyGPS++.h>
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

bool mpuOK = false;

// MPU6500 6-Axis state
static float g_ax = 0, g_ay = 0, g_az = 0;
static float g_gx = 0, g_gy = 0, g_gz = 0;
static float g_pitch_cf = 0, g_roll_cf = 0, g_yaw_cf = 0;

static float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
static float pitchOffset = 0, rollOffset = 0;
static unsigned long lastFusionMicros = 0;

// Direct I2C helper functions for MPU6500
static bool init6Axis() {
    // Wake up MPU & auto select clock source (PLL if ready, else internal oscillator)
    Wire.beginTransmission(0x68);
    Wire.write(0x6B); // PWR_MGMT_1
    Wire.write(0x01); // Clock select Auto/PLL
    if (Wire.endTransmission() != 0) return false;
    delay(10);

    // Configure Digital Low Pass Filter (DLPF) to 41Hz
    // This dramatically filters out high-frequency noise from motors & chassis vibrations
    Wire.beginTransmission(0x68);
    Wire.write(0x1A); // CONFIG
    Wire.write(0x03); // Gyro DLPF = 41Hz
    Wire.endTransmission();

    Wire.beginTransmission(0x68);
    Wire.write(0x1D); // ACCEL_CONFIG_2
    Wire.write(0x03); // Accel DLPF = 41Hz
    Wire.endTransmission();

    // Set Full Scale Ranges to +/-2g and +/-250 deg/s for maximum resolution
    Wire.beginTransmission(0x68);
    Wire.write(0x1C); // ACCEL_CONFIG
    Wire.write(0x00); // 2g Full Scale
    Wire.endTransmission();

    Wire.beginTransmission(0x68);
    Wire.write(0x1B); // GYRO_CONFIG
    Wire.write(0x00); // 250 deg/s Full Scale
    Wire.endTransmission();

    return true;
}

static bool read6Axis(float &ax, float &ay, float &az, float &gx, float &gy, float &gz) {
    Wire.beginTransmission(0x68);
    Wire.write(0x3B); // ACCEL_XOUT_H
    if (Wire.endTransmission(false) != 0) return false;

    Wire.requestFrom(0x68, 14);
    if (Wire.available() < 14) return false;

    int16_t raw_ax = (Wire.read() << 8) | Wire.read();
    int16_t raw_ay = (Wire.read() << 8) | Wire.read();
    int16_t raw_az = (Wire.read() << 8) | Wire.read();
    Wire.read(); Wire.read(); // skip temp
    int16_t raw_gx = (Wire.read() << 8) | Wire.read();
    int16_t raw_gy = (Wire.read() << 8) | Wire.read();
    int16_t raw_gz = (Wire.read() << 8) | Wire.read();

    ax = raw_ax / 16384.0f;
    ay = raw_ay / 16384.0f;
    az = raw_az / 16384.0f;
    gx = raw_gx / 131.0f;
    gy = raw_gy / 131.0f;
    gz = raw_gz / 131.0f;

    return true;
}

OneWire oneWire(ONEWIRE_PIN);
DallasTemperature tempSensors(&oneWire);
bool dsOK = false;
DeviceAddress battAddress;
bool battSensorOK = false;

// Rolling variance tracking for micro-movement motion/vibration estimation
static float smoothAccDiff = 0.0f;
static float lastAccMag = 9.80665f;


void configureM8NGPS() {
    Serial.println("[Sensors] Optimizing NEO-M8N GNSS Settings...");

    // UBX-CFG-NAV5: Set dynamic platform model to Pedestrian (Dynamic Model = 3)
    uint8_t cfg_nav5[] = {
        0xB5, 0x62, 0x06, 0x24, 0x24, 0x00, 0xFF, 0xFF, 0x03, 0x03,
        0x00, 0x00, 0x00, 0x00, 0x10, 0x27, 0x00, 0x00, 0x05, 0x00,
        0xFA, 0x00, 0xFA, 0x00, 0x64, 0x00, 0x2C, 0x01, 0x00, 0x3C,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0xDC
    };
    GPSSerial.write(cfg_nav5, sizeof(cfg_nav5));
    delay(50);

    // UBX-CFG-MSG: Disable GLL (Geographical Position)
    uint8_t disable_gll[] = { 0xB5, 0x62, 0x06, 0x01, 0x08, 0x00, 0xF0, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x1F };
    GPSSerial.write(disable_gll, sizeof(disable_gll));
    delay(50);

    // UBX-CFG-MSG: Disable GSA (DOP & Active Satellites)
    uint8_t disable_gsa[] = { 0xB5, 0x62, 0x06, 0x01, 0x08, 0x00, 0xF0, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x26 };
    GPSSerial.write(disable_gsa, sizeof(disable_gsa));
    delay(50);

    // UBX-CFG-MSG: Disable GSV (Satellites in View - very heavy)
    uint8_t disable_gsv[] = { 0xB5, 0x62, 0x06, 0x01, 0x08, 0x00, 0xF0, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x2D };
    GPSSerial.write(disable_gsv, sizeof(disable_gsv));
    delay(50);

    // UBX-CFG-MSG: Disable VTG (Course over ground & Ground speed)
    uint8_t disable_vtg[] = { 0xB5, 0x62, 0x06, 0x01, 0x08, 0x00, 0xF0, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x3B };
    GPSSerial.write(disable_vtg, sizeof(disable_vtg));
    delay(50);

    // UBX-CFG-MSG: Disable ZDA (Time & Date)
    uint8_t disable_zda[] = { 0xB5, 0x62, 0x06, 0x01, 0x08, 0x00, 0xF0, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x50 };
    GPSSerial.write(disable_zda, sizeof(disable_zda));
    delay(50);

    // UBX-CFG-RATE: Configure Measurement Update Rate to 5Hz (200ms)
    // This provides high-frequency, ultra-responsive speed and position data
    uint8_t cfg_rate_5hz[] = { 0xB5, 0x62, 0x06, 0x08, 0x06, 0x00, 0xC8, 0x00, 0x01, 0x00, 0x01, 0x00, 0xDE, 0x6A };
    GPSSerial.write(cfg_rate_5hz, sizeof(cfg_rate_5hz));
    delay(100);

    Serial.println("[Sensors] NEO-M8N GNSS configured to 5Hz update rate, NMEA optimized.");
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
    sharedTelemetry.pitch = NAN;
    sharedTelemetry.roll = NAN;
    sharedTelemetry.tilt = NAN;
    sharedTelemetry.yaw = NAN;
    sharedTelemetry.temp_battery = NAN;
    sharedTelemetry.batt_v = 3.7;
    sharedTelemetry.batt_pct = 50;
    sharedTelemetry.in_motion = false;
    sharedTelemetry.vibration_state = false;
    sharedTelemetry.tamper_alarm = false;
    sharedTelemetry.tamper_warn_count = 0;
    sharedTelemetry.wifi_rssi = -100;
    sharedTelemetry.power_state = true;
    sharedTelemetry.locked_state = true; // Fail-safe default
    sharedTelemetry.session_state = "LOCKED";
    sharedTelemetry.time_left_s = 0;
    sharedTelemetry.ota_status = "idle";
    sharedTelemetry.ota_progress = 0;
    sharedTelemetry.ota_last_error = "";

    sharedTelemetry.gf.on = true;
    sharedTelemetry.gf.inside = true;
    sharedTelemetry.gf.dist_m = 0.0;
    sharedTelemetry.gf.radius_m = GEOFENCE_RADIUS_M;
    sharedTelemetry.gf.center_lat = 24.860731;
    sharedTelemetry.gf.center_lng = 67.001142;
    xSemaphoreGive(stateMutex);

    // Initialize GPS UART with 1024-byte RX buffer and configure M8N
    GPSSerial.setRxBufferSize(1024);
    GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    Serial.println("[Sensors] GPS Serial initialized.");
    configureM8NGPS();

    // Initialize I2C
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 400000);
    
    // Initialize main MPU6500 chip
    if (init6Axis()) {
        mpuOK = true;
        Serial.println("[Sensors] MPU6500 6-Axis IMU initialized successfully.");
        
        // Run fast Accel/Gyro calibration
        Serial.println("[Sensors] Calibrating gyro/accel offsets...");
        float sumGX = 0, sumGY = 0, sumGZ = 0;
        float sumPitch = 0, sumRoll = 0;
        int count = 0;
        for (int i = 0; i < 150; i++) {
            float ax, ay, az, gx, gy, gz;
            if (read6Axis(ax, ay, az, gx, gy, gz)) {
                float pitchAcc = atan2(ay, sqrt(ax * ax + az * az)) * 180.0 / PI;
                float rollAcc  = atan2(-ax, az) * 180.0 / PI;
                sumGX += gx;
                sumGY += gy;
                sumGZ += gz;
                sumPitch += pitchAcc;
                sumRoll += rollAcc;
                count++;
            }
            delay(10);
        }
        if (count > 0) {
            gyroBiasX = sumGX / count;
            gyroBiasY = sumGY / count;
            gyroBiasZ = sumGZ / count;
            pitchOffset = sumPitch / count;
            rollOffset = sumRoll / count;
        }
        Serial.println("[Sensors] Calibration complete.");
        lastFusionMicros = micros();
    } else {
        mpuOK = false;
        Serial.println("[Sensors] IMU initialization FAILED. Proceeding with mock IMU.");
    }

    // Initialize OneWire DS18B20 (Battery temp probe)
    tempSensors.begin();
    int dsDeviceCount = tempSensors.getDeviceCount();
    if (dsDeviceCount > 0) {
        dsOK = true;
        Serial.printf("[Sensors] Found %d OneWire DS18B20 devices.\n", dsDeviceCount);
        if (tempSensors.getAddress(battAddress, 0)) {
            battSensorOK = true;
            Serial.print("  Battery Temp Sensor address: ");
            for (uint8_t i = 0; i < 8; i++) Serial.printf("%02X", battAddress[i]);
            Serial.println();
        } else {
            Serial.println("[Safety] Battery temp probe NOT FOUND — battery temperature is NOT monitored!");
        }
    } else {
        Serial.println("[Sensors] No OneWire DS18B20 sensors found.");
        Serial.println("[Safety] Battery temp probe NOT FOUND — battery temperature is NOT monitored!");
    }

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
                    if (sharedTelemetry.session_state == "LOCKED" || sharedTelemetry.session_state == "IDLE") {
                        sharedTelemetry.gps_speed_kmh = 0.0f;
                    } else {
                        // Simulate a very slow speed: mostly 0.0 - 0.6 km/h, up to 1.2 km/h
                        float rSpeed = (rand() % 100) / 100.0f; // 0.0 to 1.0
                        if (rSpeed < 0.7f) {
                            // 70% chance of 0.0 to 0.6 km/h
                            sharedTelemetry.gps_speed_kmh = (rand() % 7) / 10.0f;
                        } else {
                            // 30% chance of 0.6 to 1.2 km/h
                            sharedTelemetry.gps_speed_kmh = 0.6f + (rand() % 7) / 10.0f;
                        }
                    }

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

// Complementary/AHRS filter for IMU at 50 Hz
void readIMU() {
    if (!mpuOK) {
        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.pitch = NAN;
        sharedTelemetry.roll = NAN;
        sharedTelemetry.yaw = NAN;
        sharedTelemetry.tilt = NAN;
        sharedTelemetry.vibration_state = false;
        xSemaphoreGive(stateMutex);
        return;
    }

    float ax, ay, az, gx, gy, gz;
    if (read6Axis(ax, ay, az, gx, gy, gz)) {
        float pitchAcc = atan2(ay, sqrt(ax * ax + az * az)) * 180.0 / PI;
        float rollAcc  = atan2(-ax, az) * 180.0 / PI;

        float calGX = gx - gyroBiasX;
        float calGY = gy - gyroBiasY;
        float calGZ = gz - gyroBiasZ;
        float pitchAccCal = pitchAcc - pitchOffset;
        float rollAccCal  = rollAcc  - rollOffset;

        unsigned long nowMicros = micros();
        float dt = (lastFusionMicros == 0) ? 0.02 : (nowMicros - lastFusionMicros) / 1000000.0;
        lastFusionMicros = nowMicros;
        if (dt <= 0 || dt > 0.5) dt = 0.02;

        // Complementary filter for Pitch and Roll
        g_pitch_cf = 0.98f * (g_pitch_cf + calGX * dt) + 0.02f * pitchAccCal;
        g_roll_cf  = 0.98f * (g_roll_cf  + calGY * dt) + 0.02f * rollAccCal;

        // Relative Yaw integration
        g_yaw_cf += calGZ * dt;

        if (g_yaw_cf > 180.0) g_yaw_cf -= 360.0;
        if (g_yaw_cf < -180.0) g_yaw_cf += 360.0;

        // Convert acceleration from G to m/s^2
        float accX = ax * 9.80665f;
        float accY = ay * 9.80665f;
        float accZ = az * 9.80665f;
        float gyroMaxRate = max(abs(gx), max(abs(gy), abs(gz)));

        float gMag = sqrt(accX * accX + accY * accY + accZ * accZ);
        float tiltAngle = 0.0f;
        if (gMag > 0.0f) {
            float val = accZ / gMag;
            if (val > 1.0f) val = 1.0f;
            else if (val < -1.0f) val = -1.0f;
            tiltAngle = acos(val) * 180.0f / PI;
        }

        // Vibration/Shock Detection (accelerometer deviation from 1G gravity)
        float accelDev = abs(gMag - 9.80665f);
        bool rawMotion = (accelDev >= TAMPER_MPU_ACCEL_THRESH || gyroMaxRate >= TAMPER_MPU_GYRO_THRESH);
        
        static int motionDebounceCount = 0;
        bool imuMotionDetected = false;
        if (rawMotion) {
            motionDebounceCount++;
            if (motionDebounceCount >= 5) { // 5 consecutive samples at 50 Hz = 100 ms of sustained vibration/rotation
                imuMotionDetected = true;
                motionDebounceCount = 5; // cap to prevent overflow
            }
        } else {
            motionDebounceCount = 0;
        }

        // Motion/vibration estimation via micro-movements
        float accDiff = abs(gMag - lastAccMag);
        lastAccMag = gMag;
        smoothAccDiff = 0.95f * smoothAccDiff + 0.05f * accDiff;

        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.pitch = g_pitch_cf;
        sharedTelemetry.roll = g_roll_cf;
        sharedTelemetry.yaw = g_yaw_cf;
        sharedTelemetry.tilt = tiltAngle;
        sharedTelemetry.vibration_state = imuMotionDetected;
        xSemaphoreGive(stateMutex);
    }
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

            // Read battery ADC pin (GPIO 1) with 16-sample averaging
            long sum = 0;
            for (int i = 0; i < 16; i++) {
                sum += analogRead(BATT_ADC_PIN);
                delayMicroseconds(200);
            }
            int raw = sum / 16;

            float v_adc = raw * 3.3f / 4095.0f;
            float v_batt_real = v_adc * 11.0f; // (100k + 10k) / 10k divider = 11

            float pct_real = (v_batt_real - 21.0f) / (29.4f - 21.0f) * 100.0f;
            pct_real = constrain(pct_real, 0.0f, 100.0f);

            float battV = v_batt_real;
            int battPct = (int)pct_real;

            // Fallback simulation if no physical battery is connected (pin voltage near 0 or floating < 21V empty limit)
            if (v_batt_real < 21.0f) {
                int simPct = 98 - (int)(millis() / 360000);
                if (simPct < 0) simPct = 0;
                battPct = simPct;
                battV = 21.0f + (simPct / 100.0f) * (29.4f - 21.0f);
            }

            xSemaphoreTake(stateMutex, portMAX_DELAY);
            float currentSpeed = sharedTelemetry.gps_speed_kmh;
            xSemaphoreGive(stateMutex);

            // Smart In-Motion detection: True if moving OR significant vibrations
            bool isMoving = (currentSpeed > 0.5f) || (smoothAccDiff > 0.08f);

            xSemaphoreTake(stateMutex, portMAX_DELAY);
            sharedTelemetry.in_motion = isMoving;
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
        float battT = NAN;

        // DS18B20 waterproof battery sensor
        if (dsOK) {
            tempSensors.requestTemperatures();

            if (battSensorOK) {
                float tBatt = tempSensors.getTempC(battAddress);
                if (tBatt != DEVICE_DISCONNECTED_C) {
                    battT = tBatt;
                } else {
                    battSensorOK = false;
                    Serial.println("[Safety] Battery temp probe disconnected at runtime!");
                }
            }
        }

        xSemaphoreTake(stateMutex, portMAX_DELAY);
        sharedTelemetry.temp_battery = battT;
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
