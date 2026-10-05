/**
 * What the site's agent needs from the kernel: a way to a language model that
 * the person asking pays for. They sign in with Cloudflare (OAuth 2.0, authorization
 * code with PKCE, a public client with no secret) and grant Workers AI on their
 * own account; each model call then passes through here with their token.
 *
 * It passes through only because Cloudflare's API answers no browser preflight,
 * so a page cannot call it directly. The browser runs the conversation and reads
 * the API itself; the kernel stores nothing. The tokens stay in an httpOnly
 * cookie in the person's browser, which Workers Logs records as REDACTED.
 */
import { asArray, asNumber, asObject, asString, isJsonObject, parseJson, type JsonObject, type JsonValue } from "@open-data-pt/contract";

const DASHBOARD = "https://dash.cloudflare.com";
const AUTHORIZE_URL = `${DASHBOARD}/oauth2/auth`;
const TOKEN_URL = `${DASHBOARD}/oauth2/token`;
const REVOKE_URL = `${DASHBOARD}/oauth2/revoke`;
const API = "https://api.cloudflare.com/client/v4";

/**
 * Workers AI on the person's account, the accounts they belong to (so they can
 * pick one rather than paste its ID), and a refresh token so the sign-in lasts.
 * Cloudflare's REST API docs ask for both Workers AI Read and Edit to run models;
 * without Memberships Read a token lists no accounts.
 */
const ASK_SCOPES = ["ai.read", "ai.write", "memberships.read", "offline_access"];

/**
 * The models the agent offers, in the order it lists them; the first is the default. Since July 2026
 * the strongest Workers AI models need the Workers Paid plan or prepaid AI Gateway credits, so a
 * free-plan account that asks one is moved to the first model marked free.
 */
const ASK_MODELS = [
  {
    id: "@cf/zai-org/glm-5.3-flash",
    name: "GLM 5.3 Flash",
    free: false,
    note: "The best at reading the data. Needs the Workers Paid plan or AI Gateway credits; a question takes about 700 to 1,500 neurons.",
  },
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    name: "Gemma 4 26B",
    free: true,
    note: "Works on the Workers Free plan, whose 10,000 neurons a day cover about ten questions. Less careful than GLM 5.3 Flash.",
  },
  { id: "@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6", free: false, note: "Larger and slower, at six to eight times GLM 5.3 Flash's price. Needs the Workers Paid plan." },
];

/** Workers AI's error for a model the account's plan does not include (https://developers.cloudflare.com/workers-ai/platform/errors/). */
const NEEDS_PAID_PLAN = 5035;
/** The problem type the agent reads to move to a free model. */
const PAID_MODEL_PROBLEM = "https://open-data.pt/ask/problems/paid-model";

/** Room for the model to think and then answer; a reply cut short past this says so. */
const MAX_OUTPUT_TOKENS = 4096;
/** A conversation, its tool results included, is sent whole on every turn; past this it is refused. */
const MAX_CHAT_BYTES = 1024 * 1024;
const MAX_MESSAGES = 200;
const ROLES = new Set(["system", "user", "assistant", "tool"]);
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** The PKCE verifier and state, kept while the person is on Cloudflare's consent screen. */
const FLOW_COOKIE = "__Host-ask-flow";
const FLOW_SECONDS = 600;
/** The tokens, for as long as a refresh token plausibly lasts; a refused refresh signs the person out sooner. */
const SESSION_COOKIE = "__Host-ask-session";
const SESSION_SECONDS = 30 * 86_400;
/** A token this close to expiring is refreshed before use, so a long model call does not outlive it. */
const REFRESH_MARGIN_MS = 60_000;

/** What the routes need: the OAuth client, and the network and clock, which tests replace. */
export interface AskHost {
  /** The public OAuth client's ID; empty when this deployment has none, and the page says so. */
  clientId: string;
  fetch: typeof fetch;
  now: () => number;
  /** Told of each model step the agent asks for, so the usage count can say what was asked of which model. */
  onChat?: (model: string, messages: JsonValue[]) => void;
}

