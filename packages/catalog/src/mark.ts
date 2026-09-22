// A publisher's mark where we have no logo file: the initials that stand in for it
// and the colour behind them. It belongs beside the vocabulary that says which
// publishers have a mark; the drawing is the site's (components/PublisherMark.tsx).

/** Words that carry no initial: connectives, and the two that open a third of Portuguese municipalities. */
const UNSPOKEN = new Set(["de", "do", "da", "dos", "das", "e", "of", "the", "for", "and", "camara", "municipal", "municipio"]);

const plain = (word: string) =>
  word
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLowerCase();

/**
 * What stands in for a mark. A name that opens with an acronym — `IPMA · Instituto
 * …`, `SNS Transparência`, `CP` — is already its own monogram; anything else gives
 * up the initials of its first two speaking words, and a single speaking word
 * gives up one letter.
 */
export function initials(name: string): string {
  const words = (name.split("·")[0] ?? name).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  const first = words[0] ?? "";
  if (first.length >= 2 && first.length <= 5 && first === first.toLocaleUpperCase() && first !== first.toLocaleLowerCase()) return first;
  const speaking = words.filter((word) => !UNSPOKEN.has(plain(word)));
  return (speaking.length > 0 ? speaking : words)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toLocaleUpperCase())
    .join("");
}

/** The eight categorical hues, picked by the key so a publisher keeps their colour across pages. */
const HUES = ["#1b7a4f", "#2f66c4", "#c46a1b", "#7a4fd1", "#1391a6", "#8f6c12", "#b3405e", "#5b8a1e"];
const FALLBACK_HUE = "#1b7a4f";

export function hueOf(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 100_000;
  return HUES[hash % HUES.length] ?? FALLBACK_HUE;
}
