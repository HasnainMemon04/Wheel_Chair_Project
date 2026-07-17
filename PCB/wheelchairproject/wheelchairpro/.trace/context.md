# Wheelchair IoT Telematics Module - Design Log

## 2025-07-14 Block 1 Rev3: Power Input Protection (power_input.trace_sch)
- J1 screw terminal, F1 PPTC (JK-SMD150L/33V 33V, C2830283), Q1 P-MOSFET (RM8A5P60S8 60V, C3279995)
- D2 TVS AFTER fuse (V24V_FUSED) - fire safe chain confirmed
- D1 TVS on V24V_PROT, D3 BZX84B12 Zener gate clamp
- R1 gate pull-DOWN to GND (pins 1=Q1_GATE, 2=GND) - Vgs = -24V, Q1 fully ON
- Previous gate-to-source connection was wrong (Vgs=0, Q1 never ON) - FIXED

## 2025-07-14 Block 2 Rev5: Power Rails (power_rails.trace_sch)
- U1 TX4138 (C329267): 24V to 5V@2A, FB R3=300k/R4=57.1k, Vout=5.03V
- U2 TX4138 (C329267): 24V to 3.8V@2A MODEM ONLY, FB R6=300k/R7=80.6k, Vout=3.79V
- U3 TX4138 (C329267): 24V to 3.3V@500mA ESP32+sensors, FB R8=300k/R9=95.3k, Vout=3.32V
- All TX4138: pin3=VIN=V24V_PROT, pin2+9=ILIM tied, pin9 NEVER GND
- ILIM sense: R2/R5/R10 = 30mOhm, wired V24V_PROT to ILIM (verified)
- Bootstrap: R11/R12/R13 = 5.1R series + C1/C6/C14 = 100nF (BS to SW node)
- Loop comp: C16/C17/C18 = 12pF (FB to Vout)
- Inductors L1/L2/L3: LSRNJ12575GL330MMY 33uH 3.48A (C7296383), Isat=4.45A
- Catch diodes D4/D5/D6: SS510SMC 5A/100V (C511859)
- C9 bulk modem cap: 470uF/10V CP_Elec_8x10.5 (TX burst support)
- wheelchairpro.kicad_sym: native TX4138 9-pin symbol embedded in kicad_sch
- 3x "pin_not_connected" ERC = TX4138 placeholder off-grid pins, cosmetic only

## 2025-07-14 Block 3 Rev A: MCU (mcu.trace_sch, Sheet 4)
- U4: ESP32-WROOM-32E-H4, JLCPCB C3013935
- EN reset: R14=10k (V3V3 pull-up) + C19=1uF (RC delay) + SW1=reset button
- Boot: SW2=boot button + R15=10k (IO0 pull-up to V3V3)
- Strapping: R16=10k (IO2 pull-down GND), R17=10k (IO12 pull-down GND), R18=10k (IO15 pull-up V3V3)
- GPIO map: IO32=ONEWIRE, IO33=HALL_INT, SENSOR_VP=ADC_BATT
- UART1: IO16=MODEM_RXD, IO17=MODEM_TXD
- UART2: IO23=GPS_RXD
- I2C: IO21=I2C_SDA, IO22=I2C_SCL
- UART0: RXD0=USB_RXD, TXD0=USB_TXD
- LEVEL SHIFT ALERT: SIM7080G TX = 1.8V, ESP32 VIH = 2.475V. MODEM_RXD needs 1.8V->3.3V level shifter on modem sheet.
- ERC: 0 errors on MCU sheet. All global labels connected.

## Hierarchy
- Root: wheelchairpro.trace_sch (3 sheet references)
- Sheet 2: power_input.trace_sch (Block 1)
- Sheet 3: power_rails.trace_sch (Block 2)
- Sheet 4: mcu.trace_sch (Block 3)
- Sheets 5-8: modem, gps, sensors, outputs (TBD)

## Part Numbers
- JK-SMD150L/33V: C2830283 (PPTC fuse 33V/1.5A)
- RM8A5P60S8: C3279995 (P-MOSFET 60V/8.5A SOIC-8)
- SMBJ40A: C114003 (TVS 40V/600W SMB)
- BZX84B12: C5605544 (Zener 12V SOT-23)
- TX4138: C329267 (Buck 60V/4A SOIC-8-EP x3)
- LSRNJ12575GL330MMY: C7296383 (Inductor 33uH/3.48A x3)
- SS510SMC: C511859 (Schottky 5A/100V SMC x3)
- WSK1206R0300FEA18: C1517465 (30mOhm 1206 x3)
- RNCF0603DKE95K3: C2488650 (95.3k 0.5% 0603)
- ESP32-WROOM-32E-H4: C3013935

## NEXT: Block 4 - SIM7080G-M Modem (modem.trace_sch, Sheet 5)
- Generate native symbol first (not in KiCad library)
- Add TXS0101 or BSS138 level shifter on MODEM_RXD (1.8V to 3.3V)
- V3V8 supply from power_rails (modem-only rail)
- 470uF bulk cap at modem VCC pins (TX burst)
- PWRKEY: ESP32 GPIO drives PWRKEY through transistor or direct
- SIM card holder + ESD protection
- Antenna connector (SMA or U.FL)


## 2026-07-14T17:44:47 -- [AUTO-CHECKPOINT: Stream interrupted]
- Stream ended unexpectedly (timeout or connection loss)
- Files modified before interruption:
  - D:\Wheel_Chair_Project\PCB\wheelchairproject\wheelchairpro\wheelchairpro.kicad_sch
- Work may be incomplete. Re-read modified files to assess state.
