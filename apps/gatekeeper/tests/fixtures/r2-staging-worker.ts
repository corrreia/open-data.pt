import { r2Staging } from "@open-data-pt/gatekeeper";

interface StagingEnv {
  STAGING: R2Bucket;
}

/** Stages the request body the way a Gatekeeper stages a download, and answers the digest and what reads back. */
export default {
  async fetch(request: Request, env: StagingEnv): Promise<Response> {
    const length = Number(request.headers.get("content-length"));
    if (!request.body) return new Response("body required", { status: 400 });
    const staging = r2Staging(env.STAGING);
    const digest = await staging.store("parliament/test.json", request.body, length);
    const stored = await new Response(await staging.read("parliament/test.json")).arrayBuffer();
    return Response.json({
      digest,
      bytes: stored.byteLength,
      sha: [...new Uint8Array(await crypto.subtle.digest("SHA-256", stored))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    });
  },
};
