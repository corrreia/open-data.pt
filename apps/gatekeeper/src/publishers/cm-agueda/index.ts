import type { PublisherDefinition } from "#/catalog/define";
import { FEED as aguedaBeaguedaStations } from "./feeds/agueda-beagueda-stations";
import { FEED as aguedaChargingLocations } from "./feeds/agueda-charging-locations";
import { FEED as aguedaElectronicsBins } from "./feeds/agueda-electronics-bins";
import { FEED as aguedaFloodMarks } from "./feeds/agueda-flood-marks";
import { FEED as aguedaTextileBins } from "./feeds/agueda-textile-bins";
import { FEED as aguedaWasteBins } from "./feeds/agueda-waste-bins";
import { FEED as aguedaWasteOperators } from "./feeds/agueda-waste-operators";

export const PUBLISHER: PublisherDefinition = {
  name: "Câmara Municipal de Águeda",
  url: "https://www.cm-agueda.pt/",
  // Off until Águeda lets Cloudflare reach its portal: since 24 September 2026 every request from a Worker times out
  // (522), under any User-Agent, while the portal answers everywhere else. Asked of UT-SIG, dv-sig@cm-agueda.pt.
  enabled: false,
  sources: ["dadosabertos.cm-agueda.pt"],
  logo: "png",
  feeds: [aguedaBeaguedaStations, aguedaChargingLocations, aguedaElectronicsBins, aguedaFloodMarks, aguedaTextileBins, aguedaWasteBins, aguedaWasteOperators],
};
