#include <Arduino.h>
#include <TinyGPS++.h>

// NEO-6M GPS connected to UART1 (exact pins)
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
#define GPS_BAUD   9600

HardwareSerial GPSSerial(1);
TinyGPSPlus gps;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("--- NEO-6M GPS Standalone Test ---");
  
  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("GPS Serial UART1 initialized. Waiting for NMEA data...");
}

void loop() {
  while (GPSSerial.available() > 0) {
    char c = GPSSerial.read();
    gps.encode(c);
  }

  // Print parsed telemetry every 2 seconds
  static unsigned long lastPrint = 0;
  if (millis() - lastPrint > 2000) {
    lastPrint = millis();
    
    Serial.println("\n[GPS STATUS]");
    if (gps.location.isValid()) {
      Serial.printf("  Latitude : %.6f\n", gps.location.lat());
      Serial.printf("  Longitude: %.6f\n", gps.location.lng());
      Serial.printf("  Speed    : %.2f km/h\n", gps.speed.kmh());
    } else {
      Serial.println("  Location : INVALID (Waiting for satellite lock...)");
    }
    
    Serial.printf("  Satellites: %d\n", gps.satellites.value());
    Serial.printf("  HDOP      : %.2f\n", gps.hdop.hdop());
  }
}
