/**
 * Where the sun stands over a place at an instant, to light the map as the country is lit. The
 * low-precision formulas of the Astronomical Almanac: good to a hundredth of a degree this century.
 */

export interface SunPosition {
  /** Degrees above the horizon; negative at night. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

const RADIANS = Math.PI / 180;

export function sunPosition(at: Date, longitude: number, latitude: number): SunPosition {
  const days = at.getTime() / 86_400_000 - 10_957.5;
  const meanLongitude = (280.46 + 0.985_647_4 * days) % 360;
  const anomaly = ((357.528 + 0.985_600_3 * days) % 360) * RADIANS;
  const ecliptic = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RADIANS;
  const obliquity = (23.439 - 0.000_000_4 * days) * RADIANS;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const siderealHours = 18.697_374_558 + 24.065_709_824_419_08 * days;
  const hourAngle = ((siderealHours * 15 + longitude) % 360) * RADIANS - rightAscension;
  const phi = latitude * RADIANS;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(declination) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle));
  return { elevation: elevation / RADIANS, azimuth: (azimuth / RADIANS + 360) % 360 };
}