/** The person's tokens, as the session cookie carries them. */
interface Session {
  accessToken: string;
  refreshToken: string | undefined;
  /** Epoch milliseconds. */
  expiresAt: number;
}

const ROUTES = new Set(["/ask/signin", "/ask/callback", "/ask/session", "/ask/accounts", "/ask/chat", "/ask/signout"]);

/** Whether the path is one of the agent's routes. */
export function isAskRoute(pathname: string): boolean {
  return ROUTES.has(pathname);
}

export async function handleAsk(request: Request, host: AskHost): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /ask/session") return session(request, host);
  if (!host.clientId) return problem(503, "Not enabled", "Asking with your own Cloudflare account is not enabled on this deployment.", NO_STORE);
  if (route === "GET /ask/signin") return signIn(url, host);
  if (route === "GET /ask/callback") return callback(request, url, host);
  if (route === "GET /ask/accounts") return accounts(request, host);
  if (route === "POST /ask/chat") return chat(request, url, host);
  if (route === "POST /ask/signout") return signOut(request, url, host);
  return problem(405, "Method not allowed", `${url.pathname} does not answer ${request.method}.`, {
    ...NO_STORE,
    Allow: url.pathname === "/ask/chat" || url.pathname === "/ask/signout" ? "POST" : "GET",
  });
}

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * An application/problem+json answer, as the API's, but with no CORS header:
 * these routes act on the person's sign-in, so no other site may read them.
 */
function problem(status: number, title: string, detail: string, headers: Record<string, string>, type = "about:blank"): Response {
  return Response.json({ type, title, status, detail }, { status, headers: { ...headers, "Content-Type": "application/problem+json" } });
}

/* ---------- Signing in ---------- */

/**
 * Off to Cloudflare's consent screen, with a fresh PKCE verifier and state kept
 * in a short-lived cookie, beside the page to come back to.
 */
async function signIn(url: URL, host: AskHost): Promise<Response> {
  const back = returnPath(url.searchParams.get("return"));
  const state = randomToken();
  const verifier = randomToken();
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: host.clientId,
    redirect_uri: redirectUri(url),
    scope: ASK_SCOPES.join(" "),
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
  }).toString();
  return redirect(authorize.toString(), [cookie(FLOW_COOKIE, `${state}.${verifier}.${toBase64Url(new TextEncoder().encode(back))}`, FLOW_SECONDS)]);
}

/**
 * The page sign-in started from, back on this site: a path, never another origin.
 * `//host` and `/\host` are other origins to a browser, so they are refused.
 */
function returnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some((character) => character.charCodeAt(0) < 0x20)) return "/";
  // The fragment is the callback's to set.
  return value.split("#")[0] ?? "/";
}

/** Back from Cloudflare: the code is exchanged for tokens with the verifier only this browser holds. */
async function callback(request: Request, url: URL, host: AskHost): Promise<Response> {
  const clearFlow = cookie(FLOW_COOKIE, "", 0);
  const [state, verifier, encodedBack] = (readCookie(request, FLOW_COOKIE) ?? "").split(".");
  // The page opens the agent on #ask, and tells why sign-in failed on #ask-signin=.
  const back = `${url.origin}${returnPath(encodedBack ? decodeBack(encodedBack) : null)}`;
  const failed = (reason: string) => redirect(`${back}#ask-signin=${reason}`, [clearFlow]);
  const denied = url.searchParams.get("error");
  if (denied) return failed(denied === "access_denied" ? "denied" : "failed");
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || url.searchParams.get("state") !== state) return failed("expired");

  const tokens = await requestTokens(host, { grant_type: "authorization_code", code, redirect_uri: redirectUri(url), client_id: host.clientId, code_verifier: verifier });
  if (!tokens) return failed("failed");
  return redirect(`${back}#ask`, [clearFlow, sessionCookie(tokens)]);
}

function decodeBack(encoded: string): string | null {
  try {
    return new TextDecoder().decode(fromBase64Url(encoded));
  } catch {
    return null;
  }
}

/**
 * Whether the agent is on here, whether this browser holds a sign-in, and the
 * models on offer. Every page asks, so it answers from the cookie alone and
 * never calls Cloudflare.
 */
