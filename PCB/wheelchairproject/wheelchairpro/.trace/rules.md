---
manufacturer: JLCPCB
passive_size: "0603"
mcu_family: ESP32
layers: 4
---

## Project
Smart wheelchair IoT telematics module.
24V lithium wheelchair battery input. Target: 1000-unit
production, BOM under $55/unit, Saudi Arabia deployment.
Operating temp up to 105C (outdoor Saudi heat).

## Locked Components
- MCU: ESP32-WROOM-32E-H4 (C3013935), H8 for production
- Modem: SIM7080G-M (C18548266) - NB-IoT/Cat-M, 3.8V rail
- GPS: ATGM336H-5N31 (C90770)
- IMU: LSM6DS3TR-C (C967633)
- Fuel gauge: BQ34Z100-G1 (C91302) - low-side shunt
- Temp: DS18B20 (C20611523)
- Hall/speed: A3144 (C18221460)

## Power Architecture
24V in -> Fuse -> Reverse-polarity MOSFET -> TVS ->
Buck 5V -> LDO 3.3V (ESP32, sensors)
        -> Buck 3.8V (modem, with bulk cap for TX bursts)
Backup battery + charger + auto-switchover on both rails.

## Placement Strategy
- Start from external connectors (power jack, USB) and work inward
- Antennas at board edge, keepout under PCB antenna area
- Keep 24V power section isolated from RF and analog
- Fuel gauge shunt on low side, Kelvin connection

## Component Preferences
- Prefer TI for voltage regulators
- Prefer Murata for passives
- Prefer JLCPCB Basic parts for passives (avoids feeder fees)
- All parts must be in JLCPCB stock

## Critical Rules
- ESP32 EN pin needs RC delay (10k + 1uF) + reset button
- Strapping pins IO0, IO2, IO12, IO15 reserved - do not
  assign to peripherals. IO12 must be LOW at boot.
- Modem needs dedicated 3.8V rail with bulk capacitor,
  never share with 3.3V logic
- Wheel lock / power cutoff output must be fail-safe:
  never actuate on a moving or occupied chair