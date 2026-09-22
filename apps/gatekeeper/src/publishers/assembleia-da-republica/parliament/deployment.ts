import { r2Staging, type LibraryDeployment } from "#/index";
import { parliamentCollector, type ParliamentCollectorOptions } from "./collector";
import { PARLIAMENT_FEEDS } from "./parliament";

interface ParliamentEnv {
  /** Absent outside a Worker (live tests), where every collection parses. */
  readonly PARLIAMENT_STAGING?: R2Bucket;
}

export const PARLIAMENT_DEPLOYMENT: LibraryDeployment<ParliamentEnv> = {
  source: "parliament",
  name: "Assembleia da República",
  vars: {},
  // Parliament's download server sends no validators: each document is staged here and its R2 MD5
  // compared with the last collection's, so an unchanged file is never parsed. One object per file,
  // overwritten on every collection; a lifecycle rule may expire them, the next collection stages again.
  r2Buckets: [{ binding: "PARLIAMENT_STAGING", bucketName: "open-data-pt-gatekeeper-staging" }],
  // Initiatives is a 93 MB JSON document: about 5 s of CPU to tokenise, plus normalisation.
  cpuMs: 120_000,
  library: (env) => ({
    kinds: Object.values(PARLIAMENT_FEEDS),
    collector: (config) => {
      const options: ParliamentCollectorOptions = { config, fetcher: (input, init) => fetch(input, init) };
      if (env.PARLIAMENT_STAGING) options.staging = r2Staging(env.PARLIAMENT_STAGING);
      return parliamentCollector(options);
    },
  }),
};
