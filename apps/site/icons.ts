import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getIconData, iconToHTML, iconToSVG, replaceIDs } from "@iconify/utils";
import type { Plugin } from "vite";
import { iconFile, iconIds, type IconId } from "./src/lib/client-icons";

const modules = resolve(import.meta.dirname, "node_modules");
/** An Iconify collection, as getIconData reads one. */
type IconifyJSON = Parameters<typeof getIconData>[0];

const sets = new Map<string, IconifyJSON>();

/** An icon's SVG from its npm set, or undefined when the set has no such icon. */
export function iconSvg(id: IconId): string | undefined {
  const [set = "", name = ""] = id.split(":");
  if (set === "lobe") {
    try {
      return readFileSync(resolve(modules, "@lobehub/icons-static-svg/icons", `${name}.svg`), "utf8");
    } catch {
      return undefined;
    }
  }
  let collection = sets.get(set);
  if (!collection) {
    // SAFETY: an @iconify-json package's icons.json is an IconifyJSON collection.
    collection = JSON.parse(readFileSync(resolve(modules, `@iconify-json/${set}/icons.json`), "utf8")) as IconifyJSON;
    sets.set(set, collection);
  }
  const data = getIconData(collection, name);
  if (!data) return undefined;
  const { attributes, body } = iconToSVG(data);
  return iconToHTML(replaceIDs(body), attributes);
}

/**
 * The analytics page's logos, `client-icons/<set>-<name>.svg`, written from
 * the icon sets installed here: each one a file the browser fetches only when
 * it is shown, from this site, never from a third party.
 */
export function brandIcons(): Plugin {
  return {
    name: "brand-icons",
    closeBundle() {
      const target = resolve(import.meta.dirname, "dist/client-icons");
      mkdirSync(target, { recursive: true });
      for (const id of iconIds()) {
        const svg = iconSvg(id);
        if (!svg) throw new Error(`No icon ${id} in its set`);
        writeFileSync(resolve(target, iconFile(id)), svg);
      }
    },
  };
}