async function session(request: Request, host: AskHost): Promise<Response> {
  const saved = readSession(request);
  const usable = saved !== undefined && (saved.refreshToken !== undefined || saved.expiresAt - REFRESH_MARGIN_MS > host.now());
  return Response.json({ enabled: host.clientId !== "", signedIn: host.clientId !== "" && usable, models: ASK_MODELS }, { headers: NO_STORE });
}

/**
 * The accounts the person belongs to; the agent asks once, when it opens. Their
 * memberships, which Memberships Read allows, then /accounts for a sign-in made
 * before that scope was asked for.
 */
async function accounts(request: Request, host: AskHost): Promise<Response> {
  const current = await currentSession(request, host);
  if (!current) return Response.json({ signedIn: false, accounts: [] }, { headers: signedOutHeaders(request) });
  const authorization = { Authorization: `Bearer ${current.session.accessToken}` };
  let listed: Array<{ id: string; name: string }> = [];
  for (const path of ["/memberships?status=accepted&per_page=50", "/accounts?per_page=50"]) {
    const response = await host.fetch(`${API}${path}`, { headers: authorization });
    if (response.status === 401) return Response.json({ signedIn: false, accounts: [] }, { headers: { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } });
    if (!response.ok) await response.body?.cancel();
    listed = response.ok ? accountsOf(await response.text()) : [];
    if (listed.length) break;
  }
  // A token that reaches no account listing still runs models; the agent then asks for the account ID.
  const headers = new Headers(NO_STORE);
  if (current.refreshed) headers.append("Set-Cookie", sessionCookie(current.session));
  return Response.json({ signedIn: true, accounts: listed }, { headers });
}

