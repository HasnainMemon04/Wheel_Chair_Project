/*
  =====================================================================
  GY-521 (MPU6050) Motion Dashboard — Async WebSocket Edition
  =====================================================================
  Real-time 3D wheelchair visualization, driven by a live WebSocket
  stream instead of HTTP polling. This eliminates the periodic
  stutter/freeze you'd get from a synchronous WebServer + fetch()
  polling + String-concatenated JSON (heap fragmentation).

  NEW in this version:
    - WebSocket streaming (~50Hz push, no polling, no blocking)
    - Calibrate button: hold the chair level & still, tap it, and
      the firmware zeroes out gyro drift + resets current tilt as
      the new "level" reference (0° pitch/roll/yaw)
    - JSON built into a fixed char buffer (no String concatenation)
      to avoid heap fragmentation over long runtimes

  REQUIRED LIBRARIES (Library Manager -> search these exact names):
    - "ESPAsyncWebServer" (by ESP32Async)
    - "AsyncTCP"          (by ESP32Async)

  Wiring (unchanged):
    GY-521 VCC -> 3.3V     GY-521 GND -> GND
    GY-521 SCL -> GPIO 22  GY-521 SDA -> GPIO 21
    Buzzer +   -> GPIO 13  Buzzer -   -> GND

  WiFi:
    Connect to "ESP32-Wheelchair" (password below), open
    http://192.168.4.1

  Sensor fusion:
    Pitch & Roll = complementary filter (98% gyro, 2% accel) ->
    smooth AND drift-free. Yaw = pure gyro integration -> will
    still slowly drift over long sessions since there's no
    magnetometer on this board (hardware limitation).

  Tilt alarm:
    |pitch| or |roll| > TILT_THRESHOLD_DEG -> buzzer fast-beeps.

  IMPORTANT — buzzer type:
    Assumes active buzzer, HIGH = ON. Flip BUZZER_ACTIVE_LOW if
    yours is active-LOW.
  =====================================================================
*/

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>

// ---------------- Pin configuration ----------------
#define SDA_PIN   21
#define SCL_PIN   22
#define BUZZER_PIN            13
#define BUZZER_ACTIVE_LOW     false

// ---------------- MPU6050 registers ----------------
#define MPU_ADDR         0x68
#define REG_PWR_MGMT_1    0x6B
#define REG_ACCEL_XOUT_H  0x3B

// ---------------- Scale factors (±2g, ±250°/s default ranges) ----------------
#define ACCEL_SCALE   16384.0
#define GYRO_SCALE    131.0

// ---------------- Filter / alarm tuning ----------------
#define COMPLEMENTARY_ALPHA   0.98
#define TILT_THRESHOLD_DEG    30.0
#define BEEP_FAST_MS           150

// ---------------- Timing ----------------
#define SENSOR_INTERVAL_MS    20   // ~50Hz sensor fusion + broadcast rate

// ---------------- Calibration ----------------
#define CAL_SAMPLES           100  // ~1 second of samples at 50Hz

// ---------------- WiFi Access Point credentials ----------------
const char* AP_SSID     = "ESP32-Wheelchair";
const char* AP_PASSWORD = "wheelchair1";

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ---------------- Shared live state ----------------
float g_ax, g_ay, g_az;
float g_gx, g_gy, g_gz;
float g_pitch = 0, g_roll = 0, g_yaw = 0;
bool  g_alarmActive = false;
bool  g_mpuOk = false;

// Calibration offsets, applied to every subsequent reading
float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
float pitchOffset = 0, rollOffset = 0;

enum CalState { CAL_IDLE, CAL_RUNNING };
CalState g_calState = CAL_IDLE;
int   calCount = 0;
float calSumGX = 0, calSumGY = 0, calSumGZ = 0;
float calSumPitch = 0, calSumRoll = 0;

unsigned long lastSensorRead = 0;
unsigned long lastFusionMicros = 0;
unsigned long lastBuzzerToggle = 0;
unsigned long lastWsCleanup = 0;
bool buzzerOn = false;

