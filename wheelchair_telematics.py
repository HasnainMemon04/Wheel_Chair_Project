#!/usr/bin/env python3
"""
================================================================================
 SMART WHEELCHAIR TELEMATICS MODULE  -  SCHEMATIC (SKiDL)
================================================================================
 Project : Rental wheelchair IoT telematics unit
 Target  : JLCPCB 4-layer PCB + SMT assembly
 Input   : 24V nominal Lithium pack (7S -> 29.4V max charge)
 Volume  : 1000 units
 Author  : Muhammad Hasnain Memon

 HOW TO RUN
 ----------
   pip install skidl
   python wheelchair_telematics.py
   -> produces wheelchair_telematics.net  (import into KiCad PCB Editor)
================================================================================
"""

import os
import sys

# ==============================================================================
# SELF-HEALING KICAD DIRECTORY AUTO-DETECTOR
# ==============================================================================
def setup_kicad_environment():
    # Common KiCad default search roots on Windows
    roots = [
        r"C:\Program Files\KiCad",
        r"D:\Program Files\KiCad",
        r"C:\KiCad",
        r"D:\KiCad",
    ]
    
    symbols_path = None
    kicad_version = None
    
    # Scan drives to find the actual 'symbols' or 'kicad-symbols' directory
    for root in roots:
        if os.path.exists(root):
            for dirpath, dirnames, filenames in os.walk(root):
                if "symbols" in dirnames or "kicad-symbols" in dirnames:
                    sym_dir = "symbols" if "symbols" in dirnames else "kicad-symbols"
                    candidate = os.path.join(dirpath, sym_dir)
                    # Confirm it contains a standard library to avoid false positives
                    if os.path.exists(os.path.join(candidate, "Connector.kicad_sym")) or os.path.exists(os.path.join(candidate, "Connector.lib")):
                        symbols_path = candidate
                        if "8.0" in dirpath:
                            kicad_version = "8"
                        elif "7.0" in dirpath:
                            kicad_version = "7"
                        elif "6.0" in dirpath:
                            kicad_version = "6"
                        elif "5.0" in dirpath or "5.1" in dirpath:
                            kicad_version = "5"
                        break
            if symbols_path:
                break
                
    if not symbols_path:
        print("=" * 80)
        print("  FATAL ERROR: COULD NOT LOCATE KICAD SYMBOL LIBRARIES")
        print("=" * 80)
        print("SKiDL requires local KiCad symbol libraries to define parts.")
        print("Please verify:")
        print("1. KiCad is actually installed on your system.")
        print("2. 'Standard symbol libraries' was checked during installation.")
        print("3. If installed on a custom drive, set the directory manually at the top of the script.")
        print("=" * 80)
        sys.exit(1)
        
    print(f"INFO: Detected KiCad v{kicad_version if kicad_version else 'unknown'} symbols at: {symbols_path}")
    
    # Map both generic and specific SKiDL environment variables
    os.environ["KICAD_SYMBOL_DIR"] = symbols_path
    if kicad_version:
        os.environ[f"KICAD{kicad_version}_SYMBOL_DIR"] = symbols_path
        
    return kicad_version, symbols_path

# Run auto-detect before importing SKiDL
kicad_ver, detected_symbols_dir = setup_kicad_environment()

from skidl import *

# Explicitly assign the correct default tool backend based on discovery
if kicad_ver == "8":
    set_default_tool(KICAD8)
    lib_search_paths[KICAD8].append(detected_symbols_dir)
elif kicad_ver == "7":
    set_default_tool(KICAD7)
    lib_search_paths[KICAD7].append(detected_symbols_dir)
elif kicad_ver == "6":
    set_default_tool(KICAD6)
    lib_search_paths[KICAD6].append(detected_symbols_dir)
else:
    set_default_tool(KICAD5)
    lib_search_paths[KICAD5].append(detected_symbols_dir)


