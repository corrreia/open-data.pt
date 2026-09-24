import type { PublisherDefinition } from "#/catalog/define";
import { FEED as activeSmartMeterContracts } from "./feeds/active-smart-meter-contracts";
import { FEED as consumptionForecast } from "./feeds/consumption-forecast";
import { FEED as contractsByPowerBand } from "./feeds/contracts-by-power-band";
import { FEED as distributionInjection } from "./feeds/distribution-injection";
import { FEED as districts } from "./feeds/districts";
import { FEED as energyCommunities } from "./feeds/energy-communities";
import { FEED as evChargingConnections } from "./feeds/ev-charging-connections";
import { FEED as evGridConnectionRequests } from "./feeds/ev-grid-connection-requests";
import { FEED as gridReceptionCapacity } from "./feeds/grid-reception-capacity";
import { FEED as hourlyConsumptionLisbonPortoPostcodes } from "./feeds/hourly-consumption-lisbon-porto-postcodes";
import { FEED as monthlyPostalConsumption } from "./feeds/monthly-postal-consumption";
import { FEED as municipalContractedCapacity } from "./feeds/municipal-contracted-capacity";
import { FEED as municipalMonthlyConsumption } from "./feeds/municipal-monthly-consumption";
import { FEED as municipalStreetLighting } from "./feeds/municipal-street-lighting";
import { FEED as municipalTariffConsumption } from "./feeds/municipal-tariff-consumption";
import { FEED as municipalTransformerCapacity } from "./feeds/municipal-transformer-capacity";
import { FEED as nationalConsumption } from "./feeds/national-consumption";
import { FEED as nationalProduction } from "./feeds/national-production";
import { FEED as scheduledInterruptions } from "./feeds/scheduled-interruptions";
import { FEED as selfConsumptionExportedEnergy } from "./feeds/self-consumption-exported-energy";
import { FEED as selfConsumptionInstallations } from "./feeds/self-consumption-installations";
import { FEED as serviceContinuity } from "./feeds/service-continuity";
import { FEED as substationLoad } from "./feeds/substation-load";

export const PUBLISHER: PublisherDefinition = {
  name: "E-REDES",
  url: "https://www.e-redes.pt/",
  sources: ["e-redes.opendatasoft.com"],
  logo: "svg",
  feeds: [
    activeSmartMeterContracts,
    consumptionForecast,
    contractsByPowerBand,
    distributionInjection,
    districts,
    energyCommunities,
    evChargingConnections,
    evGridConnectionRequests,
    gridReceptionCapacity,
    hourlyConsumptionLisbonPortoPostcodes,
    monthlyPostalConsumption,
    municipalContractedCapacity,
    municipalMonthlyConsumption,
    municipalStreetLighting,
    municipalTariffConsumption,
    municipalTransformerCapacity,
    nationalConsumption,
    nationalProduction,
    scheduledInterruptions,
    selfConsumptionExportedEnergy,
    selfConsumptionInstallations,
    serviceContinuity,
    substationLoad,
  ],
};
