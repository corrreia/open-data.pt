// Logos for the analytics page's clients, AI assistants and referrers, served from /client-icons/ (see its README).

/** Icons with a separate file for a dark background, where the plain one is black. */
const ON_DARK = new Set(["amazon", "anthropic", "apple", "deno", "github", "grok", "ollama", "openai", "x"]);
/** Black logos with no dark variant: inverted on a dark background. */
const INVERT_ON_DARK = new Set(["rust"]);

/** A client as the kernel names it (apps/kernel/src/analytics.ts), or an AI assistant as a referrer. */
const BY_NAME = new Map([
  // Browsers
  ["Chrome", "google-chrome"],
  ["Edge", "microsoft-edge"],
  ["Firefox", "firefox"],
  ["Safari", "safari"],
  ["Opera", "opera"],
  ["Samsung Internet", "samsung-internet"],
  ["Headless Chrome", "google-chrome"],
  ["Lighthouse", "google-chrome"],
  // AI agents
  ["ChatGPT-User", "chatgpt"],
  ["OAI-SearchBot", "openai"],
  ["GPTBot", "openai"],
  ["Claude-User", "claude-ai"],
  ["Claude-SearchBot", "claude-ai"],
  ["Claude Code", "claude-ai"],
  ["ClaudeBot", "anthropic"],
  ["Anthropic", "anthropic"],
  ["Perplexity-User", "perplexity"],
  ["PerplexityBot", "perplexity"],
  ["MistralAI-User", "mistral-ai"],
  ["Google-CloudVertexBot", "google-gemini"],
  ["Meta-ExternalAgent", "meta"],
  ["Meta-ExternalFetcher", "meta"],
  ["DuckAssistBot", "duckduckgo"],
  ["Amazonbot", "amazon"],
  // Crawlers, link previews and monitors
  ["Googlebot", "google"],
  ["Google-InspectionTool", "google"],
  ["Google Ads", "google"],
  ["Bingbot", "microsoft-bing"],
  ["YandexBot", "yandex"],
  ["Baiduspider", "baidu"],
  ["DuckDuckBot", "duckduckgo"],
  ["Applebot", "apple"],
  ["PetalBot", "huawei"],
  ["Facebook", "facebook"],
  ["Twitterbot", "x"],
  ["LinkedInBot", "linkedin"],
  ["WhatsApp", "whatsapp"],
  ["Telegram", "telegram"],
  ["Discord", "discord"],
  ["Slack", "slack"],
  ["Reddit", "reddit"],
  ["UptimeRobot", "uptimerobot"],
  ["Pingdom", "pingdom"],
  // Scripts
  ["Python requests", "python"],
  ["Python httpx", "python"],
  ["Python aiohttp", "python"],
  ["Python urllib", "python"],
  ["Scrapy", "python"],
  ["Node.js fetch", "nodejs"],
  ["Node.js undici", "nodejs"],
  ["node-fetch", "nodejs"],
  ["axios", "nodejs"],
  ["Deno", "deno"],
  ["Go net/http", "golang"],
  ["OkHttp", "java"],
  ["Apache HttpClient", "java"],
  ["Java", "java"],
  ["Dart", "dart"],
  ["Rust reqwest", "rust"],
  ["R", "r"],
  ["PowerShell", "powershell"],
  ["PHP Guzzle", "php"],
  ["Ruby", "ruby"],
  ["Postman", "postman"],
  // AI assistants as referrers
  ["ChatGPT", "chatgpt"],
  ["Claude", "claude-ai"],
  ["Perplexity", "perplexity"],
  ["Gemini", "google-gemini"],
  ["Copilot", "microsoft-copilot"],
  ["Grok", "grok"],
  ["DeepSeek", "deepseek"],
  ["Meta AI", "meta"],
  ["Mistral", "mistral-ai"],
  ["Kimi", "kimi-ai"],
  ["Qwen", "qwen"],
  ["DuckDuckGo AI", "duckduckgo"],
]);

/** Referrers by host: the site's own domain and its subdomains, any country's Google or Yandex. */
const BY_HOST: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "microsoft-bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yandex\.[a-z.]+$/, "yandex"],
  [/(^|\.)baidu\.com$/, "baidu"],
  [/(^|\.)github\.(com|io)$/, "github"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)(x\.com|t\.co|twitter\.com)$/, "x"],
  [/(^|\.)facebook\.com$/, "facebook"],
  [/^news\.ycombinator\.com$/, "hacker-news"],
  [/(^|\.)(t\.me|telegram\.org)$/, "telegram"],
  [/(^|\.)discord\.(com|gg)$/, "discord"],
  [/(^|\.)slack\.com$/, "slack"],
  [/(^|\.)whatsapp\.com$/, "whatsapp"],
];

/** MCP clients name themselves freely ("claude-ai", "Visual Studio Code", "cursor-vscode"); matched by a word in the name. */
const BY_MCP_CLIENT: ReadonlyArray<readonly [RegExp, string]> = [
  [/claude/i, "claude-ai"],
  [/chatgpt|openai/i, "chatgpt"],
  [/gemini/i, "google-gemini"],
  [/copilot/i, "microsoft-copilot"],
  [/vscode|visual studio code/i, "vscode"],
  [/mistral|le ?chat/i, "mistral-ai"],
  [/perplexity/i, "perplexity"],
  [/n8n/i, "n8n"],
  [/ollama/i, "ollama"],
];

/** Where to draw an icon from: its file, and whether it needs inverting on a dark background. */
export interface IconFile {
  src: string;
  invert: boolean;
}

function file(slug: string | undefined, dark: boolean): IconFile | undefined {
  if (!slug) return undefined;
  const variant = dark && ON_DARK.has(slug) ? `${slug}-on-dark` : slug;
  return { src: `/client-icons/${variant}.svg`, invert: dark && INVERT_ON_DARK.has(slug) };
}

/** A client, crawler or AI assistant by the name the analytics give it. */
export function clientIcon(name: string, dark: boolean): IconFile | undefined {
  return file(BY_NAME.get(name), dark);
}

/** A referrer: an AI assistant's name, or the linking site's host. */
export function referrerIcon(referrer: string, dark: boolean): IconFile | undefined {
  return file(BY_NAME.get(referrer) ?? BY_HOST.find(([pattern]) => pattern.test(referrer))?.[1], dark);
}

/** An MCP client by the name it gave on initialize. */
export function mcpClientIcon(client: string, dark: boolean): IconFile | undefined {
  return file(BY_MCP_CLIENT.find(([pattern]) => pattern.test(client))?.[1], dark);
}

/** Every icon file the map can name, for the test that holds each to a file in public/client-icons. */
export function iconFiles(): string[] {
  const slugs = new Set([...BY_NAME.values(), ...BY_HOST.map(([, slug]) => slug), ...BY_MCP_CLIENT.map(([, slug]) => slug)]);
  return [...slugs].flatMap((slug) => (ON_DARK.has(slug) ? [`${slug}.svg`, `${slug}-on-dark.svg`] : [`${slug}.svg`]));
}