# ------------------------------------------------------------------------------
# GLOBAL NETS
# ------------------------------------------------------------------------------
GND    = Net('GND');    GND.drive  = POWER
VBAT   = Net('VBAT_24V')          # raw battery, 20-30V
VPROT  = Net('VPROT')             # after fuse + reverse-polarity + TVS
V5     = Net('+5V')
V3V3   = Net('+3V3');   V3V3.drive = POWER
V3V8   = Net('+3V8')              # modem rail (dedicated)
V1V8   = Net('+1V8')              # modem logic level reference rail

# ==============================================================================
# BLOCK 1 - POWER INPUT PROTECTION
# ==============================================================================
J_PWR = Part('Connector', 'Conn_01x02', footprint='TerminalBlock:TerminalBlock_bornier-2_P5.08mm')
J_PWR[1] += VBAT
J_PWR[2] += GND

F1 = Part('Device', 'Fuse', value='2A', footprint='Fuse:Fuse_1206_3216Metric')

Q_REV = Part('Device', 'Q_PMOS_GSD', value='SI2323DS', footprint='Package_TO_SOT_SMD:SOT-23')
R_GATE = Part('Device', 'R', value='100k', footprint='Resistor_SMD:R_0603_1608Metric')
D_ZEN  = Part('Device', 'D_Zener', value='12V', footprint='Diode_SMD:D_SOD-123')

_n1 = Net('VBAT_FUSED')
VBAT     += F1[1]
F1[2]    += _n1
_n1      += Q_REV['S']
Q_REV['D'] += VPROT
Q_REV['G'] += R_GATE[1], D_ZEN['K']
R_GATE[2]  += GND
D_ZEN['A'] += GND

TVS = Part('Device', 'D_TVS', value='SMBJ33A', footprint='Diode_SMD:D_SMB')
TVS[1] += VPROT
TVS[2] += GND

C_IN1 = Part('Device', 'C', value='100uF/50V', footprint='Capacitor_SMD:C_1210_3225Metric')
C_IN2 = Part('Device', 'C', value='100nF',     footprint='Capacitor_SMD:C_0603_1608Metric')
for c in (C_IN1, C_IN2):
    c[1] += VPROT
    c[2] += GND


# ==============================================================================
# BLOCK 2 - POWER RAILS
# ==============================================================================
# ---- Buck 1: 24V -> 5V @ 2A -------------------------------------------------
U_BUCK5 = Part('Regulator_Switching', 'TPS54331D', footprint='Package_SO:SOIC-8-1EP_3.9x4.9mm_P1.27mm_EP2.29x3mm')

L1     = Part('Device', 'L', value='15uH/3A', footprint='Inductor_SMD:L_12x12mm_H8mm')
D_BUCK = Part('Device', 'D_Schottky', value='B560', footprint='Diode_SMD:D_SMC')

C_B5_IN  = Part('Device', 'C', value='10uF/50V', footprint='Capacitor_SMD:C_1206_3216Metric')
C_B5_OUT = Part('Device', 'C', value='47uF/16V', footprint='Capacitor_SMD:C_1206_3216Metric')
C_BOOT   = Part('Device', 'C', value='10nF',     footprint='Capacitor_SMD:C_0603_1608Metric')

R_FB1 = Part('Device', 'R', value='52.3k', footprint='Resistor_SMD:R_0603_1608Metric')
R_FB2 = Part('Device', 'R', value='10k',   footprint='Resistor_SMD:R_0603_1608Metric')

SW5 = Net('SW_5V')
BOOT5 = Net('BOOT_5V')
FB5 = Net('FB_5V')

U_BUCK5['VIN'] += VPROT
U_BUCK5['GND'] += GND
U_BUCK5['PH']  += SW5
U_BUCK5['BOOT'] += BOOT5
U_BUCK5['VSENSE'] += FB5

C_BOOT[1] += BOOT5
C_BOOT[2] += SW5

SW5 += L1[1], D_BUCK['K']
D_BUCK['A'] += GND
L1[2] += V5

C_B5_IN[1]  += VPROT;  C_B5_IN[2]  += GND
C_B5_OUT[1] += V5;     C_B5_OUT[2] += GND

