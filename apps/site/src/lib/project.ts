// Where open-data.pt's code lives, and the ways into it the site links to.

export const REPOSITORY = "https://github.com/corrreia/open-data.pt";
export const CONTRIBUTING = `${REPOSITORY}/blob/main/CONTRIBUTING.md`;

/** A new issue from one of the repository's forms (.github/ISSUE_TEMPLATE), with the fields the page already knows filled in. */
export function newIssue(template: "suggest-source" | "broken-source", fields: { title?: string; page?: string } = {}) {
  const url = new URL(`${REPOSITORY}/issues/new`);
  url.searchParams.set("template", `${template}.yml`);
  if (fields.title) url.searchParams.set("title", fields.title);
  if (fields.page) url.searchParams.set("page", fields.page);
  return url.href;
}
