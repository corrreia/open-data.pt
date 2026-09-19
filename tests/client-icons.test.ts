import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientIcon, iconFiles, mcpClientIcon, referrerIcon } from "../apps/site/src/lib/client-icons";

const DIRECTORY = new URL("../apps/site/public/client-icons/", import.meta.url);

describe("client icons", () => {
  it("names only files that exist, and every file is named", () => {
    const present = new Set(readdirSync(DIRECTORY).filter((name) => name.endsWith(".svg")));
    const named = new Set(iconFiles());
    expect([...named].filter((name) => !present.has(name))).toEqual([]);
    expect([...present].filter((name) => !named.has(name))).toEqual([]);
  });

  it("draws the dark-background file only where the plain one would disappear", () => {
    expect(clientIcon("GPTBot", false)?.src).toBe("/client-icons/openai.svg");
    expect(clientIcon("GPTBot", true)?.src).toBe("/client-icons/openai-on-dark.svg");
    expect(clientIcon("Chrome", true)).toEqual({ src: "/client-icons/google-chrome.svg", invert: false });
    expect(clientIcon("Rust reqwest", true)?.invert).toBe(true);
    expect(clientIcon("MyDashboard", false)).toBeUndefined();
  });

  it("recognizes referrers by assistant name or host, and MCP clients by a word in their name", () => {
    expect(referrerIcon("ChatGPT", false)?.src).toBe("/client-icons/chatgpt.svg");
    expect(referrerIcon("google.pt", false)?.src).toBe("/client-icons/google.svg");
    expect(referrerIcon("news.ycombinator.com", false)?.src).toBe("/client-icons/hacker-news.svg");
    expect(referrerIcon("notgoogle.example", false)).toBeUndefined();
    expect(mcpClientIcon("claude-ai", false)?.src).toBe("/client-icons/claude-ai.svg");
    expect(mcpClientIcon("Visual Studio Code", false)?.src).toBe("/client-icons/vscode.svg");
    expect(mcpClientIcon("cursor", false)).toBeUndefined();
  });
});