R_FB1[1] += V5;  R_FB1[2] += FB5
R_FB2[1] += FB5; R_FB2[2] += GND

# ---- LDO: 5V -> 3.3V @ 800mA ------------------------------------------------
U_LDO = Part('Regulator_Linear', 'AMS1117-3.3', footprint='Package_TO_SOT_SMD:SOT-223-3_TabPin2')
C_LDO_IN  = Part('Device', 'C', value='10uF',  footprint='Capacitor_SMD:C_0805_2012Metric')
C_LDO_OUT = Part('Device', 'C', value='22uF',  footprint='Capacitor_SMD:C_0805_2012Metric')

U_LDO['VI'] += V5
U_LDO['VO'] += V3V3
U_LDO['GND'] += GND
C_LDO_IN[1]  += V5;   C_LDO_IN[2]  += GND
C_LDO_OUT[1] += V3V3; C_LDO_OUT[2] += GND

# ---- Buck 2: 24V -> 3.8V @ 2A (MODEM ONLY) ----------------------------------
U_BUCK38 = Part('Regulator_Switching', 'TPS54331D', footprint='Package_SO:SOIC-8-1EP_3.9x4.9mm_P1.27mm_EP2.29x3mm')

L2      = Part('Device', 'L', value='15uH/3A', footprint='Inductor_SMD:L_12x12mm_H8mm')
D_BUCK2 = Part('Device', 'D_Schottky', value='B560', footprint='Diode_SMD:D_SMC')

C_B38_IN  = Part('Device', 'C', value='10uF/50V',  footprint='Capacitor_SMD:C_1206_3216Metric')
C_B38_BULK= Part('Device', 'C', value='470uF/10V', footprint='Capacitor_SMD:CP_Elec_8x10')
C_B38_OUT = Part('Device', 'C', value='22uF',      footprint='Capacitor_SMD:C_0805_2012Metric')
C_BOOT2   = Part('Device', 'C', value='10nF',      footprint='Capacitor_SMD:C_0603_1608Metric')

R_FB3 = Part('Device', 'R', value='37.4k', footprint='Resistor_SMD:R_0603_1608Metric')
R_FB4 = Part('Device', 'R', value='10k',   footprint='Resistor_SMD:R_0603_1608Metric')

SW38  = Net('SW_3V8')
BOOT38= Net('BOOT_3V8')
FB38  = Net('FB_3V8')

U_BUCK38['VIN'] += VPROT
U_BUCK38['GND'] += GND
U_BUCK38['PH']  += SW38
U_BUCK38['BOOT']+= BOOT38
U_BUCK38['VSENSE'] += FB38

C_BOOT2[1] += BOOT38
C_BOOT2[2] += SW38

SW38 += L2[1], D_BUCK2['K']
D_BUCK2['A'] += GND
L2[2] += V3V8

C_B38_IN[1]  += VPROT; C_B38_IN[2]  += GND
C_B38_BULK[1]+= V3V8;  C_B38_BULK[2]+= GND
C_B38_OUT[1] += V3V8;  C_B38_OUT[2] += GND

R_FB3[1] += V3V8; R_FB3[2] += FB38
R_FB4[1] += FB38; R_FB4[2] += GND


# ==============================================================================
# BLOCK 3 - MCU : ESP32-WROOM-32E-H4
# ==============================================================================
U1 = Part('RF_Module', 'ESP32-WROOM-32E', footprint='RF_Module:ESP32-WROOM-32E')
U1['GND'] += GND
U1['3V3'] += V3V3

C_ESP1 = Part('Device', 'C', value='22uF',  footprint='Capacitor_SMD:C_0805_2012Metric')
C_ESP2 = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
for c in (C_ESP1, C_ESP2):
    c[1] += V3V3
    c[2] += GND

