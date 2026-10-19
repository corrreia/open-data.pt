/**
 * Asking on the person's own GitHub Copilot. They sign in with GitHub through open-data.pt's own
 * OAuth App (web flow with PKCE; GitHub still wants the app's secret for the code, so it is a
 * Worker secret); each model call then goes to Copilot's chat completions with their token, and
 * Copilot bills their plan.
 *
 * GitHub documents this way in only for its Copilot SDK, which runs the Copilot CLI on a server; the
 * HTTP API underneath, api.githubcopilot.com, is not documented for other clients, and may change or
 * refuse us. The calls say who they are: our own OAuth App, our own User-Agent, and none of the
 * editor headers first-party clients send. The token stays in an httpOnly cookie.
 */
import { asArray, asBoolean, asNumber, asObject, asString, parseJson, type JsonObject } from "@open-data-pt/contract";
import type { AskHost } from "#/ask/ask";
import {
  FORM,
  NO_STORE,
  challengeOf,
  chatBodyOf,
  cookie,
  decodeBack,
  encodeBack,
  jsonCookie,
  messagesOf,
  problem,
  randomToken,
  readCookie,
  readJsonCookie,
  redirect,
  refuseCrossSite,
  returnPath,
} from "#/ask/http";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";
/** Where Copilot answers when the person's entitlement names no other address. */
const DEFAULT_COPILOT_API = "https://api.githubcopilot.com";
/** Copilot's per-plan addresses (api.individual…, api.business…): any other answer is not trusted as one. */
const COPILOT_API = /^https:\/\/api(\.[a-z0-9-]+)*\.githubcopilot\.com$/;

/** Reading who the person is; Copilot access comes from their plan, not from a scope. */
const SCOPE = "read:user";
/** The REST API version GitHub's copilot_internal endpoints answer for. */
const GITHUB_API_VERSION = "2025-04-01";
/** The Copilot API version whose model list this reads. */
const COPILOT_API_VERSION = "2026-08-01";
const USER_AGENT = "open-data.pt (+https://open-data.pt/start/)";

/** Room for the model to think and then answer; a reply cut short past this says so. */
const MAX_OUTPUT_TOKENS = 4096;
/** Copilot model IDs, such as gpt-4.1 or gemini-2.5-pro. */
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/;

const FLOW_COOKIE = "__Host-ask-github-flow";
const FLOW_SECONDS = 600;
/** An OAuth App's token does not expire; it lasts until the person signs out or revokes it on GitHub. */
const SESSION_COOKIE = "__Host-ask-github";
const SESSION_SECONDS = 30 * 86_400;

/** The token, and the Copilot address the person's plan is served from once it is known. */
interface Session {
  token: string;
  base: string | undefined;
}

/** A Copilot model as the agent offers it. */
export interface CopilotModel {
  id: string;
  name: string;
  note: string;
}

const redirectUri = (url: URL) => `${url.origin}/ask/github/callback`;

/* ---------- Signing in ---------- */

/** Off to GitHub's consent screen, with a fresh PKCE verifier and state kept in a short-lived cookie. */
export async function signIn(url: URL, host: AskHost): Promise<Response> {
  const back = returnPath(url.searchParams.get("return"));
  const state = randomToken();
  const verifier = randomToken();
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    client_id: host.github.clientId,
    redirect_uri: redirectUri(url),
    scope: SCOPE,
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
  }).toString();
  return redirect(authorize.toString(), [cookie(FLOW_COOKIE, `${state}.${verifier}.${encodeBack(back)}`, FLOW_SECONDS)]);
}

/** Back from GitHub: the code is exchanged for a token with the app's secret and the verifier only this browser holds. */
export async function callback(request: Request, url: URL, host: AskHost): Promise<Response> {
  const clearFlow = cookie(FLOW_COOKIE, "", 0);
  const [state, verifier, encodedBack] = (readCookie(request, FLOW_COOKIE) ?? "").split(".");
  const back = `${url.origin}${returnPath(encodedBack ? decodeBack(encodedBack) : null)}`;
  const failed = (reason: string) => redirect(`${back}#ask-signin=github-${reason}`, [clearFlow]);
  const denied = url.searchParams.get("error");
  if (denied) return failed(denied === "access_denied" ? "denied" : "failed");
  const code = url.searchParams.get("code");
  if (!state || !verifier || !code || url.searchParams.get("state") !== state) return failed("expired");

  const response = await host.fetch(TOKEN_URL, {
    method: "POST",
    headers: { ...FORM, "User-Agent": USER_AGENT },
    body: new URLSearchParams({
      client_id: host.github.clientId,
      client_secret: host.github.clientSecret,
      code,
      redirect_uri: redirectUri(url),
      code_verifier: verifier,
    }),
  });
  // GitHub answers a refused code with 200 and an `error` field, never a token.
  const answer = jsonOf(await response.text());
  const token = asString(answer?.access_token);
  if (!response.ok || !token) {
    console.warn(JSON.stringify({ event: "ask_github_token_refused", status: response.status, error: asString(answer?.error) }));
    return failed("failed");
  }
  return redirect(`${back}#ask`, [clearFlow, sessionCookie({ token, base: undefined })]);
}

