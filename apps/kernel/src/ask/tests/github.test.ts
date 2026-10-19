import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleAsk, type AskHost } from "#/ask/ask";
import { usableModels } from "#/ask/github";
import { jsonBody } from "#/tests/support";

const ORIGIN = "https://open-data.pt";
const GITHUB = { clientId: "Ov23-open-data", clientSecret: "the-secret" };
const TOKEN = `gho_${"a".repeat(36)}`;
const PLAN_API = "https://api.individual.githubcopilot.com";

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** GitHub and Copilot as the routes reach them: each answer by URL, and every request remembered. */
function github(answer: (url: string, body: string) => Response, keys = GITHUB) {
  const sent: Sent[] = [];
  const host: AskHost = {
    clientId: "",
    github: keys,
    now: () => Date.parse("2026-10-19T12:00:00Z"),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.text();
      sent.push({ url: request.url, method: request.method, headers: request.headers, body });
      return answer(request.url, body);
    },
  };
  return { host, sent };
}

function cookiesOf(response: Response): Map<string, string> {
  return new Map(
    response.headers.getSetCookie().map((cookie) => {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
}

const signedIn = (base?: string) => `__Host-ask-github=${Buffer.from(JSON.stringify(base ? { t: TOKEN, b: base } : { t: TOKEN })).toString("base64url")}`;

/** What the page posts to a GitHub route. */
interface Posted {
  model?: string;
  messages?: Array<{ role: string; content: string; tool_call_id?: string }>;
  tools?: Array<{ type: string }>;
  temperature?: number;
}

function post(path: string, body: Posted, cookie = signedIn(PLAN_API)) {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** Copilot's model list, trimmed to the fields the agent reads. */
const MODELS = {
  data: [
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      vendor: "Azure OpenAI",
      model_picker_enabled: true,
      supported_endpoints: ["/chat/completions"],
      capabilities: { type: "chat", limits: { max_context_window_tokens: 128000 }, supports: { tool_calls: true, streaming: true } },
    },
    { id: "gpt-4.1-2025-04-14", name: "GPT-4.1", vendor: "Azure OpenAI", capabilities: { type: "chat", supports: { tool_calls: true, streaming: true } } },
    // Served only on /responses, which this agent does not speak.
    { id: "gpt-5.5", name: "GPT-5.5", supported_endpoints: ["/responses"], capabilities: { type: "chat", supports: { tool_calls: true, streaming: true } } },
    { id: "text-embedding-3-small", name: "Embedding", capabilities: { type: "embeddings", supports: {} } },
    { id: "o-mini", name: "No tools", capabilities: { type: "chat", supports: { tool_calls: false, streaming: true } } },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      vendor: "Google",
      preview: true,
      policy: { state: "disabled" },
      capabilities: { type: "chat", supports: { tool_calls: true } },
    },
    { id: "gemini-3-flash", name: "Gemini 3 Flash", vendor: "Google", preview: true, capabilities: { type: "chat", supports: { tool_calls: true } } },
  ],
};

describe("signing in with GitHub", () => {
  it("asks only to read who the person is, with PKCE, and exchanges the code with the app's secret and the verifier", async () => {
    const { host, sent } = github((url) =>
      url === "https://github.com/login/oauth/access_token"
        ? Response.json({ access_token: TOKEN, token_type: "bearer", scope: "read:user" })
        : new Response(null, { status: 404 }),
    );
    const start = await handleAsk(new Request(`${ORIGIN}/ask/github/signin?return=${encodeURIComponent("/catalog/?topic=energy")}`), host);
    const consent = new URL(start.headers.get("Location") ?? "");
    expect(consent.origin + consent.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(consent.searchParams.get("client_id")).toBe(GITHUB.clientId);
    expect(consent.searchParams.get("scope")).toBe("read:user");
    expect(consent.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/ask/github/callback`);
    const flow = cookiesOf(start).get("__Host-ask-github-flow") ?? "";
    const [state, verifier] = flow.split(".");
    expect(consent.searchParams.get("state")).toBe(state);
    expect(consent.searchParams.get("code_challenge")).toBe(
      createHash("sha256")
        .update(verifier ?? "")
        .digest("base64url"),
    );

    const back = await handleAsk(new Request(`${ORIGIN}/ask/github/callback?code=code-1&state=${state}`, { headers: { Cookie: `__Host-ask-github-flow=${flow}` } }), host);
    expect(back.headers.get("Location")).toBe(`${ORIGIN}/catalog/?topic=energy#ask`);
    const exchange = new URLSearchParams(sent[0]?.body);
    expect(exchange.get("client_secret")).toBe(GITHUB.clientSecret);
    expect(exchange.get("code_verifier")).toBe(verifier);
    expect(cookiesOf(back).get("__Host-ask-github-flow")).toBe("");

    const session = await handleAsk(new Request(`${ORIGIN}/ask/session`, { headers: { Cookie: `__Host-ask-github=${cookiesOf(back).get("__Host-ask-github")}` } }), host);
    expect(await jsonBody<{ providers: { github: { signedIn: boolean } } }>(session)).toMatchObject({ enabled: true, providers: { github: { enabled: true, signedIn: true } } });
  });

  it("sends the person back saying so when GitHub refuses the code, which it answers with 200 and an error", async () => {
    const { host } = github(() => Response.json({ error: "bad_verification_code" }));
    const back = await handleAsk(new Request(`${ORIGIN}/ask/github/callback?code=old&state=s`, { headers: { Cookie: "__Host-ask-github-flow=s.v" } }), host);
    expect(back.headers.get("Location")).toBe(`${ORIGIN}/#ask-signin=github-failed`);
    expect(cookiesOf(back).has("__Host-ask-github")).toBe(false);
  });

  it("is off, and says so, without the app's secret", async () => {
    const { host } = github(() => new Response(null, { status: 500 }), { clientId: GITHUB.clientId, clientSecret: "" });
    expect((await handleAsk(new Request(`${ORIGIN}/ask/github/signin`), host)).status).toBe(503);
    const session = await jsonBody<{ providers: { github: { enabled: boolean } } }>(
      await handleAsk(new Request(`${ORIGIN}/ask/session`, { headers: { Cookie: signedIn() } }), host),
    );
    expect(session.providers.github).toEqual({ enabled: false, signedIn: false });
  });

  it("revokes open-data.pt's grant on sign-out, with the app's own credentials, and drops the cookie", async () => {
    const { host, sent } = github(() => new Response(null, { status: 204 }));
    const out = await handleAsk(post("/ask/github/signout", {}), host);
    expect(out.status).toBe(204);
    expect(cookiesOf(out).get("__Host-ask-github")).toBe("");
    expect(sent[0]?.method).toBe("DELETE");
    expect(sent[0]?.url).toBe(`https://api.github.com/applications/${GITHUB.clientId}/grant`);
    expect(sent[0]?.headers.get("Authorization")).toBe(`Basic ${btoa(`${GITHUB.clientId}:${GITHUB.clientSecret}`)}`);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual({ access_token: TOKEN });
  });
});

describe("the models on the person's Copilot", () => {
  it("learns where their plan is served, lists the chat models that call tools there, and keeps the address", async () => {
    const { host, sent } = github((url) => {
      if (url === "https://api.github.com/copilot_internal/user") return Response.json({ chat_enabled: true, copilot_plan: "individual", endpoints: { api: PLAN_API } });
      if (url === `${PLAN_API}/models`) return Response.json(MODELS);
      return new Response(null, { status: 404 });
    });
    const response = await handleAsk(new Request(`${ORIGIN}/ask/github/models`, { headers: { Cookie: signedIn() } }), host);
    const body = await jsonBody<{ signedIn: boolean; plan: string; models: Array<{ id: string }> }>(response);
    expect(body.plan).toBe("individual");
    expect(body.models.map((model) => model.id)).toEqual(["gpt-4.1", "gemini-3-flash"]);
    expect(sent.every((request) => request.headers.get("Authorization") === `Bearer ${TOKEN}`)).toBe(true);
    expect(sent.every((request) => request.headers.get("User-Agent")?.startsWith("open-data.pt"))).toBe(true);
    const kept = cookiesOf(response).get("__Host-ask-github") ?? "";
    expect(JSON.parse(Buffer.from(kept, "base64url").toString())).toEqual({ t: TOKEN, b: PLAN_API });
  });

  it("never takes an address outside githubcopilot.com from the entitlement", async () => {
    const { host, sent } = github((url) =>
      url.endsWith("/copilot_internal/user") ? Response.json({ chat_enabled: true, endpoints: { api: "https://evil.example/" } }) : Response.json(MODELS),
    );
    await handleAsk(new Request(`${ORIGIN}/ask/github/models`, { headers: { Cookie: signedIn() } }), host);
    expect(sent[1]?.url).toBe("https://api.githubcopilot.com/models");
  });

  it("says what to do when the account has no Copilot", async () => {
    const { host } = github(() => Response.json({ chat_enabled: false, can_signup_for_limited: true }));
    const body = await jsonBody<{ models: unknown[]; problem: string }>(await handleAsk(new Request(`${ORIGIN}/ask/github/models`, { headers: { Cookie: signedIn() } }), host));
    expect(body.models).toEqual([]);
    expect(body.problem).toContain("Copilot Free");
  });

  it("keeps one of a model's dated versions, and puts Copilot's own picks first", () => {
    expect(usableModels(MODELS).map((model) => model.name)).toEqual(["GPT-4.1", "Gemini 3 Flash"]);
    expect(usableModels(MODELS)[0]?.note).toBe("From Azure OpenAI, 128K context");
  });
});

describe("asking Copilot", () => {
  const stream = 'data: {"choices":[{"delta":{"content":"2,30 €"}}]}\n\ndata: [DONE]\n\n';
  const ask = { model: "gpt-4.1", messages: [{ role: "user", content: "Diesel in Lisbon?" }], tools: [{ type: "function" }], temperature: 2 };

  it("passes the step to the person's plan, streaming, says whether the person or the agent asked, and nothing else", async () => {
    const { host, sent } = github(() => new Response(stream, { headers: { "Content-Type": "text/event-stream", "Set-Cookie": "_gh_sess=x" } }));
    const response = await handleAsk(post("/ask/github/chat", ask), host);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.text()).toBe(stream);
    expect(sent[0]?.url).toBe(`${PLAN_API}/chat/completions`);
    expect(sent[0]?.headers.get("X-Initiator")).toBe("user");
    expect(sent[0]?.headers.has("Copilot-Integration-Id")).toBe(false);
    expect(sent[0]?.headers.has("Editor-Version")).toBe(false);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual({
      model: "gpt-4.1",
      messages: ask.messages,
      tools: ask.tools,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
    });

    await handleAsk(post("/ask/github/chat", { ...ask, messages: [...ask.messages, { role: "tool", tool_call_id: "1", content: "{}" }] }), host);
    expect(sent[1]?.headers.get("X-Initiator")).toBe("agent");
  });

  it("names a used-up allowance, a refusal and a sign-out the way the person can act on them", async () => {
    // Copilot answers some refusals as JSON and others as plain text.
    for (const [status, body, title] of [
      [402, JSON.stringify({ error: { code: "quota_exceeded", message: "You have no AI credits left." } }), "Out of Copilot credits"],
      [403, "access denied by policy settings", "Not allowed"],
      [429, JSON.stringify({ error: { code: "user_global_rate_limited", message: "Slow down." } }), "Too many requests"],
    ] as const) {
      const { host } = github(() => new Response(body, { status }));
      const response = await handleAsk(post("/ask/github/chat", ask), host);
      expect(response.status).toBe(status);
      expect((await jsonBody<{ title: string }>(response)).title).toBe(title);
    }
    const { host } = github(() => new Response("unauthorized: token authentication failed", { status: 401 }));
    const out = await handleAsk(post("/ask/github/chat", ask), host);
    expect(out.status).toBe(401);
    expect(cookiesOf(out).get("__Host-ask-github")).toBe("");
  });

  it("refuses a step from another site, or without a sign-in, before asking Copilot", async () => {
    const { host, sent } = github(() => new Response(stream));
    const elsewhere = new Request(`${ORIGIN}/ask/github/chat`, { method: "POST", headers: { Cookie: signedIn(), Origin: "https://evil.example" }, body: JSON.stringify(ask) });
    expect((await handleAsk(elsewhere, host)).status).toBe(403);
    expect((await handleAsk(post("/ask/github/chat", ask, ""), host)).status).toBe(401);
    expect((await handleAsk(post("/ask/github/chat", { ...ask, model: "../../user" }), host)).status).toBe(400);
    expect(sent).toEqual([]);
  });
});
