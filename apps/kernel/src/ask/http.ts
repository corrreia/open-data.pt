/**
 * What every way of asking shares: the agent's answers and redirects, its cookies, the checks on
 * what a page posts, and PKCE.
 */
import { asArray, asObject, asString, isJsonObject, parseJson, type JsonObject, type JsonValue } from "@open-data-pt/contract";

export const NO_STORE = { "Cache-Control": "no-store" };
export const FORM = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

/** A conversation, its tool results included, is sent whole on every turn; past this it is refused. */
const MAX_CHAT_BYTES = 1024 * 1024;
const MAX_MESSAGES = 200;
const ROLES = new Set(["system", "user", "assistant", "tool"]);

/**
 * An application/problem+json answer, as the API's, but with no CORS header:
 * these routes act on the person's sign-in, so no other site may read them.
 */
export function problem(status: number, title: string, detail: string, headers: Record<string, string>, type = "about:blank"): Response {
  return Response.json({ type, title, status, detail }, { status, headers: { ...headers, "Content-Type": "application/problem+json" } });
}

export function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ ...NO_STORE, Location: location });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}

/**
 * The page sign-in started from, back on this site: a path, never another origin.
 * `//host` and `/\host` are other origins to a browser, so they are refused.
 */
export function returnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some((character) => character.charCodeAt(0) < 0x20)) return "/";
  // The fragment is the callback's to set.
  return value.split("#")[0] ?? "/";
}

/** The return path as a sign-in flow keeps it in its cookie. */
export const encodeBack = (back: string) => toBase64Url(new TextEncoder().encode(back));

export function decodeBack(encoded: string): string | null {
  try {
    return new TextDecoder().decode(fromBase64Url(encoded));
  } catch {
    return null;
  }
}

/**
 * A POST that spends the person's account must come from this site's own page.
 * Browsers send Origin on every POST; a JSON body from elsewhere would also need
 * a preflight these routes never answer.
 */
export function refuseCrossSite(request: Request, url: URL): Response | undefined {
  if (request.headers.get("Origin") === url.origin) return undefined;
  return problem(403, "Forbidden", "Only open-data.pt's own pages can ask.", NO_STORE);
}

export function cookie(name: string, value: string, maxAge: number): string {
  // __Host- cookies must be Secure with Path=/; browsers count http://localhost as secure for local runs.
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

/** A cookie that carries a small JSON object, base64url-encoded; undefined when it is missing or not one. */
export function readJsonCookie(request: Request, name: string): JsonObject | undefined {
  const value = readCookie(request, name);
  if (!value) return undefined;
  try {
    return asObject(parseJson(new TextDecoder().decode(fromBase64Url(value))));
  } catch {
    return undefined;
  }
}

export const jsonCookie = (name: string, value: JsonObject, maxAge: number) => cookie(name, toBase64Url(new TextEncoder().encode(JSON.stringify(value))), maxAge);

/**
 * A request body as text, refused past MAX_CHAT_BYTES as it streams in: the
 * Content-Length a client sends is not trusted, so a large body is never held whole.
 */
export async function boundedText(request: Request): Promise<string | undefined> {
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

/** A page's chat request as an object, or the answer that refuses it. */
export async function chatBodyOf(request: Request): Promise<JsonObject | Response> {
  const text = await boundedText(request);
  if (text === undefined) return problem(413, "Conversation too long", "Start a new conversation.", NO_STORE);
  let body: JsonValue;
  try {
    body = parseJson(text);
  } catch {
    return problem(400, "Bad request", "The body is not JSON.", NO_STORE);
  }
  return asObject(body) ?? problem(400, "Bad request", "The body must be an object.", NO_STORE);
}

/** The conversation a chat request carries, or why it is refused. */
export function messagesOf(record: JsonObject): JsonValue[] | { refused: string } {
  const messages = asArray(record.messages);
  if (!messages?.length || messages.length > MAX_MESSAGES) return { refused: `messages must hold 1 to ${MAX_MESSAGES} messages.` };
  if (!messages.every((message) => isJsonObject(message) && ROLES.has(asString(message.role) ?? "")))
    return { refused: "Every message needs a role of system, user, assistant or tool." };
  return messages;
}

export function oauthError(text: string): string | undefined {
  try {
    return asString(asObject(parseJson(text))?.error);
  } catch {
    return undefined;
  }
}

/* ---------- PKCE ---------- */

export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** RFC 7636's S256 challenge: the verifier's SHA-256, base64url without padding. */
export async function challengeOf(verifier: string): Promise<string> {
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
