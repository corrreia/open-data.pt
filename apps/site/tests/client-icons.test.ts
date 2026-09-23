import { describe, expect, it } from "vitest";
import { iconSvg } from "../icons";
import { brandIcon, iconIds } from "../src/lib/client-icons";

describe("client icons", () => {
  it("names only icons its sets have", () => {
    expect(iconIds().filter((id) => !iconSvg(id)?.startsWith("<svg"))).toEqual([]);
  });

  it.each([
    // Clients, as the kernel names them
    ["GPTBot", "lobe-openai.svg", true],
    ["Claude Code", "lobe-claude-color.svg", false],
    ["Headless Chrome", "logos-chrome.svg", false],
    ["Google Ads", "logos-google-icon.svg", false],
    // Referrers, as ts-referer-parser names them
    ["Hacker News", "logos-ycombinator.svg", false],
    ["Microsoft Teams", "logos-microsoft-teams.svg", false],
    ["X", "simple-icons-x.svg", true],
    // MCP clients, as they introduce themselves
    ["Anthropic/ClaudeAI", "lobe-claude-color.svg", false],
    ["Visual Studio Code", "logos-visual-studio-code.svg", false],
  ])("draws %s with %s", (name, file, mono) => {
    expect(brandIcon(name)).toEqual({ src: `/client-icons/${file}`, mono });
  });

  it("puts a product before its maker, and draws nothing for a name it does not know", () => {
    expect(brandIcon("Google Gemini")?.src).toBe("/client-icons/lobe-gemini-color.svg");
    expect(brandIcon("Microsoft Copilot")?.src).toBe("/client-icons/lobe-copilot-color.svg");
    expect(brandIcon("metabase-cve-2026-72898-detect")).toBeUndefined();
    expect(brandIcon("MyDashboard")).toBeUndefined();
  });
});
