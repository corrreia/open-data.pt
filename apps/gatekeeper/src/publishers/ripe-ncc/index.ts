import type { PublisherDefinition } from "../../catalog/define";

export const PUBLISHER: PublisherDefinition = {
  name: "RIPE NCC",
  url: "https://www.ripe.net/",
  logo: "svg",
  // Held: the RIPEstat and RIPE Atlas service terms (Articles 3.3 and 3.5) bar re-packaging and redistributing
  // their data, and Atlas adds that third parties need prior written authorisation. Keyless access is not
  // permission. Asked, awaiting an answer. https://www.ripe.net/about-us/legal/terms-of-service/
  enabled: false,
};
