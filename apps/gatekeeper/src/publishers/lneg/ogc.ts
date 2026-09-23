/** LNEG's own pygeoapi, which every LNEG feed reads. */
export const LNEG_HOST = "ogcapi.lneg.pt";

/*
 * These five are its collections that read as tables rather than as INSPIRE
 * plumbing: the harmonised 1:200,000 layers are the same geology under column
 * names the service truncates to `..._representativeli_2`, which no reader can
 * use.
 *
 * All five carry their geometry: the three point layers cost under half a
 * kilobyte a feature, and the two that do not are small enough in count to
 * make up for it. Each is read five hundred features a page, with room for the
 * pages its count needs and two more, never under four.
 *
 * Geology is not news. Monthly, under the "LNEG monthly reference layer"
 * policy, is often enough to catch an inventory being extended, and asks the
 * service for one walk every four weeks; its budgets come from having read each
 * layer, the same reading the DGT layers get.
 */
