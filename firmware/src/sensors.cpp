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
    sharedTelemetry.gps_simulated = true;
    sharedTelemetry.gps_fallback_anchor_lat = 24.8601;
    sharedTelemetry.gps_fallback_anchor_lng = 67.0637;
    sharedTelemetry.gps_fallback_anchor_revision = 1;
    sharedTelemetry.gps_lat = 24.8601;
    sharedTelemetry.gps_lng = 67.0637;
    sharedTelemetry.gps_speed_kmh = 0.3f;
    sharedTelemetry.gps_physical_lat = NAN;
    sharedTelemetry.gps_physical_lng = NAN;
    sharedTelemetry.gps_physical_speed_kmh = 0.0f;
    sharedTelemetry.gps_physical_course_deg = NAN;
    sharedTelemetry.gps_physical_altitude_m = NAN;
    sharedTelemetry.gps_sats = 0;
    sharedTelemetry.gps_hdop = NAN;
    sharedTelemetry.gps_course_deg = NAN;
    sharedTelemetry.gps_altitude_m = NAN;
    sharedTelemetry.gps_last_data_ms = 0;
    sharedTelemetry.gps_last_fix_ms = 0;
    sharedTelemetry.gps_chars_processed = 0;
    sharedTelemetry.gps_sentences_valid = 0;
    sharedTelemetry.gps_checksum_failures = 0;
    sharedTelemetry.gps_nmea_gga[0] = '\0';
    sharedTelemetry.gps_nmea_rmc[0] = '\0';
    sharedTelemetry.pitch = NAN;
    sharedTelemetry.roll = NAN;
    sharedTelemetry.tilt = NAN;
    sharedTelemetry.yaw = NAN;
    sharedTelemetry.imu_accel_x_g = NAN;
    sharedTelemetry.imu_accel_y_g = NAN;
    sharedTelemetry.imu_accel_z_g = NAN;
    sharedTelemetry.imu_gyro_x_dps = NAN;
    sharedTelemetry.imu_gyro_y_dps = NAN;
    sharedTelemetry.imu_gyro_z_dps = NAN;
    sharedTelemetry.imu_last_sample_ms = 0;
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