/** Forget the tokens here and ask Cloudflare to revoke them; the cookie goes either way. */
async function signOut(request: Request, url: URL, host: AskHost): Promise<Response> {
  const refused = refuseCrossSite(request, url);
  if (refused) return refused;
  const saved = readSession(request);
  if (saved) {
    const token = saved.refreshToken ?? saved.accessToken;
    // The cookie goes whatever Cloudflare says: a revocation that fails still signs this browser out.
    try {
      const revoke = await host.fetch(REVOKE_URL, { method: "POST", headers: FORM, body: new URLSearchParams({ token, client_id: host.clientId }) });
      if (!revoke.ok) console.warn(JSON.stringify({ event: "ask_revoke_failed", status: revoke.status }));
      await revoke.body?.cancel();
    } catch (error) {
      console.warn(JSON.stringify({ event: "ask_revoke_failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return new Response(null, { status: 204, headers: { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } });
}

/* ---------- One model call ---------- */

/**
 * One step of the conversation: the messages and tools go to the model on the
 * person's account, and its streamed answer comes back as it is written. Only
 * the fields the page uses are passed on, to a model on the list.
 */
async function chat(request: Request, url: URL, host: AskHost): Promise<Response> {
  const refused = refuseCrossSite(request, url);
  if (refused) return refused;
  const current = await currentSession(request, host);
  if (!current) return problem(401, "Not signed in", "Sign in with Cloudflare to ask.", signedOutHeaders(request));

  const text = await boundedText(request);
  if (text === undefined) return problem(413, "Conversation too long", "Start a new conversation.", NO_STORE);
  let body: JsonValue;
  try {
    body = parseJson(text);
  } catch {
    return problem(400, "Bad request", "The body is not JSON.", NO_STORE);
  }
  const call = chatCallOf(body);
  if ("refused" in call) return problem(400, "Bad request", call.refused, NO_STORE);
  host.onChat?.(call.model, call.messages);

  const upstream = await host.fetch(`${API}/accounts/${call.accountId}/ai/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${current.session.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: call.model, messages: call.messages, tools: call.tools, stream: true, max_tokens: MAX_OUTPUT_TOKENS }),
  });
  const headers = new Headers({ ...NO_STORE, "Content-Type": "text/event-stream; charset=utf-8" });
  if (current.refreshed) headers.append("Set-Cookie", sessionCookie(current.session));
  // Cloudflare's own headers, its bot cookie among them, stay behind; only the stream goes on.
  if (upstream.ok && upstream.body) return new Response(upstream.body, { headers });

  const { code, detail } = upstreamError(await upstream.text());
  console.warn(JSON.stringify({ event: "ask_model_refused", status: upstream.status, code, detail }));
  if (upstream.status === 403 && code === NEEDS_PAID_PLAN) {
    const free = ASK_MODELS.find((offered) => offered.free);
    return problem(
      403,
      "Model needs Workers Paid",
      `This account's plan does not include ${call.model}${free ? `; ${free.name} works on the Workers Free plan` : ""}.`,
      NO_STORE,
      PAID_MODEL_PROBLEM,
    );
  }
  if (upstream.status === 401)
    return problem(401, "Signed out", "Cloudflare no longer accepts this sign-in. Sign in again.", { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) });
  if (upstream.status === 403) return problem(403, "Not allowed", `This account did not allow Workers AI for open-data.pt${detail ? `: ${detail}` : "."}`, NO_STORE);
  if (upstream.status === 429) return problem(429, "Too many requests", `Workers AI is limiting this account${detail ? `: ${detail}` : "."}`, NO_STORE);
  return problem(502, "Model unavailable", `Workers AI answered ${upstream.status}${detail ? `: ${detail}` : "."}`, NO_STORE);
}

/** What one model call asks for, read from the page's request. */
interface ChatCall {
  accountId: string;
  model: string;
  messages: JsonValue[];
  tools: JsonValue[];
}

/** Why a call is refused, as the page shows it. */
interface ChatRefusal {
  refused: string;
}

/** The call, or why it is refused. */
function chatCallOf(body: JsonValue): ChatCall | ChatRefusal {
  const record = asObject(body);
  if (!record) return { refused: "The body must be an object." };
  const accountId = asString(record.accountId);
  if (!accountId || !ACCOUNT_ID.test(accountId)) return { refused: "accountId must be a Cloudflare account ID." };
  const model = asString(record.model);
  if (!model || !ASK_MODELS.some((offered) => offered.id === model)) return { refused: `model must be one of ${ASK_MODELS.map((offered) => offered.id).join(", ")}.` };
  const messages = asArray(record.messages);
  if (!messages?.length || messages.length > MAX_MESSAGES) return { refused: `messages must hold 1 to ${MAX_MESSAGES} messages.` };
  if (!messages.every((message) => isJsonObject(message) && ROLES.has(asString(message.role) ?? "")))
    return { refused: "Every message needs a role of system, user, assistant or tool." };
  const tools = asArray(record.tools) ?? [];
  return { accountId, model, messages, tools };
}

/* ---------- Tokens ---------- */

/** The saved session, refreshed first when it is about to expire; undefined when there is none or it cannot be renewed. */
async function currentSession(request: Request, host: AskHost): Promise<{ session: Session; refreshed: boolean } | undefined> {
  const saved = readSession(request);
  if (!saved) return undefined;
  if (saved.expiresAt - REFRESH_MARGIN_MS > host.now()) return { session: saved, refreshed: false };
  if (!saved.refreshToken) return undefined;
  const renewed = await requestTokens(host, { grant_type: "refresh_token", refresh_token: saved.refreshToken, client_id: host.clientId });
  if (!renewed) return undefined;
  // Cloudflare may rotate the refresh token or keep it; an answer without one keeps the old.
  return { session: { ...renewed, refreshToken: renewed.refreshToken ?? saved.refreshToken }, refreshed: true };
}

const FORM = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

/** One call to Cloudflare's token endpoint; undefined when it refuses. */
async function requestTokens(host: AskHost, form: Record<string, string>): Promise<Session | undefined> {
  const response = await host.fetch(TOKEN_URL, { method: "POST", headers: FORM, body: new URLSearchParams(form) });
  const text = await response.text();
  if (!response.ok) {
    // The error code says what went wrong; the body never carries a token on failure.
    console.warn(JSON.stringify({ event: "ask_token_refused", grant: form.grant_type, status: response.status, error: oauthError(text) }));
    return undefined;
  }
  let tokens: JsonObject | undefined;
  try {
    tokens = asObject(parseJson(text));
  } catch {
    console.warn(JSON.stringify({ event: "ask_token_refused", grant: form.grant_type, status: response.status, error: "not JSON" }));
    return undefined;
  }
  const accessToken = asString(tokens?.access_token);
  if (!accessToken) return undefined;
  const lifetime = asNumber(tokens?.expires_in) ?? 3600;
  return { accessToken, refreshToken: asString(tokens?.refresh_token), expiresAt: host.now() + lifetime * 1000 };
}

function readSession(request: Request): Session | undefined {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return undefined;
  try {
    const saved = asObject(parseJson(new TextDecoder().decode(fromBase64Url(value))));
    const accessToken = asString(saved?.a);
    const expiresAt = asNumber(saved?.e);
    if (!accessToken || expiresAt === undefined) return undefined;
    return { accessToken, refreshToken: asString(saved?.r), expiresAt };
  } catch {
    return undefined;
  }
}

function sessionCookie(session: Session): string {
  const saved: JsonObject = { a: session.accessToken, e: session.expiresAt };
  if (session.refreshToken) saved.r = session.refreshToken;
  return cookie(SESSION_COOKIE, toBase64Url(new TextEncoder().encode(JSON.stringify(saved))), SESSION_SECONDS);
}

/** A request that carried a session cookie the kernel could not use clears it. */
function signedOutHeaders(request: Request): Record<string, string> {
  return readCookie(request, SESSION_COOKIE) === undefined ? NO_STORE : { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) };
}

/* ---------- Requests and cookies ---------- */

/**
 * A POST that spends the person's account must come from this site's own page.
 * Browsers send Origin on every POST; a JSON body from elsewhere would also need
 * a preflight these routes never answer.
 */
function refuseCrossSite(request: Request, url: URL): Response | undefined {
  if (request.headers.get("Origin") === url.origin) return undefined;
  return problem(403, "Forbidden", "Only open-data.pt's own pages can ask.", NO_STORE);
}

/** Where Cloudflare sends the person back: this origin, so a local session works with a client that lists it. */
const redirectUri = (url: URL) => `${url.origin}/ask/callback`;

function cookie(name: string, value: string, maxAge: number): string {
  // __Host- cookies must be Secure with Path=/; browsers count http://localhost as secure for local runs.
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ ...NO_STORE, Location: location });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}