# EN Pin startup circuit
EN = Net('EN')
R_EN = Part('Device', 'R', value='10k',  footprint='Resistor_SMD:R_0603_1608Metric')
C_EN = Part('Device', 'C', value='1uF',  footprint='Capacitor_SMD:C_0603_1608Metric')
SW_RST = Part('Switch', 'SW_Push', footprint='Button_Switch_SMD:SW_SPST_B3U-1000P')

U1['EN'] += EN
R_EN[1] += V3V3; R_EN[2] += EN
C_EN[1] += EN;   C_EN[2] += GND
SW_RST[1] += EN; SW_RST[2] += GND

# Boot select button on IO0
SW_BOOT = Part('Switch', 'SW_Push', footprint='Button_Switch_SMD:SW_SPST_B3U-1000P')
SW_BOOT[1] += U1['IO0']
SW_BOOT[2] += GND
R_IO0 = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')
R_IO0[1] += V3V3
R_IO0[2] += U1['IO0']


# ==============================================================================
# BLOCK 4 - CELLULAR MODEM : SIM7080G-M & LEVEL SHIFTER (3.3V <-> 1.8V)
# ==============================================================================
U2 = Part('RF', 'SIM7080G', footprint='RF_Module:SIM7080G')
U2['VBAT'] += V3V8
U2['GND']  += GND

# Grab the 1.8V reference out from Pin 40 (VDD_EXT) to drive Level Translator side B
U2['VDD_EXT'] += V1V8

C_M1 = Part('Device', 'C', value='100uF', footprint='Capacitor_SMD:C_1210_3225Metric')
C_M2 = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
C_M3 = Part('Device', 'C', value='10pF',  footprint='Capacitor_SMD:C_0603_1608Metric')
for c in (C_M1, C_M2, C_M3):
    c[1] += V3V8
    c[2] += GND

# Level Translator: Bridges ESP32 3.3V domain to SIM7080G 1.8V domain to prevent UART damage
U_LEVEL = Part('Interface', 'TXB0104D', footprint='Package_SO:SOIC-14_3.9x8.7mm_P1.27mm')
U_LEVEL['VCCA'] += V3V3   # Side A: 3.3V (ESP32)
U_LEVEL['VCCB'] += V1V8   # Side B: 1.8V (Modem)
U_LEVEL['GND']  += GND
U_LEVEL['OE']   += V3V3   # Active High, pull to VCC

C_LV1 = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
C_LV2 = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
C_LV1[1] += V3V3; C_LV1[2] += GND
C_LV2[1] += V1V8; C_LV2[2] += GND

# Signal translations (ESP32 <-> Level Translator <-> Modem)
MODEM_TX_3V3 = Net('MODEM_TX_3V3')
MODEM_RX_3V3 = Net('MODEM_RX_3V3')
MODEM_TX_1V8 = Net('MODEM_TX_1V8')
MODEM_RX_1V8 = Net('MODEM_RX_1V8')

U1['IO16'] += MODEM_TX_3V3
U1['IO17'] += MODEM_RX_3V3

U2['TXD'] += MODEM_TX_1V8
U2['RXD'] += MODEM_RX_1V8

# TXB0104 Pin Assignments
U_LEVEL['A1'] += MODEM_RX_3V3
U_LEVEL['B1'] += MODEM_RX_1V8
U_LEVEL['A2'] += MODEM_TX_3V3
U_LEVEL['B2'] += MODEM_TX_1V8

# Power key driver (translates IO4 signal to Modem PWRKEY)
PWRKEY_3V3 = Net('PWRKEY_3V3')
PWRKEY_1V8 = Net('PWRKEY_1V8')
Q_PWRKEY = Part('Device', 'Q_NMOS_GSD', value='2N7002', footprint='Package_TO_SOT_SMD:SOT-23')
R_PK = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')

U1['IO4'] += PWRKEY_3V3
Q_PWRKEY['G'] += PWRKEY_3V3
Q_PWRKEY['S'] += GND

U_LEVEL['A3'] += Q_PWRKEY['D']
U_LEVEL['B3'] += PWRKEY_1V8
U2['PWRKEY'] += PWRKEY_1V8

