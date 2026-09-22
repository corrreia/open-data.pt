import type { CollectionPolicyDefinition } from "../../index";

/**
 * Porto runs its Urban Platform on a FIWARE broker that answers without a key,
 * and registers the broker's own query URLs as the resources of datasets on its
 * open-data portal.
 *
 * The broker's off-street car parks are not read. Nineteen of the twenty
 * carry a capacity and nothing else, and the twentieth reports its free
 * spaces as of August 2020, so there is no occupancy here to publish; what
 * the parks are is already collected from the municipality's own portal.
 */
export const PORTO_BROKER = "broker.fiware.urbanplatform.portodigital.pt";

/**
 * Sensors report every few minutes. Reading every quarter of an hour keeps a
 * useful series without spending a poll on each reading: the points are dated
 * by the sensor's own clock, so a slower read loses resolution, never accuracy.
 */
export const SENSOR: CollectionPolicyDefinition = {
  cadenceSeconds: 900,
  timeoutSeconds: 60,
  maxBytes: 2 * 1024 * 1024,
  historyMode: "changes",
};
