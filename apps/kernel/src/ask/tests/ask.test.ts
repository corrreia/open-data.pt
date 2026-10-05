import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleAsk, type AskHost } from "#/ask/ask";
import { jsonBody } from "#/tests/support";

const ORIGIN = "https://open-data.pt";
const CLIENT_ID = "client-123";
const ACCOUNT = "cc05ea77c39684419e087c3b78b5177d";
const NOW = Date.parse("2026-10-03T12:00:00Z");

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  body: string;
}

/** Cloudflare as the routes reach it: each answer by URL, and every request remembered. */
function cloudflare(answer: (url: string, body: string) => Response, clientId = CLIENT_ID) {
  const sent: Sent[] = [];
  const host: AskHost = {
    clientId,
    now: () => NOW,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.text();
      sent.push({ url: request.url, method: request.method, authorization: request.headers.get("Authorization"), body });
      return answer(request.url, body);
    },
  };
  return { host, sent };
}

/** The cookies a response sets, by name, without their attributes. */
function cookiesOf(response: Response): Map<string, string> {
  return new Map(
    response.headers.getSetCookie().map((cookie) => {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
}

const cookieHeader = (cookies: Map<string, string>) => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");

/** A session cookie as the callback writes it. */
function sessionCookie(session: { a: string; r?: string; e: number }) {
  return `__Host-ask-session=${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

/** What the page posts to /ask/chat, with room for a field the kernel should not pass on. */
interface ChatBody {
  accountId: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools: string[];
  temperature?: number;
}

function chatRequest(cookie: string, body: ChatBody, origin = ORIGIN) {
  return new Request(`${ORIGIN}/ask/chat`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const CHAT: ChatBody = { accountId: ACCOUNT, model: "@cf/zai-org/glm-5.3-flash", messages: [{ role: "user", content: "Diesel in Lisbon?" }], tools: [] };

describe("signing in with Cloudflare", () => {
  it("sends the person to consent with a PKCE challenge, exchanges the code with the verifier only their browser holds, and brings them back to their page", async () => {
    const { host, sent } = cloudflare((url) => {
      if (url === "https://dash.cloudflare.com/oauth2/token")
        return Response.json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "bearer" });
      // A membership names its account; Memberships Read is what lets the token list them.
      if (url.startsWith("https://api.cloudflare.com/client/v4/memberships"))
        return Response.json({ success: true, result: [{ id: "membership-1", status: "accepted", account: { id: ACCOUNT, name: "Tomás" } }] });
      return new Response(null, { status: 404 });
    });

    const start = await handleAsk(new Request(`${ORIGIN}/ask/signin?return=${encodeURIComponent("/product/?slug=ipma-earthquakes")}`), host);
    expect(start.status).toBe(302);
    const consent = new URL(start.headers.get("Location") ?? "");
    expect(`${consent.origin}${consent.pathname}`).toBe("https://dash.cloudflare.com/oauth2/auth");
    expect(consent.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(consent.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/ask/callback`);
    expect(consent.searchParams.get("scope")).toBe("ai.read ai.write memberships.read offline_access");
    expect(consent.searchParams.get("code_challenge_method")).toBe("S256");
    const flow = cookiesOf(start);
    const [state, verifier = ""] = (flow.get("__Host-ask-flow") ?? "").split(".");
    expect(consent.searchParams.get("state")).toBe(state);
    expect(consent.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(start.headers.getSetCookie()[0]).toContain("HttpOnly");

    const back = await handleAsk(new Request(`${ORIGIN}/ask/callback?code=code-1&state=${state}`, { headers: { Cookie: cookieHeader(flow) } }), host);
    expect(back.status).toBe(302);
    expect(back.headers.get("Location")).toBe(`${ORIGIN}/product/?slug=ipma-earthquakes#ask`);
    const exchange = new URLSearchParams(sent[0]?.body);
    expect(Object.fromEntries(exchange)).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: `${ORIGIN}/ask/callback`,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    const signedIn = cookiesOf(back);
    expect(signedIn.get("__Host-ask-flow")).toBe("");

    // Every page asks whether the agent is on and signed in; that answer never reaches Cloudflare.
    const session = await handleAsk(new Request(`${ORIGIN}/ask/session`, { headers: { Cookie: cookieHeader(signedIn) } }), host);
    expect(await jsonBody<{ enabled: boolean; signedIn: boolean }>(session)).toMatchObject({ enabled: true, signedIn: true });
    expect(sent).toHaveLength(1);

    const accounts = await handleAsk(new Request(`${ORIGIN}/ask/accounts`, { headers: { Cookie: cookieHeader(signedIn) } }), host);
    expect(await jsonBody<{ signedIn: boolean; accounts: Array<{ id: string; name: string }> }>(accounts)).toEqual({ signedIn: true, accounts: [{ id: ACCOUNT, name: "Tomás" }] });
    expect(sent[1]?.authorization).toBe("Bearer access-1");
  });

  it.each(["https://evil.example/", "//evil.example/", "/\\evil.example/"])("never sends the person back anywhere but this site, even when told to go to %s", async (target) => {
    const { host } = cloudflare(() => Response.json({ access_token: "access-1", expires_in: 3600 }));
    const flow = cookiesOf(await handleAsk(new Request(`${ORIGIN}/ask/signin?return=${encodeURIComponent(target)}`), host));
    const [state] = (flow.get("__Host-ask-flow") ?? "").split(".");
    const back = await handleAsk(new Request(`${ORIGIN}/ask/callback?code=code-1&state=${state}`, { headers: { Cookie: cookieHeader(flow) } }), host);
    expect(back.headers.get("Location")).toBe(`${ORIGIN}/#ask`);
  });

  it("refuses a callback whose state is not the one this browser started with", async () => {
    const { host, sent } = cloudflare(() => Response.json({ access_token: "stolen" }));
    const back = await handleAsk(new Request(`${ORIGIN}/ask/callback?code=code-1&state=theirs`, { headers: { Cookie: "__Host-ask-flow=mine.verifier" } }), host);
    expect(back.headers.get("Location")).toBe(`${ORIGIN}/#ask-signin=expired`);
    expect(cookiesOf(back).has("__Host-ask-session")).toBe(false);
    expect(sent).toEqual([]);
  });

  it("says so, and starts nothing, on a deployment without an OAuth client", async () => {
    const { host } = cloudflare(() => new Response(null, { status: 500 }), "");
    expect(await jsonBody<{ enabled: boolean }>(await handleAsk(new Request(`${ORIGIN}/ask/session`), host))).toMatchObject({ enabled: false, signedIn: false });
    expect((await handleAsk(new Request(`${ORIGIN}/ask/signin`), host)).status).toBe(503);
  });
});