// ---------------- Buzzer ----------------
void buzzerWrite(bool on) {
  if (BUZZER_ACTIVE_LOW) digitalWrite(BUZZER_PIN, on ? LOW : HIGH);
  else                    digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
}

void updateBuzzer() {
  unsigned long now = millis();
  if (!g_alarmActive) {
    if (buzzerOn) { buzzerOn = false; buzzerWrite(false); }
    return;
  }
  if (now - lastBuzzerToggle >= BEEP_FAST_MS) {
    lastBuzzerToggle = now;
    buzzerOn = !buzzerOn;
    buzzerWrite(buzzerOn);
  }
}

// ---------------- MPU6050 I2C ----------------
bool mpuInit() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(REG_PWR_MGMT_1);
  Wire.write(0x00);
  return (Wire.endTransmission() == 0);
}

bool mpuReadRaw(int16_t* ax, int16_t* ay, int16_t* az,
                 int16_t* gx, int16_t* gy, int16_t* gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;

  Wire.requestFrom((int)MPU_ADDR, 14, true);
  if (Wire.available() < 14) return false;

  *ax = (Wire.read() << 8) | Wire.read();
  *ay = (Wire.read() << 8) | Wire.read();
  *az = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read(); // skip temperature
  *gx = (Wire.read() << 8) | Wire.read();
  *gy = (Wire.read() << 8) | Wire.read();
  *gz = (Wire.read() << 8) | Wire.read();
  return true;
}

void startCalibration() {
  g_calState = CAL_RUNNING;
  calCount = 0;
  calSumGX = calSumGY = calSumGZ = 0;
  calSumPitch = calSumRoll = 0;
  Serial.println("Calibration started — hold still and level...");
}

void updateSensorFusion() {
  int16_t rax, ray, raz, rgx, rgy, rgz;
  if (!mpuReadRaw(&rax, &ray, &raz, &rgx, &rgy, &rgz)) {
    g_mpuOk = false;
    return;
  }
  g_mpuOk = true;

  g_ax = rax / ACCEL_SCALE;
  g_ay = ray / ACCEL_SCALE;
  g_az = raz / ACCEL_SCALE;
  float rawGX = rgx / GYRO_SCALE;
  float rawGY = rgy / GYRO_SCALE;
  float rawGZ = rgz / GYRO_SCALE;

  float pitchAcc = atan2(g_ay, sqrt(g_ax * g_ax + g_az * g_az)) * 180.0 / PI;
  float rollAcc  = atan2(-g_ax, g_az) * 180.0 / PI;

  // ---- Calibration collection (uses RAW values, before bias applied) ----
  if (g_calState == CAL_RUNNING) {
    calSumGX += rawGX;
    calSumGY += rawGY;
    calSumGZ += rawGZ;
    calSumPitch += pitchAcc;
    calSumRoll  += rollAcc;
    calCount++;

    if (calCount >= CAL_SAMPLES) {
      gyroBiasX = calSumGX / CAL_SAMPLES;
      gyroBiasY = calSumGY / CAL_SAMPLES;
      gyroBiasZ = calSumGZ / CAL_SAMPLES;
      pitchOffset = calSumPitch / CAL_SAMPLES;
      rollOffset  = calSumRoll  / CAL_SAMPLES;

      g_pitch = 0;
      g_roll  = 0;
      g_yaw   = 0;
      g_calState = CAL_IDLE;
      lastFusionMicros = micros(); // avoid a dt spike right after calibration
      Serial.println("Calibration complete.");
      return; // skip fusion this cycle, start clean next cycle
    }
  }

  // ---- Apply calibration offsets ----
  g_gx = rawGX - gyroBiasX;
  g_gy = rawGY - gyroBiasY;
  g_gz = rawGZ - gyroBiasZ;
  float pitchAccCal = pitchAcc - pitchOffset;
  float rollAccCal  = rollAcc  - rollOffset;

  unsigned long nowMicros = micros();
  float dt = (lastFusionMicros == 0) ? 0.02 : (nowMicros - lastFusionMicros) / 1000000.0;
  lastFusionMicros = nowMicros;
  if (dt <= 0 || dt > 0.5) dt = 0.02; // guard against startup/overflow spikes

  g_pitch = COMPLEMENTARY_ALPHA * (g_pitch + g_gx * dt) + (1 - COMPLEMENTARY_ALPHA) * pitchAccCal;
  g_roll  = COMPLEMENTARY_ALPHA * (g_roll  + g_gy * dt) + (1 - COMPLEMENTARY_ALPHA) * rollAccCal;

  g_yaw += g_gz * dt;
  if (g_yaw > 180.0) g_yaw -= 360.0;
  if (g_yaw < -180.0) g_yaw += 360.0;

  g_alarmActive = (fabs(g_pitch) > TILT_THRESHOLD_DEG) || (fabs(g_roll) > TILT_THRESHOLD_DEG);
}