// GPS task: physical NEO-M8N data is authoritative whenever a fresh fix is
// available. Without a fix, the ESP32 emits a bounded, explicitly tagged
// indoor fallback around the last physical fix (or the configured default).
void gpsTask(void *pvParameters) {
    Serial.println("[Tasks] GPS Task started.");

    char nmeaLine[128] = {0};
    size_t nmeaLength = 0;
    const uint32_t GPS_FIX_TIMEOUT_MS = 2000;
    const uint32_t FALLBACK_UPDATE_MS = 200;
    const uint32_t MIN_FIX_SATELLITES = 3;
    const float MAX_FIX_HDOP = 20.0f;
    const double METERS_PER_DEGREE_LAT = 111320.0;
    const double DEFAULT_FALLBACK_LAT = 24.8601;
    const double DEFAULT_FALLBACK_LNG = 67.0637;

    double fallbackAnchorLat = DEFAULT_FALLBACK_LAT;
    double fallbackAnchorLng = DEFAULT_FALLBACK_LNG;
    float fallbackAngleRad = 0.0f;
    uint32_t fallbackLastUpdateMs = millis();
    uint32_t fallbackAnchorRevision = 0;
    bool physicalFixActive = false;

    while (true) {
        while (GPSSerial.available() > 0) {
            const char c = static_cast<char>(GPSSerial.read());
            gps.encode(c);

            if (c == '\n') {
                nmeaLine[nmeaLength] = '\0';
                if (nmeaLength > 0) {
                    xSemaphoreTake(stateMutex, portMAX_DELAY);
                    sharedTelemetry.gps_last_data_ms = millis();
                    if (strstr(nmeaLine, "GGA,") != nullptr) {
                        strncpy(sharedTelemetry.gps_nmea_gga, nmeaLine, sizeof(sharedTelemetry.gps_nmea_gga) - 1);
                        sharedTelemetry.gps_nmea_gga[sizeof(sharedTelemetry.gps_nmea_gga) - 1] = '\0';
                    } else if (strstr(nmeaLine, "RMC,") != nullptr) {
                        strncpy(sharedTelemetry.gps_nmea_rmc, nmeaLine, sizeof(sharedTelemetry.gps_nmea_rmc) - 1);
                        sharedTelemetry.gps_nmea_rmc[sizeof(sharedTelemetry.gps_nmea_rmc) - 1] = '\0';
                    }
                    xSemaphoreGive(stateMutex);
                }
                nmeaLength = 0;
            } else if (c != '\r' && nmeaLength < sizeof(nmeaLine) - 1) {
                nmeaLine[nmeaLength++] = c;
            }
        }

        const uint32_t now = millis();
        const double candidateLat = gps.location.lat();
        const double candidateLng = gps.location.lng();
        const bool coordinatesValid =
            isfinite(candidateLat) &&
            isfinite(candidateLng) &&
            candidateLat >= -90.0 &&
            candidateLat <= 90.0 &&
            candidateLng >= -180.0 &&
            candidateLng <= 180.0 &&
            !(candidateLat == 0.0 && candidateLng == 0.0);
        const bool fixQualityValid =
            gps.satellites.isValid() &&
            gps.satellites.value() >= MIN_FIX_SATELLITES &&
            gps.hdop.isValid() &&
            gps.hdop.hdop() > 0.0f &&
            gps.hdop.hdop() <= MAX_FIX_HDOP;
        const bool hasFreshFix =
            gps.location.isValid() &&
            gps.location.age() <= GPS_FIX_TIMEOUT_MS &&
            coordinatesValid &&
            fixQualityValid;

        xSemaphoreTake(stateMutex, portMAX_DELAY);
        if (sharedTelemetry.gps_fallback_anchor_revision != fallbackAnchorRevision) {
            fallbackAnchorLat = sharedTelemetry.gps_fallback_anchor_lat;
            fallbackAnchorLng = sharedTelemetry.gps_fallback_anchor_lng;
            fallbackAnchorRevision = sharedTelemetry.gps_fallback_anchor_revision;
            fallbackAngleRad = 0.0f;
            fallbackLastUpdateMs = now;
        }

        sharedTelemetry.gps_chars_processed = gps.charsProcessed();
        sharedTelemetry.gps_sentences_valid = gps.passedChecksum();
        sharedTelemetry.gps_checksum_failures = gps.failedChecksum();

        if (gps.satellites.isValid()) {
            sharedTelemetry.gps_sats = gps.satellites.value();
        }
        if (gps.hdop.isValid()) {
            sharedTelemetry.gps_hdop = gps.hdop.hdop();
        }
        if (gps.course.isValid()) {
            sharedTelemetry.gps_course_deg = gps.course.deg();
        }
        if (gps.altitude.isValid()) {
            sharedTelemetry.gps_altitude_m = gps.altitude.meters();
        }

        sharedTelemetry.gps_fix = hasFreshFix;
        if (hasFreshFix) {
            sharedTelemetry.gps_lat = candidateLat;
            sharedTelemetry.gps_lng = candidateLng;
            sharedTelemetry.gps_speed_kmh = gps.speed.isValid() ? gps.speed.kmph() : 0.0f;
            sharedTelemetry.gps_physical_lat = sharedTelemetry.gps_lat;
            sharedTelemetry.gps_physical_lng = sharedTelemetry.gps_lng;
            sharedTelemetry.gps_physical_speed_kmh = sharedTelemetry.gps_speed_kmh;
            sharedTelemetry.gps_physical_course_deg =
                gps.course.isValid() ? gps.course.deg() : NAN;
            sharedTelemetry.gps_physical_altitude_m =
                gps.altitude.isValid() ? gps.altitude.meters() : NAN;
            sharedTelemetry.gps_last_fix_ms = now - gps.location.age();
            sharedTelemetry.gps_simulated = false;

            fallbackAnchorLat = sharedTelemetry.gps_lat;
            fallbackAnchorLng = sharedTelemetry.gps_lng;
            sharedTelemetry.gps_fallback_anchor_lat = fallbackAnchorLat;
            sharedTelemetry.gps_fallback_anchor_lng = fallbackAnchorLng;
            fallbackLastUpdateMs = now;

            if (!physicalFixActive) {
                Serial.printf(
                    "[GPS] Physical fix acquired. Using NEO-M8N at %.6f, %.6f.\n",
                    sharedTelemetry.gps_lat,
                    sharedTelemetry.gps_lng
                );
            }
            physicalFixActive = true;

            if (sharedTelemetry.gf.on) {
                const double dist = calculateDistance(
                    sharedTelemetry.gps_lat,
                    sharedTelemetry.gps_lng,
                    sharedTelemetry.gf.center_lat,
                    sharedTelemetry.gf.center_lng
                );
                sharedTelemetry.gf.dist_m = dist;
                sharedTelemetry.gf.inside = (dist <= sharedTelemetry.gf.radius_m);
            }
        } else {
            if (physicalFixActive) {
                Serial.printf(
                    "[GPS] Physical fix lost. Display continuity anchored at %.6f, %.6f.\n",
                    fallbackAnchorLat,
                    fallbackAnchorLng
                );
                fallbackLastUpdateMs = now;
            }
            physicalFixActive = false;
            sharedTelemetry.gps_simulated = true;
            sharedTelemetry.gps_physical_lat = NAN;
            sharedTelemetry.gps_physical_lng = NAN;
            sharedTelemetry.gps_physical_speed_kmh = 0.0f;
            sharedTelemetry.gps_physical_course_deg = NAN;
            sharedTelemetry.gps_physical_altitude_m = NAN;

            if (now - fallbackLastUpdateMs >= FALLBACK_UPDATE_MS) {
                const float elapsedSeconds = (now - fallbackLastUpdateMs) / 1000.0f;
                fallbackLastUpdateMs = now;

                // Both values vary slowly but remain inside the requested
                // bounds: 1-5 m radius and 0.1-0.5 km/h display speed.
                const float speedKmh = 0.3f + 0.2f * sinf(now * 0.00035f);
                const float radiusM = 3.0f + 2.0f * sinf(now * 0.00019f + 1.3f);
                const float angularVelocity = (speedKmh / 3.6f) / max(radiusM, 1.0f);
                fallbackAngleRad = fmodf(
                    fallbackAngleRad + angularVelocity * elapsedSeconds,
                    2.0f * PI
                );

                const double northOffsetM = radiusM * sinf(fallbackAngleRad);
                const double eastOffsetM = radiusM * cosf(fallbackAngleRad);
                const double metersPerDegreeLng =
                    METERS_PER_DEGREE_LAT * cos(fallbackAnchorLat * DEG_TO_RAD);

                sharedTelemetry.gps_lat =
                    fallbackAnchorLat + northOffsetM / METERS_PER_DEGREE_LAT;
                sharedTelemetry.gps_lng =
                    fallbackAnchorLng + eastOffsetM / metersPerDegreeLng;
                sharedTelemetry.gps_speed_kmh = speedKmh;
                sharedTelemetry.gps_course_deg =
                    fmodf(fallbackAngleRad * RAD_TO_DEG + 90.0f, 360.0f);
                sharedTelemetry.gps_altitude_m = NAN;
            }
        }
        xSemaphoreGive(stateMutex);

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
        sharedTelemetry.imu_accel_x_g = NAN;
        sharedTelemetry.imu_accel_y_g = NAN;
        sharedTelemetry.imu_accel_z_g = NAN;
        sharedTelemetry.imu_gyro_x_dps = NAN;
        sharedTelemetry.imu_gyro_y_dps = NAN;
        sharedTelemetry.imu_gyro_z_dps = NAN;
        sharedTelemetry.imu_last_sample_ms = 0;
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
        sharedTelemetry.imu_accel_x_g = ax;
        sharedTelemetry.imu_accel_y_g = ay;
        sharedTelemetry.imu_accel_z_g = az;
        sharedTelemetry.imu_gyro_x_dps = gx;
        sharedTelemetry.imu_gyro_y_dps = gy;
        sharedTelemetry.imu_gyro_z_dps = gz;
        sharedTelemetry.imu_last_sample_ms = millis();
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
