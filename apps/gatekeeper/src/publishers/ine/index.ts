import type { PublisherDefinition } from "#/catalog/define";
import { FEED as airportPassengersEmbarked } from "./feeds/airport-passengers-embarked";
import { FEED as averageMonthlyEarnings } from "./feeds/average-monthly-earnings";
import { FEED as broadbandAccessesPer100 } from "./feeds/broadband-accesses-per-100";
import { FEED as broadbandDataTraffic } from "./feeds/broadband-data-traffic";
import { FEED as consumerPriceIndex } from "./feeds/consumer-price-index";
import { FEED as crimeRate } from "./feeds/crime-rate";
import { FEED as declaredIncomePerInhabitant } from "./feeds/declared-income-per-inhabitant";
import { FEED as employmentRate } from "./feeds/employment-rate";
import { FEED as fixedBroadbandAccesses } from "./feeds/fixed-broadband-accesses";
import { FEED as fixedBroadbandAccessesPer100 } from "./feeds/fixed-broadband-accesses-per-100";
import { FEED as fixedTelephoneClients } from "./feeds/fixed-telephone-clients";
import { FEED as heavyRailPassengers } from "./feeds/heavy-rail-passengers";
import { FEED as housePriceIndex } from "./feeds/house-price-index";
import { FEED as householdBroadbandAccess } from "./feeds/household-broadband-access";
import { FEED as householdIncomeGini } from "./feeds/household-income-gini";
import { FEED as householdIncomeP90P10 } from "./feeds/household-income-p90-p10";
import { FEED as housingTransactionsValue } from "./feeds/housing-transactions-value";
import { FEED as industrialProductionIndex } from "./feeds/industrial-production-index";
import { FEED as liveBirths } from "./feeds/live-births";
import { FEED as medianBankValuation } from "./feeds/median-bank-valuation";
import { FEED as medianHomeSalePrice } from "./feeds/median-home-sale-price";
import { FEED as medianHouseholdIncomeAfterTax } from "./feeds/median-household-income-after-tax";
import { FEED as residentPopulation } from "./feeds/resident-population";
import { FEED as taxpayerIncomeDistribution } from "./feeds/taxpayer-income-distribution";
import { FEED as tourismOvernightStays } from "./feeds/tourism-overnight-stays";
import { FEED as unemploymentRate } from "./feeds/unemployment-rate";

export const PUBLISHER: PublisherDefinition = {
  name: "INE · Instituto Nacional de Estatística",
  url: "https://www.ine.pt/",
  sources: ["www.ine.pt"],
  logo: "png",
  feeds: [
    airportPassengersEmbarked,
    averageMonthlyEarnings,
    broadbandAccessesPer100,
    broadbandDataTraffic,
    consumerPriceIndex,
    crimeRate,
    declaredIncomePerInhabitant,
    employmentRate,
    fixedBroadbandAccesses,
    fixedBroadbandAccessesPer100,
    fixedTelephoneClients,
    heavyRailPassengers,
    housePriceIndex,
    householdBroadbandAccess,
    householdIncomeGini,
    householdIncomeP90P10,
    housingTransactionsValue,
    industrialProductionIndex,
    liveBirths,
    medianBankValuation,
    medianHomeSalePrice,
    medianHouseholdIncomeAfterTax,
    residentPopulation,
    taxpayerIncomeDistribution,
    tourismOvernightStays,
    unemploymentRate,
  ],
};
