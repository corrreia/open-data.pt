import type { ExampleFeed } from "../../index";

const WEEK = 604_800;

/** The IDs, not domain titles, select the actual Portuguese observations. */
export const CATALOG_EXAMPLES: ExampleFeed[] = [
  dataset("bpstat-banknotes-issued", "Euro banknotes put into circulation by Banco de Portugal",
    "Monthly number and euro value of banknotes put into circulation by Banco de Portugal, latest sixty observations per series. Excludes euro-area totals, coins and annual repetitions.",
    "9", "002abf63d5a4efb3e35ab5321251d7c5", [12468838, 12468839], 60),
  dataset("bpstat-construction-business-financial-health", "Construction-sector business financial health",
    "Twelve quarterly ratios for private non-financial construction companies in Portugal: capital, profitability, debt, trade credit and payment periods. Latest twenty observations per series; not every business sector in the broader dataset.",
    "168", "332441c9d65de71a0c842ac6496c1ee2", [12587167, 12587168, 12587169, 12587170, 12587171, 12587172, 12587173, 12587174, 12587175, 12587176, 12587177, 12587178], 20, 2_592_000),
  dataset("bpstat-ecb-policy-rates", "ECB policy interest rates",
    "Main refinancing, marginal lending and deposit-facility rates applying to the euro area, including Portugal. Latest 366 daily observations for each of the three policy rates; other market-rate series are excluded.",
    "22", "471186a839daf97d9280419fc06c8579", [12504589, 12504590, 12504591], 366, 86_400),
  // The research URL used domain 50 (vehicle registrations and fuel sales). Domain 53 shares
  // this dimension-set hash but actually contains Portuguese international trade observations.
  dataset("bpstat-goods-trade-growth", "Growth in Portuguese exports and imports of goods",
    "Cumulative year-on-year percentage changes in the nominal value of Portuguese goods exports and imports, latest sixty monthly observations. These are cumulative growth rates, not month-on-month changes or vehicle registrations.",
    "53", "34e4f2e4ddae13cba3e74c926fc23f48", [12587117, 12587123], 60),
  dataset("bpstat-household-indebtedness", "Household indebtedness and loan growth",
    "Portuguese household indebtedness and housing/consumer-loan amounts in millions of euros, plus source annual rates of change for housing and consumption/other-purpose loans. Latest sixty monthly observations; this particular dataset does not contain business indebtedness.",
    "18", "56ebacd8518e60ef58c85cb8185b4818", [12457868, 12457869, 12457924, 12458130, 12458133], 60),
  dataset("bpstat-new-car-loan-amount-percentiles", "New car-loan contract amount percentiles",
    "25th, 50th and 75th percentiles of new car-loan amounts, separately for new vehicles, used vehicles and all car loans in Portugal. Values are euros, not contract counts or APRs; latest thirty-six monthly observations.",
    "209", "023d7ab3054d8a0d2db8de50c0ca394b", [13168888, 13168889, 13168890, 13168893, 13168894, 13168895, 13168898, 13168899, 13168900], 36),
  dataset("bpstat-portuguese-treasury-yields", "Portuguese Treasury-bond yields",
    "Daily fixed-rate Portuguese Treasury-bond yields for residual maturities of two, three, four, five, seven and ten years. Latest 366 observations per maturity; excludes monthly repetitions and German/US yields.",
    "26", "690b7b36fd36c0dbe249c48cbbc39524", [12099454, 12099455, 12099456, 12099457, 12099458, 12099459], 366, 86_400),
  dataset("bpstat-government-deposit-assets", "Regional, local government and social-security deposits",
    "Monthly deposit assets held by regional government, local government and social-security funds in Portugal, in millions of euros. Latest sixty observations; these are deposit assets, not public-debt liabilities.",
    "28", "10470e6b60c710218dd2a0e6a20fb040", [13168814, 13168815, 13168816], 60),
  dataset("bpstat-emigrant-deposits-by-region", "Emigrant deposits by Portuguese NUTS II region",
    "Emigrant deposits domiciled in the nine Portuguese NUTS II regions, in millions of euros, latest thirty-six monthly observations. Excludes overlapping NUTS III totals, other depositors and accounts not assigned to a physical branch.",
    "206", "d5bf6198a39f1e77b0d14dda97103de0", [12996746, 12996695, 12996702, 12996706, 12996708, 12996710, 12996715, 12996717, 12996719], 36),
  dataset("bpstat-overdue-household-borrowers-by-region", "Household borrowers with overdue loans by region and purpose",
    "Percentage of household/NPISH borrowers with overdue housing or consumption/other-purpose loans in each of Portugal's nine NUTS II regions. Latest thirty-six monthly observations; these are borrower shares, not overdue loan balances or loan-value ratios.",
    "188", "961306c1ed49daf795a53dc5fea4a04b", [12759854, 12759855, 12759861, 12759866, 12759871, 12759872, 12759884, 12760149, 12760153, 12760173, 12760174, 12760196, 12760197, 12760199, 12760204, 12760206, 12760515, 12760516], 36),
];

function dataset(slug: string, title: string, description: string, domain: string, datasetId: string, seriesIds: number[], lastN: number, cadenceSeconds = WEEK): ExampleFeed {
  return {
    slug, title, description,
    config: { source: "bpstat", domain, dataset: datasetId, lang: "EN", seriesIds: seriesIds.join(","), lastN: String(lastN) },
    publisher: "Banco de Portugal", topics: ["economy"], staleAfterSeconds: cadenceSeconds * 2,
    policy: {
      name: "BPstat selected series and latest observations", version: 1,
      collection: {
        cadenceSeconds, timeoutSeconds: 120, maxBytes: 2 * 1024 * 1024,
        maxOutputBytes: 8 * 1024 * 1024, maxRecordBytes: 64 * 1024,
        maxRecords: 10_000, historyMode: "changes",
      },
      serving: { licence: "Banco de Portugal information reuse conditions", attribution: "Banco de Portugal, BPstat" },
    },
  };
}