/** Whether this browser holds a GitHub sign-in, from the cookie alone. */
export function signedIn(request: Request, host: AskHost): boolean {
  return enabled(host) && readSession(request) !== undefined;
}

export const enabled = (host: AskHost) => host.github.clientId !== "" && host.github.clientSecret !== "";

/**
 * The Copilot models the person's plan offers for this agent: chat models that call tools and stream
 * over chat completions. Asked once, when the agent opens; it also learns where their plan is served.
 */
export async function models(request: Request, host: AskHost): Promise<Response> {
  const saved = readSession(request);
  if (!saved) return Response.json({ signedIn: false, models: [] }, { headers: signedOutHeaders(request) });
  const entitlement = await host.fetch(`${GITHUB_API}/copilot_internal/user`, { headers: githubHeaders(saved.token) });
  if (entitlement.status === 401) return Response.json({ signedIn: false, models: [] }, { headers: { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } });
  const plan = entitlement.ok ? jsonOf(await entitlement.text()) : undefined;
  if (!entitlement.ok) await entitlement.body?.cancel();
  if (!plan || asBoolean(plan.chat_enabled) === false) {
    const free = asBoolean(plan?.can_signup_for_limited) === true;
    const detail = free
      ? "This GitHub account has no Copilot plan. Copilot Free costs nothing: turn it on in your GitHub settings, then open the agent again."
      : "This GitHub account cannot use Copilot Chat: it has no Copilot plan, or its organisation's policy turns chat off.";
    return Response.json({ signedIn: true, models: [], problem: detail }, { headers: NO_STORE });
  }
  const offered = asString(asObject(plan.endpoints)?.api);
  const base = offered && COPILOT_API.test(offered) ? offered : DEFAULT_COPILOT_API;

  const listed = await host.fetch(`${base}/models`, { headers: copilotHeaders(saved.token) });
  const text = await listed.text();
  if (!listed.ok) {
    console.warn(JSON.stringify({ event: "ask_github_models_refused", status: listed.status, detail: text.slice(0, 300) }));
    return Response.json({ signedIn: true, models: [], problem: `Copilot did not list its models (HTTP ${listed.status}). Try again later.` }, { headers: NO_STORE });
  }
  const headers = new Headers(NO_STORE);
  if (saved.base !== base) headers.append("Set-Cookie", sessionCookie({ token: saved.token, base }));
  return Response.json({ signedIn: true, plan: asString(plan.copilot_plan) ?? null, models: usableModels(jsonOf(text)) }, { headers });
}

/**
 * The models in Copilot's list that this agent can drive: chat models with tool calls and streaming
 * on /chat/completions, which the person's policy has not turned off. Those offered in Copilot's own
 * model picker come first; models newer than the list's shape are kept when they say nothing.
 */
export function usableModels(list: JsonObject | undefined): CopilotModel[] {
  const usable = (asArray(list?.data) ?? []).flatMap((entry) => {
    const model = asObject(entry);
    const id = asString(model?.id);
    const capabilities = asObject(model?.capabilities);
    const supports = asObject(capabilities?.supports);
    const endpoints = asArray(model?.supported_endpoints);
    if (!id || !MODEL_ID.test(id) || asString(capabilities?.type) !== "chat") return [];
    if (asString(asObject(model?.policy)?.state) === "disabled") return [];
    if (asBoolean(supports?.tool_calls) !== true || asBoolean(supports?.streaming) === false) return [];
    if (endpoints && !endpoints.includes("/chat/completions")) return [];
    const vendor = asString(model?.vendor);
    const context = asNumber(asObject(capabilities?.limits)?.max_context_window_tokens);
    const note = [vendor ? `From ${vendor}` : "", context ? `${Math.round(context / 1000)}K context` : "", asBoolean(model?.preview) ? "preview" : ""].filter(Boolean).join(", ");
    return [{ id, name: asString(model?.name) ?? id, note, picker: asBoolean(model?.model_picker_enabled) === true }];
  });
  // The list repeats a model under dated versions; the first of each name stands for it.
  const byName = new Map<string, CopilotModel>();
  for (const { id, name, note } of usable.toSorted((a, b) => Number(b.picker) - Number(a.picker))) if (!byName.has(name)) byName.set(name, { id, name, note });
  return [...byName.values()];
}

