import { GatekeeperError, type JsonValue } from "#/index";

/**
 * How sure the Active Fire Monitoring is of a fire: each CAP message carries
 * one `info` block of the fires it finds likely and one of those it finds
 * possible.
 */
const CERTAINTIES = { Likely: "likely", Possible: "possible" } as const;

/** A message's fires, and how many of its circles did not read. */
export interface CapFires {
  fires: JsonValue[];
  rejected: number;
}

/**
 * Every fire a Meteosat Active Fire Monitoring CAP message lists, as
 * `[latitude, longitude, radius in km, certainty]`. A message lists each fire
 * as a CAP `circle`, "latitude,longitude radius", the pixel it was seen in;
 * a circle that does not read is counted, not kept.
 */
export function readCapFires(xml: string): CapFires {
  if (!/<alert\b[^>]*xmlns="urn:oasis:names:tc:emergency:cap:1\.[12]"/u.test(xml)) throw new GatekeeperError("EUMETSAT's fire message is not a CAP alert", "invalid-response");
  const fires: JsonValue[] = [];
  let rejected = 0;
  for (const [, info = ""] of xml.matchAll(/<info>([\s\S]*?)<\/info>/gu)) {
    if (!/<event>FIRE<\/event>/u.test(info)) throw new GatekeeperError("EUMETSAT's fire message holds an event other than FIRE", "invalid-response");
    const stated = /<certainty>(\w+)<\/certainty>/u.exec(info)?.[1];
    const certainty = stated === "Likely" || stated === "Possible" ? CERTAINTIES[stated] : undefined;
    if (!certainty) throw new GatekeeperError(`EUMETSAT's fire message states an unknown certainty: ${stated ?? "none"}`, "invalid-response");
    for (const [, circle = ""] of info.matchAll(/<circle>([^<]*)<\/circle>/gu)) {
      const parts = /^\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/u.exec(circle);
      const [latitude, longitude, radius] = parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : [Number.NaN, Number.NaN, Number.NaN];
      if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && radius >= 0)) {
        rejected += 1;
        continue;
      }
      fires.push([latitude, longitude, radius, certainty]);
    }
  }
  return { fires, rejected };
}
