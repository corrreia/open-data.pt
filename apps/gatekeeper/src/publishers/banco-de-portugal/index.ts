import type { PublisherDefinition } from "#/catalog/define";
import { FEED as banknotesIssued } from "./feeds/banknotes-issued";
import { FEED as constructionBusinessFinancialHealth } from "./feeds/construction-business-financial-health";
import { FEED as consumerPriceIndex } from "./feeds/consumer-price-index";
import { FEED as ecbPolicyRates } from "./feeds/ecb-policy-rates";
import { FEED as emigrantDepositsByRegion } from "./feeds/emigrant-deposits-by-region";
import { FEED as employmentAndUnemployment } from "./feeds/employment-and-unemployment";
import { FEED as goodsTradeGrowth } from "./feeds/goods-trade-growth";
import { FEED as governmentDepositAssets } from "./feeds/government-deposit-assets";
import { FEED as householdIndebtedness } from "./feeds/household-indebtedness";
import { FEED as housingLoanReferenceRates } from "./feeds/housing-loan-reference-rates";
import { FEED as newCarLoanAmountPercentiles } from "./feeds/new-car-loan-amount-percentiles";
import { FEED as overdueHouseholdBorrowersByRegion } from "./feeds/overdue-household-borrowers-by-region";
import { FEED as paymentSystemParticipants } from "./feeds/payment-system-participants";
import { FEED as portugueseTreasuryYields } from "./feeds/portuguese-treasury-yields";

export const PUBLISHER: PublisherDefinition = {
  name: "Banco de Portugal",
  url: "https://www.bportugal.pt/",
  sources: ["bpstat.bportugal.pt"],
  logo: "png",
  feeds: [
    banknotesIssued,
    constructionBusinessFinancialHealth,
    consumerPriceIndex,
    ecbPolicyRates,
    emigrantDepositsByRegion,
    employmentAndUnemployment,
    goodsTradeGrowth,
    governmentDepositAssets,
    householdIndebtedness,
    housingLoanReferenceRates,
    newCarLoanAmountPercentiles,
    overdueHouseholdBorrowersByRegion,
    paymentSystemParticipants,
    portugueseTreasuryYields,
  ],
};