# SIM Card Holder (1.8V Interface)
J_SIM = Part('Connector', 'Micro_SD_Card', footprint='Connector_Card:Nano_SIM_Card_Socket')

# RF Cellular Output
J_ANT_CELL = Part('Connector', 'Conn_Coaxial', footprint='Connector_Coaxial:U.FL_Hirose_U.FL-R-SMT-1_Vertical')
J_ANT_CELL[1] += U2['ANT']
J_ANT_CELL[2] += GND


# ==============================================================================
# BLOCK 5 - GPS : ATGM336H-5N31
# ==============================================================================
U3 = Part('RF_GPS', 'ATGM336H', footprint='RF_GPS:ATGM336H')
U3['VCC'] += V3V3
U3['GND'] += GND

C_GPS = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
C_GPS[1] += V3V3
C_GPS[2] += GND

# GPS UART -> ESP32 connection
GPS_TX = Net('GPS_TX')
GPS_RX = Net('GPS_RX')
U3['TX'] += GPS_TX
U3['RX'] += GPS_RX
U1['IO26'] += GPS_TX
U1['IO27'] += GPS_RX

J_ANT_GPS = Part('Connector', 'Conn_Coaxial', footprint='Connector_Coaxial:U.FL_Hirose_U.FL-R-SMT-1_Vertical')
J_ANT_GPS[1] += U3['ANT']
J_ANT_GPS[2] += GND


# ==============================================================================
# BLOCK 6 - I2C SENSORS
# ==============================================================================
SDA = Net('SDA')
SCL = Net('SCL')

U1['IO21'] += SDA
U1['IO22'] += SCL

R_SDA = Part('Device', 'R', value='4.7k', footprint='Resistor_SMD:R_0603_1608Metric')
R_SCL = Part('Device', 'R', value='4.7k', footprint='Resistor_SMD:R_0603_1608Metric')
R_SDA[1] += V3V3; R_SDA[2] += SDA
R_SCL[1] += V3V3; R_SCL[2] += SCL

# ---- IMU : LSM6DS3TR-C -----------------------------------------------------
U4 = Part('Sensor_Motion', 'LSM6DS3', footprint='Package_LGA:LGA-14_3x2.5mm_P0.5mm')
U4['VDD']   += V3V3
U4['VDDIO'] += V3V3
U4['GND']   += GND
U4['SDA']   += SDA
U4['SCL']   += SCL
U4['INT1']  += U1['IO34']

C_IMU = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
C_IMU[1] += V3V3
C_IMU[2] += GND

# Setup I2C address & mode pins to prevent erratic bus floating behaviour
R_IMU_CS = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')
R_IMU_CS[1] += V3V3
U4['.*CS.*'] += R_IMU_CS[2]  # CS high enables I2C interface

R_IMU_SDO = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')
R_IMU_SDO[1] += GND
U4['.*SDO.*'] += R_IMU_SDO[2] # Pull-down defines I2C Address as 0x6A

# ---- FUEL GAUGE : BQ34Z100-G1 (C91302) --------------------------------------
U5 = Part('Battery_Management', 'BQ34Z100', footprint='Package_SO:TSSOP-14_4.4x5mm_P0.65mm')
U5['VCC'] += V3V3
U5['VSS'] += GND
U5['SDA'] += SDA
U5['SCL'] += SCL

# Low-side sense shunt configuration
R_SHUNT = Part('Device', 'R_Shunt', value='5m/2W', footprint='Resistor_SMD:R_2512_6332Metric')
PACK_NEG = Net('PACK_NEG')
R_SHUNT[1] += PACK_NEG
R_SHUNT[2] += GND
U5['SRP'] += PACK_NEG
U5['SRN'] += GND

# Redesigned Voltage Divider: Bottom resistor reduced to 30.1k to keep BAT sense below 0.9V limit at 30.8V maximum charge
R_BV1 = Part('Device', 'R', value='1M',   footprint='Resistor_SMD:R_0603_1608Metric')
R_BV2 = Part('Device', 'R', value='30.1k', footprint='Resistor_SMD:R_0603_1608Metric')
BAT_SENSE = Net('BAT_SENSE')
R_BV1[1] += VBAT
R_BV1[2] += BAT_SENSE
R_BV2[1] += BAT_SENSE
R_BV2[2] += GND
U5['BAT'] += BAT_SENSE


