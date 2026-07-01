#include <Arduino.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <WebServer.h>

// ---------- GPS CONFIG ----------
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
#define GPS_BAUD   9600

// ---------- WIFI AP CONFIG ----------
const char* AP_SSID = "ESP32-GPS";
const char* AP_PASS = "12345678";   // min 8 chars, or "" for open network

HardwareSerial GPSSerial(1);
TinyGPSPlus gps;
WebServer server(80);

// ---------- STATE ----------
#define RAW_LINES_MAX 15
String rawLines[RAW_LINES_MAX];
int rawLineCount = 0;
String currentRawLine = "";

unsigned long bootTime = 0;
unsigned long lastCharTime = 0;
bool everSawData = false;
int maxSatellitesSeen = 0;

void addRawLine(String line) {
  for (int i = RAW_LINES_MAX - 1; i > 0; i--) {
    rawLines[i] = rawLines[i - 1];
  }
  rawLines[0] = line;
  if (rawLineCount < RAW_LINES_MAX) rawLineCount++;
}

String buildPage() {
  String html;
  html.reserve(4096);

  html += F("<!DOCTYPE html><html><head><meta charset='utf-8'>");
  html += F("<meta name='viewport' content='width=device-width, initial-scale=1'>");
  html += F("<meta http-equiv='refresh' content='2'>");
  html += F("<title>ESP32 GPS Monitor</title>");
  html += F("<style>"
             "body{background:#fff;color:#111;font-family:monospace;"
             "font-size:15px;margin:12px;line-height:1.4;}"
             "h2{margin:4px 0;}"
             "hr{border:none;border-top:1px solid #ccc;margin:10px 0;}"
             ".ok{color:#0a7d0a;font-weight:bold;}"
             ".bad{color:#b00000;font-weight:bold;}"
             ".raw{color:#333;word-break:break-all;}"
             ".box{background:#f7f7f7;padding:8px;border-radius:6px;"
             "margin-bottom:10px;}"
             "</style></head><body>");

  html += F("<h2>ESP32 GPS Diagnostic</h2>");

  unsigned long upSec = (millis() - bootTime) / 1000;
  html += "<div class='box'>";
  html += "Uptime: " + String(upSec) + "s<br>";
  html += "Chars processed: " + String(gps.charsProcessed()) + "<br>";
  html += "Sentences w/ fix: " + String(gps.sentencesWithFix()) + "<br>";
  html += "Failed checksum: " + String(gps.failedChecksum()) + "<br>";

  bool dataFlowing = everSawData && (millis() - lastCharTime < 3000);
  html += "Data flowing: ";
  html += dataFlowing ? "<span class='ok'>YES</span>" : "<span class='bad'>NO</span>";
  html += "</div>";

  html += "<div class='box'>";
  int sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
  if (sats > maxSatellitesSeen) maxSatellitesSeen = sats;

  html += "Satellites in use: <b>" + String(sats) + "</b><br>";
  html += "Max satellites seen: <b>" + String(maxSatellitesSeen) + "</b><br>";
  html += "HDOP: " + String(gps.hdop.isValid() ? gps.hdop.hdop() : 99.99, 2) + "<br>";

  if (gps.location.isValid()) {
    html += "<span class='ok'>FIX OK</span><br>";
    html += "Lat: " + String(gps.location.lat(), 6) + "<br>";
    html += "Lng: " + String(gps.location.lng(), 6) + "<br>";
    html += "Fix age: " + String(gps.location.age()) + " ms<br>";
  } else {
    html += "<span class='bad'>NO FIX YET</span><br>";
  }

  if (gps.altitude.isValid())
    html += "Altitude: " + String(gps.altitude.meters(), 1) + " m<br>";
  if (gps.speed.isValid())
    html += "Speed: " + String(gps.speed.kmph(), 2) + " km/h<br>";
  if (gps.course.isValid())
    html += "Course: " + String(gps.course.deg(), 2) + " deg<br>";

  if (gps.date.isValid() && gps.time.isValid()) {
    char buf[40];
    snprintf(buf, sizeof(buf), "%02d/%02d/%04d %02d:%02d:%02d UTC",
             gps.date.day(), gps.date.month(), gps.date.year(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
    html += "Time: " + String(buf) + "<br>";
  } else {
    html += "Time: not decoded yet<br>";
  }
  html += "</div>";

  html += "<h2>Raw NMEA (latest first)</h2><div class='box'>";
  if (rawLineCount == 0) {
    html += "<span class='bad'>No sentences received yet.</span>";
  } else {
    for (int i = 0; i < rawLineCount; i++) {
      html += "<div class='raw'>" + rawLines[i] + "</div>";
    }
  }
  html += "</div>";

  html += "<div style='color:#888;font-size:12px;'>Auto-refreshing every 2s...</div>";
  html += "</body></html>";
  return html;
}

void handleRoot() {
  server.send(200, "text/html", buildPage());
}

void setup() {
  Serial.begin(9600);
  delay(1500);

  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  bootTime = millis();

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  IPAddress ip = WiFi.softAPIP();

  Serial.println(F("\n=== ESP32 GPS Web Monitor ==="));
  Serial.print(F("Connect to WiFi: ")); Serial.println(AP_SSID);
  Serial.print(F("Password: "));        Serial.println(AP_PASS);
  Serial.print(F("Then open in browser: http://"));
  Serial.println(ip);
  Serial.println(F("=============================\n"));

  server.on("/", handleRoot);
  server.begin();
}

void loop() {
  while (GPSSerial.available() > 0) {
    char c = GPSSerial.read();
    everSawData = true;
    lastCharTime = millis();
    gps.encode(c);

    if (c == '\n') {
      if (currentRawLine.length() > 0) {
        addRawLine(currentRawLine);
      }
      currentRawLine = "";
    } else if (c != '\r') {
      currentRawLine += c;
      if (currentRawLine.length() > 90) currentRawLine = ""; // safety cap
    }
  }

  server.handleClient();
}