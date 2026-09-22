import type { ExampleFeed } from "../../index";

const WEEK = 604_800;

/** The IDs, not domain titles, select the actual Portuguese observations. */
export const CATALOG_EXAMPLES: ExampleFeed[] = [
  example("bpstat-banknotes-issued", "banco-de-portugal-banknotes-issued", "9", "002abf63d5a4efb3e35ab5321251d7c5", [12468838, 12468839], 60),
  example(
    "bpstat-construction-business-financial-health",
    "banco-de-portugal-construction-business-financial-health",
    "168",
    "332441c9d65de71a0c842ac6496c1ee2",
    [12587167, 12587168, 12587169, 12587170, 12587171, 12587172, 12587173, 12587174, 12587175, 12587176, 12587177, 12587178],
    20,
    2_592_000,
  ),
  example("bpstat-ecb-policy-rates", "banco-de-portugal-ecb-policy-rates", "22", "471186a839daf97d9280419fc06c8579", [12504589, 12504590, 12504591], 366, 86_400),
  // The research URL used domain 50 (vehicle registrations and fuel sales). Domain 53 shares
  // this dimension-set hash but actually contains Portuguese international trade observations.
  example("bpstat-goods-trade-growth", "banco-de-portugal-goods-trade-growth", "53", "34e4f2e4ddae13cba3e74c926fc23f48", [12587117, 12587123], 60),
  example(
    "bpstat-household-indebtedness",
    "banco-de-portugal-household-indebtedness",
    "18",
    "56ebacd8518e60ef58c85cb8185b4818",
    [12457868, 12457869, 12457924, 12458130, 12458133],
    60,
  ),
  example(
    "bpstat-new-car-loan-amount-percentiles",
    "banco-de-portugal-new-car-loan-amount-percentiles",
    "209",
    "023d7ab3054d8a0d2db8de50c0ca394b",
    [13168888, 13168889, 13168890, 13168893, 13168894, 13168895, 13168898, 13168899, 13168900],
    36,
  ),
  example(
    "bpstat-portuguese-treasury-yields",
    "banco-de-portugal-portuguese-treasury-yields",
    "26",
    "690b7b36fd36c0dbe249c48cbbc39524",
    [12099454, 12099455, 12099456, 12099457, 12099458, 12099459],
    366,
    86_400,
  ),
  example("bpstat-government-deposit-assets", "banco-de-portugal-government-deposit-assets", "28", "10470e6b60c710218dd2a0e6a20fb040", [13168814, 13168815, 13168816], 60),
  example(
    "bpstat-emigrant-deposits-by-region",
    "banco-de-portugal-emigrant-deposits-by-region",
    "206",
    "d5bf6198a39f1e77b0d14dda97103de0",
    [12996746, 12996695, 12996702, 12996706, 12996708, 12996710, 12996715, 12996717, 12996719],
    36,
  ),
  example(
    "bpstat-overdue-household-borrowers-by-region",
    "banco-de-portugal-overdue-household-borrowers-by-region",
    "188",
    "961306c1ed49daf795a53dc5fea4a04b",
    [
      12759854, 12759855, 12759861, 12759866, 12759871, 12759872, 12759884, 12760149, 12760153, 12760173, 12760174, 12760196, 12760197, 12760199, 12760204, 12760206, 12760515,
      12760516,
    ],
    36,
  ),
];

function example(slug: string, dataset: string, domain: string, datasetId: string, seriesIds: number[], lastN: number, cadenceSeconds = WEEK): ExampleFeed {
  return {
    slug,
    dataset,
    config: { source: "bpstat", domain, dataset: datasetId, lang: "EN", seriesIds: seriesIds.join(","), lastN: String(lastN) },
    staleAfterSeconds: cadenceSeconds * 2,
    policy: {
      name: "BPstat selected series and latest observations",
      version: 1,
      collection: {
        cadenceSeconds,
        timeoutSeconds: 120,
        maxBytes: 2 * 1024 * 1024,
        maxOutputBytes: 8 * 1024 * 1024,
        maxRecordBytes: 64 * 1024,
        maxRecords: 10_000,
        historyMode: "changes",
      },
    },
  };
}