/**
 * The accounts in a /memberships or /accounts answer, by ID and name: a membership
 * names its account, an account is itself. None when the answer is not the JSON
 * Cloudflare documents.
 */
function accountsOf(text: string): Array<{ id: string; name: string }> {
  let body: JsonValue;
  try {
    body = parseJson(text);
  } catch {
    return [];
  }
  return (asArray(asObject(body)?.result) ?? []).flatMap((entry) => {
    const account = asObject(asObject(entry)?.account) ?? asObject(entry);
    const id = asString(account?.id);
    return id ? [{ id, name: asString(account?.name) ?? id }] : [];
  });
}

/** The first error of a Cloudflare API answer. */
interface UpstreamError {
  code: number | undefined;
  /** Its message, cut short. */
  detail: string | undefined;
}

function upstreamError(text: string): UpstreamError {
  try {
    const first = asObject(asArray(asObject(parseJson(text))?.errors)?.[0]);
    return { code: asNumber(first?.code), detail: asString(first?.message)?.slice(0, 300) };
  } catch {
    return { code: undefined, detail: text.slice(0, 300) || undefined };
  }
}

/**
 * A request body as text, refused past MAX_CHAT_BYTES as it streams in: the
 * Content-Length a client sends is not trusted, so a large body is never held whole.
 */
async function boundedText(request: Request): Promise<string | undefined> {
  if (Number(request.headers.get("Content-Length")) > MAX_CHAT_BYTES) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_CHAT_BYTES) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function oauthError(text: string): string | undefined {
  try {
    return asString(asObject(parseJson(text))?.error);
  } catch {
    return undefined;
  }
}

/* ---------- PKCE ---------- */

function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** RFC 7636's S256 challenge: the verifier's SHA-256, base64url without padding. */
async function challengeOf(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