// ---------------- Broadcast telemetry (fixed buffer, no String) ----------------
void broadcastTelemetry() {
  if (ws.count() == 0) return; // nobody listening, skip the work entirely

  char buf[256];
  snprintf(buf, sizeof(buf),
    "{\"ok\":%s,\"cal\":%s,"
    "\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f,"
    "\"gx\":%.2f,\"gy\":%.2f,\"gz\":%.2f,"
    "\"pitch\":%.2f,\"roll\":%.2f,\"yaw\":%.2f,"
    "\"alarm\":%s}",
    g_mpuOk ? "true" : "false",
    (g_calState == CAL_RUNNING) ? "true" : "false",
    g_ax, g_ay, g_az,
    g_gx, g_gy, g_gz,
    g_pitch, g_roll, g_yaw,
    g_alarmActive ? "true" : "false"
  );
  ws.textAll(buf);
}

// ---------------- Web page ----------------
const char PAGE_HTML[] PROGMEM = R"HTML(
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wheelchair Motion Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #ffffff;
    font-family: Arial, Helvetica, sans-serif;
    color: #222;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
  }
  h1 { font-size: 5vw; margin-bottom: 10px; text-align: center; }

  #stage {
    width: 100%;
    max-width: 480px;
    height: 320px;
    perspective: 900px;
    margin-bottom: 14px;
  }
  #world {
    width: 100%; height: 100%;
    position: relative;
    transform-style: preserve-3d;
    display: flex; align-items: center; justify-content: center;
  }
  #floor {
    position: absolute;
    width: 400px; height: 400px;
    top: 50%; left: 50%;
    margin: -200px 0 0 -200px;
    background:
      repeating-linear-gradient(0deg, #e8e8e8 0 1px, transparent 1px 40px),
      repeating-linear-gradient(90deg, #e8e8e8 0 1px, transparent 1px 40px);
    background-color: #fafafa;
    transform: rotateX(90deg) translateZ(-70px);
    border: 1px solid #ddd;
  }
  #chair {
    position: relative;
    width: 160px; height: 160px;
    transform-style: preserve-3d;
  }
  .part {
    position: absolute;
    background: #3a6ea5;
    border: 1px solid #2c5580;
  }
  #seat   { width: 100px; height: 80px; left: 30px; top: 40px; transform: rotateX(90deg) translateZ(0px); background:#4a7fc0; }
  #back   { width: 100px; height: 70px; left: 30px; top: -20px; transform-origin: bottom; background:#3a6ea5; }
  #wheelL { width: 70px; height: 70px; left: -6px; top: 45px; border-radius: 50%; background: #333; transform: translateZ(-35px) rotateY(90deg); border: 4px solid #111; }
  #wheelR { width: 70px; height: 70px; left: 96px; top: 45px; border-radius: 50%; background: #333; transform: translateZ(35px) rotateY(90deg); border: 4px solid #111; }
  #casterL{ width: 20px; height: 20px; left: 20px; top: 130px; border-radius: 50%; background: #555; transform: translateZ(-45px); }
  #casterR{ width: 20px; height: 20px; left: 120px; top: 130px; border-radius: 50%; background: #555; transform: translateZ(45px); }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    width: 100%;
    max-width: 480px;
  }
  .card {
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 10px;
    text-align: center;
  }
  .label { font-size: 2.6vw; color: #777; margin-bottom: 4px; }
  .value { font-size: 4.2vw; font-weight: bold; }

  #panel {
    width: 100%; max-width: 480px;
    margin-top: 12px;
    padding: 12px;
    border-radius: 10px;
    text-align: center;
    color: #fff;
    background: #27ae60;
    font-size: 4vw; font-weight: bold;
  }
  #panel.alarm { background: #c0392b; animation: pulse 0.6s infinite alternate; }
  #panel.error { background: #7f8c8d; }
  #panel.calibrating { background: #e67e22; animation: pulse 0.4s infinite alternate; }
  @keyframes pulse { from { opacity: 1; } to { opacity: 0.55; } }

  #calBtn {
    width: 100%; max-width: 480px;
    margin-top: 10px;
    padding: 14px;
    border: none;
    border-radius: 10px;
    background: #34495e;
    color: #fff;
    font-size: 4vw;
    font-weight: bold;
    cursor: pointer;
  }
  #calBtn:active { opacity: 0.85; }
  #calBtn:disabled { background: #95a5a6; }

  @media (min-width: 600px) {
    h1 { font-size: 24px; }
    .label { font-size: 12px; }
    .value { font-size: 20px; }
    #panel { font-size: 18px; }
    #calBtn { font-size: 16px; }
  }