describe("asking a model", () => {
  const stream = 'data: {"choices":[{"delta":{"content":"2,30 €"}}]}\n\ndata: [DONE]\n\n';

  it("renews an expiring token, then streams the model's answer from the person's account without Cloudflare's own cookies", async () => {
    const { host, sent } = cloudflare((url) => {
      if (url === "https://dash.cloudflare.com/oauth2/token") return Response.json({ access_token: "access-2", expires_in: 3600 });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Set-Cookie": "__cf_bm=bot; Domain=api.cloudflare.com" } });
    });
    const told: Array<{ model: string; messages: number }> = [];
    host.onChat = (model, messages) => void told.push({ model, messages: messages.length });
    const expiring = sessionCookie({ a: "access-1", r: "refresh-1", e: NOW + 30_000 });
    const response = await handleAsk(chatRequest(expiring, { ...CHAT, temperature: 2 }), host);

    expect(response.status).toBe(200);
    // The usage count hears of the step, with the model and the conversation it asked.
    expect(told).toEqual([{ model: CHAT.model, messages: CHAT.messages.length }]);
    expect(await response.text()).toBe(stream);
    expect(Object.fromEntries(new URLSearchParams(sent[0]?.body))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: CLIENT_ID });
    expect(sent[1]).toMatchObject({ url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`, authorization: "Bearer access-2" });
    // Only the fields the page uses go on; the stream and the output cap are the kernel's.
    expect(JSON.parse(sent[1]?.body ?? "")).toEqual({ model: CHAT.model, messages: CHAT.messages, tools: [], stream: true, max_tokens: 4096 });
    const cookies = cookiesOf(response);
    expect(cookies.has("__cf_bm")).toBe(false);
    // Cloudflare kept the refresh token, so the renewed session keeps it too.
    expect(JSON.parse(Buffer.from(cookies.get("__Host-ask-session") ?? "", "base64url").toString())).toMatchObject({ a: "access-2", r: "refresh-1" });
  });

  it.each([
    { refusal: "a page on another site", request: chatRequest(sessionCookie({ a: "access-1", e: NOW + 3_600_000 }), CHAT, "https://evil.example"), status: 403 },
    {
      refusal: "a model not on the list",
      request: chatRequest(sessionCookie({ a: "access-1", e: NOW + 3_600_000 }), { ...CHAT, model: "@cf/meta/llama-3.1-8b-instruct" }),
      status: 400,
    },
    { refusal: "no sign-in", request: chatRequest("", CHAT), status: 401 },
    {
      // A body built from a string carries no Content-Length here, so the cap must hold while it is read.
      refusal: "a conversation over 1 MB that does not say its length",
      request: chatRequest(sessionCookie({ a: "access-1", e: NOW + 3_600_000 }), { ...CHAT, messages: [{ role: "user", content: "x".repeat(1024 * 1024) }] }),
      status: 413,
    },
  ])("refuses $refusal without reaching Cloudflare", async ({ request, status }) => {
    const { host, sent } = cloudflare(() => new Response(stream));
    let told = false;
    host.onChat = () => {
      told = true;
    };
    expect((await handleAsk(request, host)).status).toBe(status);
    expect(sent).toEqual([]);
    expect(told).toBe(false);
  });

  it("names a model the account's plan does not include, so the agent can move to a free one", async () => {
    const { host } = cloudflare(() => Response.json({ success: false, errors: [{ code: 5035, message: "This model requires the Workers Paid plan" }] }, { status: 403 }));
    const response = await handleAsk(chatRequest(sessionCookie({ a: "access-1", e: NOW + 3_600_000 }), CHAT), host);
    expect(response.status).toBe(403);
    expect(await jsonBody<{ type: string; detail: string }>(response)).toMatchObject({
      type: "https://open-data.pt/ask/problems/paid-model",
      detail: expect.stringContaining("Gemma 4 26B"),
    });
  });

  it("signs the person out when Cloudflare no longer accepts their token", async () => {
    const { host } = cloudflare(() => Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 401 }));
    const response = await handleAsk(chatRequest(sessionCookie({ a: "revoked", e: NOW + 3_600_000 }), CHAT), host);
    expect(response.status).toBe(401);
    expect(cookiesOf(response).get("__Host-ask-session")).toBe("");
  });
});

describe("when Cloudflare answers badly", () => {
  it("signs the person out here even when revoking the token fails", async () => {
    const { host } = cloudflare(() => {
      throw new TypeError("network connection lost");
    });
    const request = new Request(`${ORIGIN}/ask/signout`, { method: "POST", headers: { Origin: ORIGIN, Cookie: sessionCookie({ a: "access-1", e: NOW + 3_600_000 }) } });
    const response = await handleAsk(request, host);
    expect(response.status).toBe(204);
    expect(cookiesOf(response).get("__Host-ask-session")).toBe("");
  });

  it("sends the person back with a failed sign-in, not an error page, when the token answer is not JSON", async () => {
    const { host } = cloudflare(() => new Response("<html>maintenance</html>", { status: 200 }));
    const flow = cookiesOf(await handleAsk(new Request(`${ORIGIN}/ask/signin?return=%2Fstatus%2F`), host));
    const [state] = (flow.get("__Host-ask-flow") ?? "").split(".");
    const back = await handleAsk(new Request(`${ORIGIN}/ask/callback?code=code-1&state=${state}`, { headers: { Cookie: cookieHeader(flow) } }), host);
    expect(back.headers.get("Location")).toBe(`${ORIGIN}/status/#ask-signin=failed`);
  });

  it("lists no accounts, rather than failing, when the account list is not JSON", async () => {
    const { host } = cloudflare(() => new Response("<html>maintenance</html>", { status: 200 }));
    const response = await handleAsk(new Request(`${ORIGIN}/ask/accounts`, { headers: { Cookie: sessionCookie({ a: "access-1", e: NOW + 3_600_000 }) } }), host);
    expect(await jsonBody<{ signedIn: boolean; accounts: Array<{ id: string }> }>(response)).toEqual({ signedIn: true, accounts: [] });
  });
});
