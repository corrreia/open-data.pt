import type { CanonicalRecord, CanonicalSchema, JsonObject, JsonValue, ProductBuild, SeriesPoint, TransformContext, TransformResult } from "#/index";
import { field, lisbonToUtc, sha256Hex, isJsonBoolean, isJsonNumber, isJsonObject, isJsonString, parseJsonBytes } from "#/index";

const LATEST_STATION_SCHEMA: CanonicalSchema = {
  fields: [
    field("stationId", "identifier", false),
    field("stationName", "string", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("observationTime", "datetime", false),
    field("temperature", "number", true, "°C"),
    field("humidity", "number", true, "%"),
    field("windSpeed", "number", true, "km/h"),
    field("precipitation", "number", true, "mm"),
    field("pressure", "number", true, "hPa"),
  ],
};

const OBSERVATION_SERIES_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

const FORECAST_SCHEMA: CanonicalSchema = {
  fields: [
    field("cityForecastId", "identifier", false),
    field("cityId", "identifier", false),
    field("city", "string", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("forecastDate", "date", false),
    field("weatherType", "category", false),
    field("weatherTypeId", "identifier", false),
    field("minimumTemperature", "number", true, "°C"),
    field("maximumTemperature", "number", true, "°C"),
    field("precipitationProbability", "number", true, "%"),
    field("windDirection", "category", true),
    field("windSpeedClass", "category", true),
  ],
};

const EARTHQUAKE_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("time", "datetime", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("magnitude", "number", true),
    field("depth", "number", true, "km"),
    field("local", "string", true),
    field("region", "category", true),
    field("sensed", "boolean", true),
    field("source", "category", true),
  ],
};

const WARNING_SCHEMA: CanonicalSchema = {
  fields: [
    field("warningId", "identifier", false),
    field("areaCode", "category", false),
    field("area", "category", false),
    field("type", "category", false),
    { ...field("level", "category", false), display: { badge: { colorField: "levelColor" } } },
    field("levelColor", "color", false),
    field("startTime", "datetime", false),
    field("endTime", "datetime", false),
    field("text", "string", true),
  ],
};

const UV_SCHEMA: CanonicalSchema = {
  fields: [
    field("uvForecastId", "identifier", false),
    field("locationId", "identifier", false),
    field("location", "string", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("date", "date", false),
    field("period", "category", false),
    field("uvIndex", "number", false, "UV index"),
  ],
};

const FIRE_RISK_SCHEMA: CanonicalSchema = {
  fields: [
    field("fireRiskId", "identifier", false),
    field("municipalityCode", "identifier", false),
    field("municipality", "category", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("riskLevel", "number", false),
    { ...field("riskLabel", "category", false), display: { badge: { colorField: "riskColor" } } },
    field("riskColor", "color", false),
    field("forecastDate", "date", false),
  ],
};

const SEA_FORECAST_SCHEMA: CanonicalSchema = {
  fields: [
    field("seaForecastId", "identifier", false),
    field("locationId", "identifier", false),
    field("location", "string", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("forecastDate", "date", false),
    field("waveDirection", "category", true),
    field("wavePeriodMin", "number", true, "s"),
    field("wavePeriodMax", "number", true, "s"),
    field("totalSeaMin", "number", true, "m"),
    field("totalSeaMax", "number", true, "m"),
    field("waveHeightMin", "number", true, "m"),
    field("waveHeightMax", "number", true, "m"),
    field("seaSurfaceTemperatureMin", "number", true, "°C"),
    field("seaSurfaceTemperatureMax", "number", true, "°C"),
  ],
};

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface StationReading {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  observationTime: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  precipitation: number | null;
  pressure: number | null;
}

const MEASURES = [
  { source: "temperatura", payload: "temperature", suffix: "temperature", unit: "°C" },
  { source: "humidade", payload: "humidity", suffix: "humidity", unit: "%" },
  { source: "intensidadeVentoKM", payload: "windSpeed", suffix: "wind-speed", unit: "km/h" },
  { source: "precAcumulada", payload: "precipitation", suffix: "precipitation", unit: "mm" },
  { source: "pressao", payload: "pressure", suffix: "pressure", unit: "hPa" },
] as const;

export class IpmaTransformer {
  readonly id = "ipma-open-data";
  readonly version = "3";

  async transform(bytes: Uint8Array, context: TransformContext): Promise<TransformResult> {
    let value: JsonValue;
    try {
      value = parseJsonBytes(bytes);
    } catch {
      throw new Error("IPMA captured document must be valid JSON");
    }
    if (!isJsonObject(value)) throw new Error("IPMA captured document must be an object");

    let result: Omit<TransformResult, "transformer">;
    switch (context.feed.config.feed) {
      case "station-observations":
        result = transformStationObservations(value);
        break;
      case "daily-forecast":
        result = transformDailyForecast(value);
        break;
      case "seismic":
        result = await transformSeismic(value);
        break;
      case "warnings":
        result = transformWarnings(value);
        break;
      case "uv-index":
        result = transformUvIndex(value);
        break;
      case "fire-risk":
        result = transformFireRisk(value);
        break;
      case "sea-forecast":
        result = transformSeaForecast(value);
        break;
      default:
        throw new Error(`Unsupported IPMA feed: ${context.feed.config.feed}`);
    }
    return { ...result, transformer: { id: this.id, version: this.version } };
  }
}

function transformStationObservations(root: JsonObject): Omit<TransformResult, "transformer"> {
  if (!Array.isArray(root.stations) || !isJsonObject(root.observations)) {
    throw new Error("IPMA station document requires stations and observations");
  }

  const stations = new Map<string, Station>();
  for (const value of root.stations) {
    if (!isJsonObject(value) || !isJsonObject(value.properties) || !isJsonObject(value.geometry)) continue;
    const id = identifier(value.properties.idEstacao);
    const name = nonEmptyString(value.properties.localEstacao);
    const coordinates = value.geometry.coordinates;
    if (!id || !name || !Array.isArray(coordinates)) continue;
    const longitude = finiteNumber(coordinates[0]);
    const latitude = finiteNumber(coordinates[1]);
    if (latitude === null || longitude === null) continue;
    stations.set(id, { id, name, latitude, longitude });
  }

  const latest = new Map<string, StationReading>();
  const points: SeriesPoint[] = [];
  let malformedHours = 0;
  const hours = Object.entries(root.observations).sort(([left], [right]) => left.localeCompare(right));
  for (const [rawTime, stationValues] of hours) {
    const observationTime = utcDateTime(rawTime);
    if (!observationTime || !isJsonObject(stationValues)) {
      malformedHours += 1;
      continue;
    }
    for (const [stationId, rawReading] of Object.entries(stationValues)) {
      if (!isJsonObject(rawReading)) continue;
      const station = stations.get(stationId);
      if (!station) continue;
      const reading: StationReading = {
        stationId,
        stationName: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        observationTime,
        temperature: measurement(rawReading.temperatura),
        humidity: measurement(rawReading.humidade),
        windSpeed: measurement(rawReading.intensidadeVentoKM),
        precipitation: measurement(rawReading.precAcumulada),
        pressure: measurement(rawReading.pressao),
      };
      let hasMeasurement = false;
      for (const measure of MEASURES) {
        const value = reading[measure.payload];
        if (value === null) continue;
        hasMeasurement = true;
        points.push({
          seriesKey: `${stationId}:${measure.suffix}`,
          eventTime: observationTime,
          value,
          unit: measure.unit,
          dimensions: { station: stationId, stationName: station.name },
        });
      }
      if (hasMeasurement) latest.set(stationId, reading);
    }
  }

  const records: CanonicalRecord[] = [...latest.values()]
    .sort((left, right) => left.stationId.localeCompare(right.stationId))
    .map((reading) => ({
      entityKey: reading.stationId,
      eventTime: reading.observationTime,
      payload: { ...reading },
    }));
  points.sort((left, right) => left.eventTime.localeCompare(right.eventTime) || left.seriesKey.localeCompare(right.seriesKey));
  const watermark = points.map((point) => point.eventTime).at(-1);
  const products: ProductBuild[] = [
    {
      productKey: "stations-latest",
      slug: "ipma-stations-latest",
      title: "IPMA station observations",
      description: "The newest available hourly meteorological reading for each IPMA station.",
      role: "current-state",
      schema: LATEST_STATION_SCHEMA,
      records,
      kind: "record",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
    {
      productKey: "observations",
      slug: "ipma-observations",
      title: "IPMA hourly observations",
      description: "Hourly temperature, humidity, wind, precipitation, and pressure measurements by station.",
      role: "time-series",
      schema: OBSERVATION_SERIES_SCHEMA,
      points,
      kind: "series",
      updateMode: "delta",
      completeness: "complete",
    },
  ];
  if (watermark) for (const product of products) product.watermark = watermark;
  return {
    products,
    quality: { acceptedRecords: records.length + points.length, rejectedRecords: malformedHours },
  };
}

function transformDailyForecast(root: JsonObject): Omit<TransformResult, "transformer"> {
  if (!Array.isArray(root.forecasts) || !isJsonObject(root.cities) || !isJsonObject(root.weatherTypes) || !isJsonObject(root.windSpeedClasses)) {
    throw new Error("IPMA forecast document requires forecasts, cities, weatherTypes, and windSpeedClasses");
  }
  const cities = lookup(root.cities.data, "globalIdLocal", "local");
  const weatherTypes = lookup(root.weatherTypes.data, "idWeatherType", "descWeatherTypePT");
  const windClasses = lookup(root.windSpeedClasses.data, "classWindSpeed", "descClassWindSpeedDailyPT");
  const records: CanonicalRecord[] = [];
  let candidates = 0;

  for (const forecast of root.forecasts) {
    if (!isJsonObject(forecast) || !Array.isArray(forecast.data)) continue;
    const forecastDate = dateOnly(forecast.forecastDate);
    // `dataUpdate` is when IPMA last rebuilt the document, not part of any forecast: it moves every hour while the
    // forecasts stand. It stays out of the payload and off the record, so an unchanged forecast is no revision; the
    // collector already states it once for the whole document, as provenance.
    if (!forecastDate || !utcDateTime(forecast.dataUpdate)) {
      candidates += forecast.data.length;
      continue;
    }
    for (const value of forecast.data) {
      candidates += 1;
      if (!isJsonObject(value)) continue;
      const cityId = identifier(value.globalIdLocal);
      const latitude = finiteNumber(value.latitude);
      const longitude = finiteNumber(value.longitude);
      const weatherTypeId = identifier(value.idWeatherType);
      if (!cityId || latitude === null || longitude === null || !weatherTypeId) continue;
      const cityForecastId = `${cityId}:${forecastDate}`;
      records.push({
        entityKey: cityForecastId,
        eventTime: `${forecastDate}T00:00:00.000Z`,
        payload: {
          cityForecastId,
          cityId,
          city: cities.get(cityId) ?? cityId,
          latitude,
          longitude,
          forecastDate,
          weatherType: weatherTypes.get(weatherTypeId) ?? `Tipo ${weatherTypeId}`,
          weatherTypeId,
          minimumTemperature: measurement(value.tMin),
          maximumTemperature: measurement(value.tMax),
          precipitationProbability: measurement(value.precipitaProb),
          windDirection: nullableString(value.predWindDir),
          windSpeedClass: windClasses.get(identifier(value.classWindSpeed) ?? "") ?? nullableString(value.classWindSpeed),
        },
      });
    }
  }
  records.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const watermark = records
    .map((record) => record.eventTime)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const product: ProductBuild = {
    productKey: "forecast-daily",
    slug: "ipma-forecast-daily",
    title: "IPMA daily city forecasts",
    description: "Three-day temperature, precipitation, weather type, and wind forecasts by city.",
    role: "reference",
    schema: FORECAST_SCHEMA,
    records,
    kind: "record",
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  };
  if (watermark) product.watermark = watermark;
  return {
    products: [product],
    quality: quality(candidates, records.length),
  };
}

async function transformSeismic(root: JsonObject): Promise<Omit<TransformResult, "transformer">> {
  const areas = [root.mainlandMadeira, root.azores];
  if (areas.some((area) => !isJsonObject(area) || !Array.isArray(area.data))) {
    throw new Error("IPMA seismic document requires mainlandMadeira and azores data");
  }
  const candidates = areas.reduce<number>((count, area) => count + (isJsonObject(area) && Array.isArray(area.data) ? area.data.length : 0), 0);
  const records: CanonicalRecord[] = [];
  for (const area of areas) {
    if (!isJsonObject(area) || !Array.isArray(area.data)) continue;
    for (const value of area.data) {
      if (!isJsonObject(value)) continue;
      const time = utcDateTime(value.time);
      const latitude = finiteNumber(value.lat);
      const longitude = finiteNumber(value.lon);
      if (!time || latitude === null || longitude === null) continue;
      const magnitude = measurement(value.magnitud);
      const sourceId = nonEmptyString(value.sismoId);
      const id = sourceId ?? `ipma-${(await sha256Hex(`${time}|${latitude}|${longitude}|${magnitude ?? "missing"}`)).slice(0, 24)}`;
      const sourcePublishedAt = utcDateTime(value.dataUpdate);
      const record: CanonicalRecord = {
        entityKey: id,
        operation: "upsert",
        eventTime: time,
        payload: {
          id,
          time,
          latitude,
          longitude,
          magnitude,
          depth: measurement(value.depth),
          local: nullableString(value.local),
          region: nullableString(value.obsRegion),
          sensed: isJsonBoolean(value.sensed) ? value.sensed : null,
          source: nullableString(value.source),
        },
      };
      if (sourcePublishedAt) record.sourcePublishedAt = sourcePublishedAt;
      records.push(record);
    }
  }
  records.sort((left, right) => String(left.eventTime).localeCompare(String(right.eventTime)) || left.entityKey.localeCompare(right.entityKey));
  const watermark = records
    .map((record) => record.eventTime)
    .filter((value): value is string => Boolean(value))
    .at(-1);
  const product: ProductBuild = {
    productKey: "earthquakes",
    slug: "ipma-earthquakes",
    title: "IPMA seismic events",
    description: "Seismic events observed in mainland Portugal, Madeira, and the Azores during the last 30 days.",
    role: "event-log",
    schema: EARTHQUAKE_SCHEMA,
    records,
    kind: "record",
    updateMode: "source-window",
    completeness: "complete",
  };
  if (watermark) product.watermark = watermark;
  return {
    products: [product],
    quality: quality(candidates, records.length),
  };
}

const WARNING_LEVELS = {
  green: { rank: 1, color: "#2e7d32" },
  yellow: { rank: 2, color: "#f9a825" },
  orange: { rank: 3, color: "#ef6c00" },
  red: { rank: 4, color: "#c62828" },
} as const;

type WarningLevel = keyof typeof WARNING_LEVELS;

function transformWarnings(root: JsonObject): Omit<TransformResult, "transformer"> {
  if (!Array.isArray(root.warnings) || !isJsonObject(root.areas)) {
    throw new Error("IPMA warning document requires warnings and areas");
  }
  const areas = lookup(root.areas.data, "idAreaAviso", "local");
  const byId = new Map<string, CanonicalRecord>();
  let malformed = 0;
  let consolidated = 0;
  for (const value of root.warnings) {
    if (!isJsonObject(value)) {
      malformed += 1;
      continue;
    }
    const areaCode = nonEmptyString(value.idAreaAviso);
    const type = nonEmptyString(value.awarenessTypeName);
    const level = warningLevel(value.awarenessLevelID);
    const startTime = lisbonDateTime(value.startTime);
    const endTime = lisbonDateTime(value.endTime);
    if (!areaCode || !type || !level || !startTime || !endTime) {
      malformed += 1;
      continue;
    }
    const warningId = `${areaCode}:${type}:${String(value.startTime).trim()}`;
    const record: CanonicalRecord = {
      entityKey: warningId,
      operation: "upsert",
      eventTime: startTime,
      validFrom: startTime,
      validTo: endTime,
      payload: {
        warningId,
        areaCode,
        area: areas.get(areaCode) ?? areaCode,
        type,
        level,
        levelColor: WARNING_LEVELS[level].color,
        startTime,
        endTime,
        text: nullableString(value.text),
      },
    };
    const previous = byId.get(warningId);
    if (previous) {
      consolidated += 1;
      const previousLevel = warningLevel(previous.payload.level);
      if (previousLevel && WARNING_LEVELS[previousLevel].rank > WARNING_LEVELS[level].rank) continue;
    }
    byId.set(warningId, record);
  }
  const records = [...byId.values()].sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const watermark = records
    .map((record) => record.eventTime)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const product: ProductBuild = {
    productKey: "warnings",
    slug: "ipma-warnings",
    title: "IPMA weather warnings",
    description: "Weather warnings by district or island, with severity and validity periods.",
    role: "event-log",
    schema: WARNING_SCHEMA,
    records,
    kind: "record",
    updateMode: "source-window",
    completeness: "complete",
  };
  if (watermark) product.watermark = watermark;
  return {
    products: [product],
    quality: { acceptedRecords: records.length, rejectedRecords: malformed },
  };
}

interface Location {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

function transformUvIndex(root: JsonObject): Omit<TransformResult, "transformer"> {
  if (!Array.isArray(root.uv) || !isJsonObject(root.cities)) {
    throw new Error("IPMA UV document requires uv and cities");
  }
  const cities = locationLookup(root.cities.data);
  const selected = new Map<string, { location: Location; date: string; period: string; uvIndex: number }>();
  let rejected = 0;
  for (const value of root.uv) {
    if (!isJsonObject(value)) {
      rejected += 1;
      continue;
    }
    const locationId = identifier(value.globalIdLocal);
    const location = locationId ? cities.get(locationId) : undefined;
    const date = dateOnly(value.data);
    const periodId = identifier(value.idPeriodo);
    const period = nonEmptyString(value.intervaloHora);
    const uvIndex = finiteNumber(value.iUv);
    if (!locationId || !location || !date || !periodId || !period || uvIndex === null) {
      rejected += 1;
      continue;
    }
    const uvForecastId = `${locationId}:${date}:${periodId}`;
    const previous = selected.get(uvForecastId);
    if (!previous || uvIndex > previous.uvIndex) selected.set(uvForecastId, { location, date, period, uvIndex });
  }
  const records: CanonicalRecord[] = [...selected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([uvForecastId, item]) => ({
      entityKey: uvForecastId,
      eventTime: `${item.date}T12:00:00.000Z`,
      payload: {
        uvForecastId,
        locationId: item.location.id,
        location: item.location.name,
        latitude: item.location.latitude,
        longitude: item.location.longitude,
        date: item.date,
        period: item.period,
        uvIndex: item.uvIndex,
      },
    }));
  // One product: the forecast table. A daily-maximum series restated the same
  // values (one forecast period per location and day in practice).
  const watermark =
    records
      .map((record) => record.eventTime ?? "")
      .sort()
      .at(-1) || undefined;
  const products: ProductBuild[] = [
    {
      productKey: "uv-index",
      slug: "ipma-uv-index",
      title: "IPMA UV index forecast",
      description: "UV index forecasts by location, day, and forecast period.",
      role: "reference",
      schema: UV_SCHEMA,
      records,
      kind: "record",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
  ];
  if (watermark) for (const product of products) product.watermark = watermark;
  return {
    products,
    quality: { acceptedRecords: records.length, rejectedRecords: rejected },
  };
}

const FIRE_LEVELS = {
  1: { label: "Reduzido", color: "#2e7d32" },
  2: { label: "Moderado", color: "#f9a825" },
  3: { label: "Elevado", color: "#ef6c00" },
  4: { label: "Muito elevado", color: "#c62828" },
  5: { label: "Máximo", color: "#6a1b9a" },
} as const;

function transformFireRisk(root: JsonObject): Omit<TransformResult, "transformer"> {
  if (!Array.isArray(root.forecasts) || !isJsonObject(root.municipalities)) {
    throw new Error("IPMA fire-risk document requires forecasts and municipalities");
  }
  const municipalityNames = municipalityLookup(root.municipalities.data);
  const records: CanonicalRecord[] = [];
  let candidates = 0;
  for (const forecast of root.forecasts) {
    if (!isJsonObject(forecast) || !isJsonObject(forecast.local)) continue;
    const forecastDate = dateOnly(forecast.dataPrev);
    for (const value of Object.values(forecast.local)) {
      candidates += 1;
      if (!forecastDate || !isJsonObject(value) || !isJsonObject(value.data)) continue;
      const municipalityCode = identifier(value.dico);
      const latitude = finiteNumber(value.latitude);
      const longitude = finiteNumber(value.longitude);
      const riskLevel = fireLevel(value.data.rcm);
      if (!municipalityCode || latitude === null || longitude === null || !riskLevel) continue;
      const fireRiskId = `${municipalityCode}:${forecastDate}`;
      const risk = FIRE_LEVELS[riskLevel];
      records.push({
        entityKey: fireRiskId,
        eventTime: `${forecastDate}T12:00:00.000Z`,
        payload: {
          fireRiskId,
          municipalityCode,
          municipality: municipalityNames.get(municipalityCode) ?? municipalityCode,
          latitude,
          longitude,
          riskLevel,
          riskLabel: risk.label,
          riskColor: risk.color,
          forecastDate,
        },
      });
    }
  }
  records.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const watermark = records
    .map((record) => record.eventTime)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const product: ProductBuild = {
    productKey: "fire-risk",
    slug: "ipma-fire-risk",
    title: "IPMA municipal fire risk",
    description: "Three-day rural fire danger forecasts by municipality code.",
    role: "current-state",
    schema: FIRE_RISK_SCHEMA,
    records,
    kind: "record",
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  };
  if (watermark) product.watermark = watermark;
  return {
    products: [product],
    quality: quality(candidates, records.length),
  };
}

function transformSeaForecast(root: JsonObject): Omit<TransformResult, "transformer"> {
  if (!Array.isArray(root.forecasts) || !Array.isArray(root.locations)) {
    throw new Error("IPMA sea-forecast document requires forecasts and locations");
  }
  const locations = locationLookup(root.locations);
  const records: CanonicalRecord[] = [];
  let candidates = 0;
  for (const forecast of root.forecasts) {
    if (!isJsonObject(forecast) || !Array.isArray(forecast.data)) continue;
    const forecastDate = dateOnly(forecast.forecastDate);
    for (const value of forecast.data) {
      candidates += 1;
      if (!forecastDate || !isJsonObject(value)) continue;
      const locationId = identifier(value.globalIdLocal);
      const location = locationId ? locations.get(locationId) : undefined;
      if (!locationId || !location) continue;
      const seaForecastId = `${locationId}:${forecastDate}`;
      records.push({
        entityKey: seaForecastId,
        eventTime: `${forecastDate}T12:00:00.000Z`,
        payload: {
          seaForecastId,
          locationId,
          location: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          forecastDate,
          waveDirection: nullableString(value.predWaveDir),
          wavePeriodMin: measurement(value.wavePeriodMin),
          wavePeriodMax: measurement(value.wavePeriodMax),
          totalSeaMin: measurement(value.totalSeaMin),
          totalSeaMax: measurement(value.totalSeaMax),
          waveHeightMin: measurement(value.waveHighMin),
          waveHeightMax: measurement(value.waveHighMax),
          seaSurfaceTemperatureMin: measurement(value.sstMin),
          seaSurfaceTemperatureMax: measurement(value.sstMax),
        },
      });
    }
  }
  records.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const watermark = records
    .map((record) => record.eventTime)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const product: ProductBuild = {
    productKey: "sea-forecast",
    slug: "ipma-sea-forecast",
    title: "IPMA sea forecast",
    description: "Three-day wave and sea-surface forecasts for Portuguese coastal locations.",
    role: "reference",
    schema: SEA_FORECAST_SCHEMA,
    records,
    kind: "record",
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  };
  if (watermark) product.watermark = watermark;
  return {
    products: [product],
    quality: quality(candidates, records.length),
  };
}

function locationLookup(value: JsonValue | undefined): Map<string, Location> {
  const result = new Map<string, Location>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!isJsonObject(item)) continue;
    const id = identifier(item.globalIdLocal);
    const name = nonEmptyString(item.local);
    const latitude = finiteNumber(item.latitude);
    const longitude = finiteNumber(item.longitude);
    if (id && name && latitude !== null && longitude !== null) {
      result.set(id, { id, name, latitude, longitude });
    }
  }
  return result;
}

function municipalityLookup(value: JsonValue | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!isJsonObject(item)) continue;
    const district = finiteNumber(item.idDistrito);
    const municipality = finiteNumber(item.idConcelho);
    const name = nonEmptyString(item.local);
    if (district === null || municipality === null || !name) continue;
    result.set(`${String(district).padStart(2, "0")}${String(municipality).padStart(2, "0")}`, name);
  }
  return result;
}

function warningLevel(value: JsonValue | undefined): WarningLevel | undefined {
  // SAFETY: `WARNING_LEVELS` is keyed by the warning levels IPMA publishes, so
  // a value it owns is one of them.
  return isJsonString(value) && Object.hasOwn(WARNING_LEVELS, value) ? (value as WarningLevel) : undefined;
}

function fireLevel(value: JsonValue | undefined): keyof typeof FIRE_LEVELS | undefined {
  const level = finiteNumber(value);
  // SAFETY: `FIRE_LEVELS` is keyed by the danger levels IPMA publishes, so a
  // whole number it owns is one of them.
  return level !== null && Number.isInteger(level) && Object.hasOwn(FIRE_LEVELS, level) ? (level as keyof typeof FIRE_LEVELS) : undefined;
}

function lookup(value: JsonValue | undefined, idField: string, labelField: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!isJsonObject(item)) continue;
    const id = identifier(item[idField]);
    const label = nonEmptyString(item[labelField]);
    if (id && label) result.set(id, label);
  }
  return result;
}

function quality(input: number, accepted: number): TransformResult["quality"] {
  return { acceptedRecords: accepted, rejectedRecords: input - accepted };
}

function identifier(value: JsonValue | undefined): string | undefined {
  if (isJsonString(value) && value.trim() !== "") return value.trim();
  if (isJsonNumber(value) && Number.isFinite(value)) return String(value);
  return undefined;
}

function nonEmptyString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value.trim() : undefined;
}

function nullableString(value: JsonValue | undefined): string | null {
  return nonEmptyString(value) ?? null;
}

function finiteNumber(value: JsonValue | undefined): number | null {
  const parsed = isJsonNumber(value) ? value : isJsonString(value) && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function measurement(value: JsonValue | undefined): number | null {
  const parsed = finiteNumber(value);
  return parsed === null || parsed === -99 ? null : parsed;
}

function dateOnly(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value) || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? undefined : value;
}

function utcDateTime(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value) || value.trim() === "") return undefined;
  const trimmed = value.trim();
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/u.test(trimmed) ? trimmed : `${trimmed}Z`;
  const milliseconds = Date.parse(normalized);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}

/** Convert an IPMA wall-clock timestamp in Europe/Lisbon without relying on the runtime's local zone. */
function lisbonDateTime(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value)) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/u.exec(value.trim());
  return match ? lisbonToUtc(match[1]!, match[2]!) : undefined;
}
