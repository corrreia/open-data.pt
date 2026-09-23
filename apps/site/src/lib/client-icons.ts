// Logos for the analytics page's clients, referrers and MCP clients. The build writes each one this map names from its npm icon set to /client-icons/ (see apps/site/icons.ts).

/** An icon as `<set>:<name>`: Iconify's `logos` (in colour) and `simple-icons` (single-colour), or `lobe`, LobeHub's AI brands. */
export type IconId = `${"logos" | "simple-icons" | "lobe"}:${string}`;

/** Where to draw a logo from, and whether it is single-colour, drawn as a mask in the text's colour so it shows on a dark background too. */
export interface BrandIcon {
  src: string;
  mono: boolean;
}

/**
 * A logo by a word in the name the analytics give a client ("GPTBot"), a
 * referrer ("Microsoft Teams") or an MCP client ("claude-code"). First match
 * wins, so a product comes before its maker: Gemini before Google, Copilot and
 * Teams before Microsoft. Black logos come from a single-colour set.
 */
const BRANDS: ReadonlyArray<readonly [RegExp, IconId]> = [
  // AI assistants, agents and crawlers
  [/claude/i, "lobe:claude-color"],
  [/anthropic/i, "lobe:anthropic"],
  [/gpt|openai|oai-/i, "lobe:openai"],
  [/gemini|vertex/i, "lobe:gemini-color"],
  [/copilot/i, "lobe:copilot-color"],
  [/perplexity|pplx/i, "lobe:perplexity-color"],
  [/mistral|le ?chat/i, "lobe:mistral-color"],
  [/deepseek/i, "lobe:deepseek-color"],
  [/qwen/i, "lobe:qwen-color"],
  [/kimi|moonshot/i, "lobe:kimi-color"],
  [/grok/i, "lobe:grok"],
  [/cohere/i, "lobe:cohere-color"],
  [/^meta\b|meta-external/i, "lobe:meta-color"],
  [/bytespider|bytedance/i, "lobe:bytedance-color"],
  [/pangu|petalbot|huawei/i, "lobe:huawei-color"],
  [/chatglm|zhipu/i, "lobe:zhipu-color"],
  [/^yibot/i, "lobe:yi-color"],
  [/ai2bot/i, "lobe:ai2-color"],
  [/amazon|amzn/i, "lobe:aws-color"],
  [/^poe$/i, "lobe:poe-color"],
  [/phind/i, "lobe:phind"],
  [/ollama/i, "lobe:ollama"],
  [/cursor/i, "lobe:cursor"],
  [/n8n/i, "logos:n8n-icon"],
  [/vscode|visual studio code/i, "logos:visual-studio-code"],
  // Browsers
  [/^edge$/i, "logos:microsoft-edge"],
  [/^opera$/i, "logos:opera"],
  [/firefox/i, "logos:firefox"],
  [/^safari$/i, "logos:safari"],
  [/chrome|lighthouse/i, "logos:chrome"],
  // Search engines, social sites, mail and monitors
  [/teams/i, "logos:microsoft-teams"],
  [/bing/i, "lobe:bing-color"],
  [/outlook|microsoft/i, "logos:microsoft-icon"],
  [/gmail/i, "logos:google-gmail"],
  [/google/i, "logos:google-icon"],
  [/duck/i, "logos:duckduckgo"],
  [/yandex/i, "lobe:yandex"],
  [/baidu/i, "lobe:baidu-color"],
  [/apple/i, "simple-icons:apple"],
  [/brave/i, "logos:brave"],
  [/kagi/i, "lobe:kagi"],
  [/ecosia/i, "simple-icons:ecosia"],
  [/facebook/i, "logos:facebook"],
  [/^x$|twitterbot/i, "simple-icons:x"],
  [/linkedin/i, "logos:linkedin-icon"],
  [/reddit/i, "logos:reddit-icon"],
  [/hacker news/i, "logos:ycombinator"],
  [/github/i, "lobe:github"],
  [/telegram/i, "logos:telegram"],
  [/discord/i, "logos:discord-icon"],
  [/slack/i, "logos:slack-icon"],
  [/whatsapp/i, "logos:whatsapp-icon"],
  [/bluesky/i, "logos:bluesky"],
  [/mastodon/i, "logos:mastodon-icon"],
  [/pingdom/i, "logos:pingdom"],
  [/uptime-kuma/i, "simple-icons:uptimekuma"],
  // Scripts
  [/python|scrapy/i, "logos:python"],
  [/^axios$/i, "logos:axios"],
  [/node/i, "logos:nodejs-icon"],
  [/^deno$/i, "simple-icons:deno"],
  [/^bun$/i, "logos:bun"],
  [/^go\b/i, "logos:go"],
  [/^java$|okhttp|^apache/i, "logos:java"],
  [/^dart$/i, "logos:dart"],
  [/rust/i, "simple-icons:rust"],
  [/^r$/i, "logos:r-lang"],
  [/php/i, "logos:php"],
  [/^ruby$/i, "logos:ruby"],
  [/postman/i, "logos:postman-icon"],
  [/insomnia/i, "logos:insomnia"],
  [/curl/i, "simple-icons:curl"],
];

/** The logo for a client's, a referrer's or an MCP client's name, if it has one. */
export function brandIcon(name: string): BrandIcon | undefined {
  const id = BRANDS.find(([pattern]) => pattern.test(name))?.[1];
  return id ? { src: `/client-icons/${iconFile(id)}`, mono: !id.startsWith("logos:") && !id.endsWith("-color") } : undefined;
}

/** The file an icon is written to. */
export function iconFile(id: IconId): string {
  return `${id.replace(":", "-")}.svg`;
}

/** Every icon the map names, for the build that writes them and the test that holds each to its set. */
export function iconIds(): IconId[] {
  return [...new Set(BRANDS.map(([, id]) => id))];
}
