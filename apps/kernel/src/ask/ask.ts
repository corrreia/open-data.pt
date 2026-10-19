/**
 * What the site's agent needs from the kernel: a way to a language model that the person asking pays
 * for, on their own Cloudflare Workers AI (cloudflare.ts) or their own GitHub Copilot (github.ts).
 * The browser runs the conversation and reads the API itself; the kernel only passes each model step
 * on with the person's token, which stays in an httpOnly cookie in their browser, and stores nothing.
 */
import type { JsonValue } from "@open-data-pt/contract";
import * as cloudflare from "#/ask/cloudflare";
import * as github from "#/ask/github";
import { NO_STORE, problem } from "#/ask/http";

/** What the routes need: the OAuth clients, and the network and clock, which tests replace. */
export interface AskHost {
  /** The public Cloudflare OAuth client's ID; empty when this deployment has none, which turns Workers AI off. */
  clientId: string;
  /** open-data.pt's GitHub OAuth App; an empty ID or secret turns Copilot off. */
  github: { clientId: string; clientSecret: string };
  fetch: typeof fetch;
  now: () => number;
  /** Told of each model step the agent asks for, so the usage count can say what was asked of which model. */
  onChat?: (model: string, messages: JsonValue[]) => void;
}

type Route = (request: Request, url: URL, host: AskHost) => Promise<Response>;

const CLOUDFLARE_ROUTES = new Map<string, Route>([
  ["GET /ask/signin", (_, url, host) => cloudflare.signIn(url, host)],
  ["GET /ask/callback", cloudflare.callback],
  ["GET /ask/accounts", (request, _, host) => cloudflare.accounts(request, host)],
  ["POST /ask/chat", cloudflare.chat],
  ["POST /ask/signout", cloudflare.signOut],
]);

const GITHUB_ROUTES = new Map<string, Route>([
  ["GET /ask/github/signin", (_, url, host) => github.signIn(url, host)],
  ["GET /ask/github/callback", github.callback],
  ["GET /ask/github/models", (request, _, host) => github.models(request, host)],
  ["POST /ask/github/chat", github.chat],
  ["POST /ask/github/signout", github.signOut],
]);

const PATHS = new Set(["/ask/session", ...[...CLOUDFLARE_ROUTES.keys(), ...GITHUB_ROUTES.keys()].map((route) => route.slice(route.indexOf(" ") + 1))]);

/** Whether the path is one of the agent's routes. */
export function isAskRoute(pathname: string): boolean {
  return PATHS.has(pathname);
}

/** Whether the path is one model step of the agent, on either provider. */
export const isAskChat = (pathname: string) => pathname === "/ask/chat" || pathname === "/ask/github/chat";

export async function handleAsk(request: Request, host: AskHost): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /ask/session") return session(request, host);
  const viaCloudflare = CLOUDFLARE_ROUTES.get(route);
  if (viaCloudflare) {
    if (!host.clientId) return problem(503, "Not enabled", "Asking with your own Cloudflare account is not enabled on this deployment.", NO_STORE);
    return viaCloudflare(request, url, host);
  }
  const viaGithub = GITHUB_ROUTES.get(route);
  if (viaGithub) {
    if (!github.enabled(host)) return problem(503, "Not enabled", "Asking with your own GitHub Copilot is not enabled on this deployment.", NO_STORE);
    return viaGithub(request, url, host);
  }
  const posts = url.pathname.endsWith("/chat") || url.pathname.endsWith("/signout");
  return problem(405, "Method not allowed", `${url.pathname} does not answer ${request.method}.`, { ...NO_STORE, Allow: posts ? "POST" : "GET" });
}

/**
 * Whether the agent is on here, and for each way of asking whether it is on, whether this browser
 * holds a sign-in, and the models it offers when they are fixed. Every page asks, so it answers from
 * the cookies alone and calls neither Cloudflare nor GitHub.
 */
function session(request: Request, host: AskHost): Response {
  const providers = {
    cloudflare: { enabled: host.clientId !== "", signedIn: cloudflare.signedIn(request, host), models: cloudflare.CLOUDFLARE_MODELS },
    github: { enabled: github.enabled(host), signedIn: github.signedIn(request, host) },
  };
  return Response.json({ enabled: providers.cloudflare.enabled || providers.github.enabled, providers }, { headers: NO_STORE });
}