/** Forget the token here and ask GitHub to revoke open-data.pt's grant; the cookie goes either way. */
export async function signOut(request: Request, url: URL, host: AskHost): Promise<Response> {
  const refused = refuseCrossSite(request, url);
  if (refused) return refused;
  const saved = readSession(request);
  if (saved) {
    try {
      const revoke = await host.fetch(`${GITHUB_API}/applications/${encodeURIComponent(host.github.clientId)}/grant`, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${btoa(`${host.github.clientId}:${host.github.clientSecret}`)}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ access_token: saved.token }),
      });
      if (!revoke.ok) console.warn(JSON.stringify({ event: "ask_github_revoke_failed", status: revoke.status }));
      await revoke.body?.cancel();
    } catch (error) {
      console.warn(JSON.stringify({ event: "ask_github_revoke_failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return new Response(null, { status: 204, headers: { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } });
}

/* ---------- One model call ---------- */

/** One step of the conversation on the person's Copilot: their token, the model they picked, and the stream back. */
export async function chat(request: Request, url: URL, host: AskHost): Promise<Response> {
  const refused = refuseCrossSite(request, url);
  if (refused) return refused;
  const saved = readSession(request);
  if (!saved) return problem(401, "Not signed in", "Sign in with GitHub to ask.", signedOutHeaders(request));

  const body = await chatBodyOf(request);
  if (body instanceof Response) return body;
  const model = asString(body.model);
  if (!model || !MODEL_ID.test(model)) return problem(400, "Bad request", "model must be a Copilot model ID.", NO_STORE);
  const messages = messagesOf(body);
  if ("refused" in messages) return problem(400, "Bad request", messages.refused, NO_STORE);
  host.onChat?.(`copilot/${model}`, messages);

  const last = asString(asObject(messages.at(-1))?.role);
  const upstream = await host.fetch(`${saved.base ?? DEFAULT_COPILOT_API}/chat/completions`, {
    method: "POST",
    headers: {
      ...copilotHeaders(saved.token),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Openai-Intent": "conversation-agent",
      // A step after tool results is the agent's own, not a new question from the person.
      "X-Initiator": last === "user" ? "user" : "agent",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: asArray(body.tools) ?? [],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: MAX_OUTPUT_TOKENS,
    }),
  });
  if (upstream.ok && upstream.body) return new Response(upstream.body, { headers: { ...NO_STORE, "Content-Type": "text/event-stream; charset=utf-8" } });

  const detail = errorDetail(await upstream.text());
  console.warn(JSON.stringify({ event: "ask_github_model_refused", status: upstream.status, detail }));
  if (upstream.status === 401)
    return problem(401, "Signed out", "GitHub no longer accepts this sign-in. Sign in again.", { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) });
  if (upstream.status === 402) return problem(402, "Out of Copilot credits", `This account's Copilot allowance is used up${detail ? `: ${detail}` : "."}`, NO_STORE);
  if (upstream.status === 403)
    return problem(403, "Not allowed", `Copilot refused this account${detail ? `: ${detail}` : ". It may have no Copilot plan, or a policy that blocks this model."}`, NO_STORE);
  if (upstream.status === 429) return problem(429, "Too many requests", `Copilot is limiting this account${detail ? `: ${detail}` : "."}`, NO_STORE);
  return problem(502, "Model unavailable", `Copilot answered ${upstream.status}${detail ? `: ${detail}` : "."}`, NO_STORE);
}

/* ---------- Requests and cookies ---------- */

function githubHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", "X-GitHub-Api-Version": GITHUB_API_VERSION, "User-Agent": USER_AGENT };
}

function copilotHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": COPILOT_API_VERSION, "User-Agent": USER_AGENT };
}

function readSession(request: Request): Session | undefined {
  const saved = readJsonCookie(request, SESSION_COOKIE);
  const token = asString(saved?.t);
  if (!token) return undefined;
  const base = asString(saved?.b);
  return { token, base: base && COPILOT_API.test(base) ? base : undefined };
}

function sessionCookie(session: Session): string {
  const saved: JsonObject = { t: session.token };
  if (session.base) saved.b = session.base;
  return jsonCookie(SESSION_COOKIE, saved, SESSION_SECONDS);
}

function signedOutHeaders(request: Request): Record<string, string> {
  return readCookie(request, SESSION_COOKIE) === undefined ? NO_STORE : { ...NO_STORE, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) };
}

function jsonOf(text: string): JsonObject | undefined {
  try {
    return asObject(parseJson(text));
  } catch {
    return undefined;
  }
}

/** Copilot's reason, from `{error: {message}}`, `{message}` or a plain-text body, cut short. */
function errorDetail(text: string): string | undefined {
  const record = jsonOf(text);
  const message = asString(asObject(record?.error)?.message) ?? asString(record?.message) ?? (record ? undefined : text.trim());
  return message ? message.slice(0, 300) : undefined;
}