# ==============================================================================
# BLOCK 7 - 1-WIRE TEMPERATURE : DS18B20
# ==============================================================================
U6 = Part('Sensor_Temperature', 'DS18B20', footprint='Package_TO_SOT_THT:TO-92_Inline')
ONEWIRE = Net('ONEWIRE')
U6['VDD'] += V3V3
U6['GND'] += GND
U6['DQ']  += ONEWIRE
U1['IO25'] += ONEWIRE

R_OW = Part('Device', 'R', value='4.7k', footprint='Resistor_SMD:R_0603_1608Metric')
R_OW[1] += V3V3
R_OW[2] += ONEWIRE


# ==============================================================================
# BLOCK 8 - HALL SPEED SENSOR : A3144
# ==============================================================================
U7 = Part('Sensor', 'A3144', footprint='Package_TO_SOT_THT:TO-92_Inline')
HALL = Net('HALL_SPEED')
U7['VCC'] += V3V3
U7['GND'] += GND
U7['OUT'] += HALL
U1['IO35'] += HALL

R_HALL = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')
R_HALL[1] += V3V3
R_HALL[2] += HALL


# ==============================================================================
# BLOCK 9 - OUTPUTS : buzzer, LED, tamper switch
# ==============================================================================
# ---- Buzzer drive -----------------------------------------------------------
BUZZ = Net('BUZZER')
Q_BUZZ = Part('Device', 'Q_NMOS_GSD', value='2N7002', footprint='Package_TO_SOT_SMD:SOT-23')
BZ = Part('Device', 'Buzzer', footprint='Buzzer_Beeper:Buzzer_12x9.5RM7.6mm')
D_FLY = Part('Device', 'D', value='1N4148W', footprint='Diode_SMD:D_SOD-123')
R_BUZZ_G = Part('Device', 'R', value='100', footprint='Resistor_SMD:R_0603_1608Metric')

U1['IO32'] += R_BUZZ_G[1]
R_BUZZ_G[2] += Q_BUZZ['G']
Q_BUZZ['S'] += GND
BZ[1] += V5
BZ[2] += Q_BUZZ['D']
D_FLY['A'] += Q_BUZZ['D']
D_FLY['K'] += V5

# ---- Status LED ------------------------------------------------------------
D_LED = Part('Device', 'LED', footprint='LED_SMD:LED_0603_1608Metric')
R_LED = Part('Device', 'R', value='1k', footprint='Resistor_SMD:R_0603_1608Metric')
U1['IO33'] += R_LED[1]
R_LED[2] += D_LED['A']
D_LED['K'] += GND

# ---- Tamper Switch ---------------------------------------------------------
TAMPER = Net('TAMPER')
J_TAMP = Part('Connector', 'Conn_01x02', footprint='Connector_JST:JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical')
R_TAMP = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')
J_TAMP[1] += TAMPER
J_TAMP[2] += GND
R_TAMP[1] += V3V3
R_TAMP[2] += TAMPER
U1['IO39'] += TAMPER


# ==============================================================================
# BLOCK 10 - WHEEL LOCK / POWER CUTOUT
# ==============================================================================
LOCK = Net('WHEEL_LOCK')
Q_LOCK   = Part('Device', 'Q_NMOS_GSD', value='AO3400', footprint='Package_TO_SOT_SMD:SOT-23')
K_LOCK   = Part('Relay', 'FINDER-32.21-x000', footprint='Relay_THT:Relay_SPDT_SANYOU_SRD_Series_Form_C')
D_LOCK   = Part('Device', 'D', value='1N4007', footprint='Diode_SMD:D_SMA')
R_LOCK_G = Part('Device', 'R', value='100',  footprint='Resistor_SMD:R_0603_1608Metric')
R_LOCK_PD= Part('Device', 'R', value='10k',  footprint='Resistor_SMD:R_0603_1608Metric')