</style>
</head>
<body>
  <h1>Wheelchair Motion Dashboard</h1>

  <div id="stage">
    <div id="world">
      <div id="floor"></div>
      <div id="chair">
        <div class="part" id="back"></div>
        <div class="part" id="seat"></div>
        <div class="part" id="wheelL"></div>
        <div class="part" id="wheelR"></div>
        <div class="part" id="casterL"></div>
        <div class="part" id="casterR"></div>
      </div>
    </div>
  </div>

  <div class="grid">
    <div class="card"><div class="label">Accel X</div><div class="value" id="ax">--</div></div>
    <div class="card"><div class="label">Accel Y</div><div class="value" id="ay">--</div></div>
    <div class="card"><div class="label">Accel Z</div><div class="value" id="az">--</div></div>
    <div class="card"><div class="label">Gyro X</div><div class="value" id="gx">--</div></div>
    <div class="card"><div class="label">Gyro Y</div><div class="value" id="gy">--</div></div>
    <div class="card"><div class="label">Gyro Z</div><div class="value" id="gz">--</div></div>
    <div class="card"><div class="label">Pitch</div><div class="value" id="pitch">--</div></div>
    <div class="card"><div class="label">Roll</div><div class="value" id="roll">--</div></div>
    <div class="card"><div class="label">Yaw</div><div class="value" id="yaw">--</div></div>
  </div>

  <div id="panel">CONNECTING...</div>
  <button id="calBtn" onclick="calibrate()">Calibrate (Hold Level &amp; Still)</button>

<script>
var target = { pitch: 0, roll: 0, yaw: 0 };
var current = { pitch: 0, roll: 0, yaw: 0 };
var socket;
var calibrating = false;

function lerp(a, b, t) { return a + (b - a) * t; }

