import type { JsonValue } from "./types";

/** One CSV cell: text as it is, quoted when it holds a comma, a quote or a line break; arrays and objects as JSON. */
export function csvValue(value: JsonValue | undefined) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) || (value !== null && Object.prototype.toString.call(value) === "[object Object]") ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A header row and rows as CSV text. */
export const csvOf = (columns: string[], rows: JsonValue[][]) => [columns.map(csvValue).join(","), ...rows.map((row) => row.map(csvValue).join(","))].join("\n");

/** Hands the visitor a file made in the page. */
export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a title: lower case, words joined by hyphens, nothing a file system minds. */
export const fileNameOf = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "data";
