# Wheelchair PCB Project Context

## 2025-01-01 -- Initial schematic: ESP32-WROOM-32 + ICM-42688-P IMU via SPI

### Components placed
- **U1**: ESP32-WROOM-32 module (RF_Module:ESP32-WROOM-32)
- **U2**: ICM-42688-P 6-axis IMU (Package_LGA:LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y) -- CORRECTED from LGA-14_3x3mm to match actual 2.5x3mm package
- **C1**: 100nF decoupling cap on ESP32 3V3 rail (0402)
- **C2**: 100nF decoupling cap on IMU VDD/VDDIO rails (0402)
- **R1**: 1kΩ pull-up resistor on IMU INT1 line to 3V3 (0402)

### Interface: SPI (VSPI bus on ESP32)
| ESP32 GPIO | ESP32 Pin | Signal  | ICM-42688-P Pin |
|-----------|-----------|---------|-----------------|
| GPIO18    | 30        | SPI_SCK  | Pin 13 (SCLK)   |
| GPIO19    | 31        | SPI_MISO | Pin 1  (SDO)    |
| GPIO23    | 37        | SPI_MOSI | Pin 14 (SDI)    |
| GPIO5     | 29        | IMU_CS   | Pin 12 (CS)     |
| GPIO4     | 26        | IMU_INT  | Pin 4  (INT1)   |

### Design decisions
- Chose SPI over I2C for faster data rates (up to 24 MHz) — suitable for wheelchair motion sensing
- ICM-42688-P RESV pins 2, 3, 10, 11 are no-connect; RESV pin 7 tied to GND per datasheet
- ICM-42688-P FSYNC/INT2 pin 9 tied to GND (not used)
- R1 pull-up on INT1 ensures defined high state when IMU is not asserting interrupt
- PWR_FLAG symbols on +3V3 and GND rails to satisfy ERC

## 2025-07-14 -- PCB Layout setup

### Status
- Board outline: 70x55mm written to wheelchairpcb.trace_pcb and wheelchairpcb.kicad_pcb
- wheelchairpcb.kicad_sch has been written directly with full schematic content (bypassing trace_sch conversion timeout)
- Footprints U1, U2, C1, C2, R1 written to kicad_pcb with correct net assignments
- ISSUE: Live schematic editor is blank -- user needs to reload from disk

### BLOCKER: Schematic editor reload required
- The kicad_sch file has correct content but live editor isn't showing it
- User must use File > Revert in schematic editor, OR close/reopen the schematic file
- Once schematic reloads, run Tools > Update PCB from Schematic (F8)
- After footprints appear in PCB editor, I can place them and autoroute

### Planned placement (70x55mm board)
- U1 (ESP32-WROOM-32): center at (35, 40) -- large module, needs central placement
- U2 (ICM-42688-P): center at (65, 37) -- right side, close to ESP32 SPI pins
- C1 (100nF): at (20, 27) -- near ESP32 3V3 pin
- C2 (100nF): at (65, 34) -- 3mm above U2, tight decoupling
- R1 (1kΩ): at (55, 33) -- between ESP32 and IMU, on INT signal path
- GND zone: full board fill both layers