function connect() {
  socket = new WebSocket('ws://' + location.host + '/ws');

  socket.onopen = function() {
    document.getElementById('panel').textContent = 'CONNECTED';
  };

  socket.onclose = function() {
    var panel = document.getElementById('panel');
    panel.className = 'error';
    panel.textContent = 'CONNECTION LOST - RECONNECTING...';
    setTimeout(connect, 1000);
  };

  socket.onerror = function() { socket.close(); };

  socket.onmessage = function(evt) {
    var d = JSON.parse(evt.data);
    calibrating = d.cal;

    document.getElementById('ax').textContent = d.ax.toFixed(2) + ' g';
    document.getElementById('ay').textContent = d.ay.toFixed(2) + ' g';
    document.getElementById('az').textContent = d.az.toFixed(2) + ' g';
    document.getElementById('gx').textContent = d.gx.toFixed(1) + ' °/s';
    document.getElementById('gy').textContent = d.gy.toFixed(1) + ' °/s';
    document.getElementById('gz').textContent = d.gz.toFixed(1) + ' °/s';
    document.getElementById('pitch').textContent = d.pitch.toFixed(1) + '°';
    document.getElementById('roll').textContent  = d.roll.toFixed(1) + '°';
    document.getElementById('yaw').textContent   = d.yaw.toFixed(1) + '°';

    var panel = document.getElementById('panel');
    var calBtn = document.getElementById('calBtn');
    if (!d.ok) {
      panel.className = 'error';
      panel.textContent = 'SENSOR ERROR - CHECK WIRING';
    } else if (calibrating) {
      panel.className = 'calibrating';
      panel.textContent = 'CALIBRATING - HOLD STILL...';
    } else if (d.alarm) {
      panel.className = 'alarm';
      panel.textContent = 'TILT ALARM';
    } else {
      panel.className = '';
      panel.textContent = 'STABLE';
    }
    calBtn.disabled = calibrating;

    target.pitch = d.pitch;
    target.roll  = d.roll;
    target.yaw   = d.yaw;
  };
}

function calibrate() {
  fetch('/calibrate');
}

function animate() {
  current.pitch = lerp(current.pitch, target.pitch, 0.35);
  current.roll  = lerp(current.roll,  target.roll,  0.35);
  current.yaw   = lerp(current.yaw,   target.yaw,   0.35);

  var chair = document.getElementById('chair');
  chair.style.transform =
    'rotateY(' + current.yaw + 'deg) ' +
    'rotateX(' + current.pitch + 'deg) ' +
    'rotateZ(' + current.roll + 'deg)';

  requestAnimationFrame(animate);
}

connect();
requestAnimationFrame(animate);
</script>
</body>
</html>
)HTML";

// ---------------- WebSocket event handler ----------------
void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
               AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("WebSocket client #%u connected\n", client->id());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("WebSocket client #%u disconnected\n", client->id());
  }
}

// ---------------- Setup ----------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("--- GY-521 Wheelchair Motion Dashboard (Async) ---");

  pinMode(BUZZER_PIN, OUTPUT);
  buzzerWrite(false);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);
  if (mpuInit()) {
    Serial.println("MPU6050 initialized OK.");
  } else {
    Serial.println("MPU6050 init FAILED — check wiring (SDA=21, SCL=22).");
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  IPAddress apIP = WiFi.softAPIP();
  Serial.println("Access Point started.");
  Serial.print("WiFi name: ");
  Serial.println(AP_SSID);
  Serial.print("Connect, then open in your browser: http://");
  Serial.println(apIP);

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  server.on("/", HTTP_GET, [](AsyncWebServerRequest* request) {
    request->send_P(200, "text/html", PAGE_HTML);
  });

  server.on("/calibrate", HTTP_GET, [](AsyncWebServerRequest* request) {
    startCalibration();
    request->send(200, "text/plain", "ok");
  });

  server.onNotFound([](AsyncWebServerRequest* request) {
    request->send(404, "text/plain", "Not found");
  });

  server.begin();
  Serial.println("Async web server + WebSocket started.");
}

// ---------------- Loop ----------------
void loop() {
  unsigned long now = millis();

  if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = now;
    updateSensorFusion();
    broadcastTelemetry();
  }

  // Periodically clean up stale/disconnected WebSocket clients so
  // they don't accumulate and slow things down over a long session.
  if (now - lastWsCleanup >= 2000) {
    lastWsCleanup = now;
    ws.cleanupClients();
  }

  updateBuzzer();
}