U1['IO13'] += R_LOCK_G[1]
R_LOCK_G[2] += Q_LOCK['G']
R_LOCK_PD[1] += Q_LOCK['G']
R_LOCK_PD[2] += GND
Q_LOCK['S'] += GND

RELAY_COIL = Net('RELAY_COIL')
Q_LOCK['D'] += RELAY_COIL
K_LOCK[1] += V5
K_LOCK[2] += RELAY_COIL
D_LOCK['A'] += RELAY_COIL
D_LOCK['K'] += V5

J_LOCK = Part('Connector', 'Conn_01x02', footprint='TerminalBlock:TerminalBlock_bornier-2_P5.08mm')
J_LOCK[1] += K_LOCK[3]
J_LOCK[2] += K_LOCK[4]


# ==============================================================================
# BLOCK 11 - USB PROGRAMMING (CH340C USB-UART & AUTO-PROGRAMMING RESETS)
# ==============================================================================
J_USB = Part('Connector', 'USB_C_Receptacle_USB2.0', footprint='Connector_USB:USB_C_Receptacle_XKB_U262-16XN-4BVC11')
U8 = Part('Interface_USB', 'CH340C', footprint='Package_SO:SOIC-16_3.9x9.9mm_P1.27mm')

USB_DP = Net('USB_DP')
USB_DM = Net('USB_DM')
VUSB   = Net('VUSB')

J_USB['VBUS'] += VUSB
J_USB['GND']  += GND
J_USB['D+']   += USB_DP
J_USB['D-']   += USB_DM

# Power configuration
U8['VCC'] += V3V3
U8['GND'] += GND

# Since CH340C runs on 3.3V, V3 pin MUST be connected directly to VCC (3.3V)
U8['V3']  += V3V3
C_V3 = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
C_V3[1] += V3V3; C_V3[2] += GND

U8['UD+'] += USB_DP
U8['UD-'] += USB_DM
U8['TXD'] += U1['RXD0']
U8['RXD'] += U1['TXD0']

C_USB = Part('Device', 'C', value='100nF', footprint='Capacitor_SMD:C_0603_1608Metric')
C_USB[1] += V3V3
C_USB[2] += GND

# Dual-transistor auto-flashing circuit (RTS/DTR cross-coupling logic)
Q1 = Part('Device', 'Q_NPN_BEC', value='MMBT3904', footprint='Package_TO_SOT_SMD:SOT-23')
Q2 = Part('Device', 'Q_NPN_BEC', value='MMBT3904', footprint='Package_TO_SOT_SMD:SOT-23')
R_RTS = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')
R_DTR = Part('Device', 'R', value='10k', footprint='Resistor_SMD:R_0603_1608Metric')

# Connect auto-program logic with regex protection to keep symbol pins compatible
U8['.*RTS.*'] += R_RTS[1]
R_RTS[2] += Q1['B']
U8['.*DTR.*'] += Q1['E']
U1['IO0'] += Q1['C']

U8['.*DTR.*'] += R_DTR[1]
R_DTR[2] += Q2['B']
U8['.*RTS.*'] += Q2['E']
U1['EN'] += Q2['C']

# Type-C CC Configuration
R_CC1 = Part('Device', 'R', value='5.1k', footprint='Resistor_SMD:R_0603_1608Metric')
R_CC2 = Part('Device', 'R', value='5.1k', footprint='Resistor_SMD:R_0603_1608Metric')
R_CC1[1] += J_USB['CC1']; R_CC1[2] += GND
R_CC2[1] += J_USB['CC2']; R_CC2[2] += GND


# ==============================================================================
# GENERATE NETLIST
# ==============================================================================
ERC()
generate_netlist(file_='wheelchair_telematics.net')

print("""
================================================================================
 SUCCESS: NETLIST GENERATED -> wheelchair_telematics.net
================================================================================
""")