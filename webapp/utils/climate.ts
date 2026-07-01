// ===========================================================================
//  climate.ts — DHT22 ambient-climate derivations
//  Direct 1:1 port of the formulas in
//  firmware/hardware_test_lab/dht_test/dht_test.ino so the website reports the
//  same units and values the sensor firmware would. Inputs are the telemetry
//  fields temp_amb (°C) and humidity (%) already uploaded by the device.
// ===========================================================================

// Magnus-Tetens approximation, valid for typical ambient ranges.
export function calcDewPointC(tempC: number, humPct: number): number {
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * tempC) / (b + tempC) + Math.log(humPct / 100.0);
  return (b * alpha) / (a - alpha);
}

// NOAA Rothfusz regression. The formula is defined in Fahrenheit, so we
// convert in, compute, and convert back out to Celsius.
export function calcHeatIndexC(tempC: number, humPct: number): number {
  const T = (tempC * 9.0) / 5.0 + 32.0; // to Fahrenheit
  const R = humPct;

  // Simple formula first (Steadman); used as-is below ~80°F where the full
  // regression isn't valid / not meaningfully different.
  const simpleHI = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + R * 0.094);

  let hiF: number;
  if ((simpleHI + T) / 2.0 < 80.0) {
    hiF = simpleHI;
  } else {
    // Full Rothfusz regression
    hiF =
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      0.00683783 * T * T -
      0.05481717 * R * R +
      0.00122874 * T * T * R +
      0.00085282 * T * R * R -
      0.00000199 * T * T * R * R;

    // Low-humidity adjustment
    if (R < 13.0 && T >= 80.0 && T <= 112.0) {
      const adj = ((13.0 - R) / 4.0) * Math.sqrt((17.0 - Math.abs(T - 95.0)) / 17.0);
      hiF -= adj;
    }
    // High-humidity adjustment
    if (R > 85.0 && T >= 80.0 && T <= 87.0) {
      const adj = ((R - 85.0) / 10.0) * ((87.0 - T) / 5.0);
      hiF += adj;
    }
  }

  return ((hiF - 32.0) * 5.0) / 9.0; // back to Celsius
}

// Classic dew-point comfort scale (meteorological standard).
export function classifyComfort(dewC: number): string {
  if (dewC < 10.0) return 'Dry, very comfortable';
  if (dewC < 13.0) return 'Comfortable';
  if (dewC < 16.0) return 'Comfortable, slightly humid';
  if (dewC < 18.0) return 'Somewhat uncomfortable, sticky';
  if (dewC < 21.0) return 'Uncomfortable, humid';
  if (dewC < 24.0) return 'Very humid, quite uncomfortable';
  return 'Oppressive, extremely humid';
}

// Hydration/clothing guidance from heat index (feels-like), adapted from the
// NOAA heat-index caution categories.
export function classifyAdvice(hiC: number): string {
  if (hiC < 27.0) return 'Normal conditions. No special precautions needed.';
  if (hiC < 32.0) return 'Caution: stay hydrated; light, breathable clothing recommended.';
  if (hiC < 39.0)
    return 'Extreme caution: drink water regularly; avoid heavy exertion; wear light, loose clothing.';
  if (hiC < 51.0)
    return 'Danger: limit outdoor activity; hydrate frequently; wear minimal, breathable clothing; seek shade/cooling.';
  return 'Extreme danger: avoid exposure; hydrate constantly; seek air conditioning immediately.';
}

export interface ClimateInfo {
  tempC: number;
  humidity: number;
  dewPointC: number;
  heatIndexC: number;
  comfort: string;
  advice: string;
  // A coarse severity used for tinting the UI: 0 comfortable, 1 caution, 2 danger.
  severity: 0 | 1 | 2;
}

// Convenience: derive the full climate picture from the two raw sensor fields.
export function deriveClimate(tempC: number, humidity: number): ClimateInfo {
  const dewPointC = calcDewPointC(tempC, humidity);
  const heatIndexC = calcHeatIndexC(tempC, humidity);
  const severity: 0 | 1 | 2 = heatIndexC >= 39 || dewPointC >= 24 ? 2 : heatIndexC >= 32 || dewPointC >= 18 ? 1 : 0;
  return {
    tempC,
    humidity,
    dewPointC,
    heatIndexC,
    comfort: classifyComfort(dewPointC),
    advice: classifyAdvice(heatIndexC),
    severity,
  };
}
