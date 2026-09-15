export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

interface Problem {
  detail?: string;
}

function problemDetail(text: string): string | undefined {
  try {
    const problem: Problem = JSON.parse(text);
    return problem.detail;
  } catch {
    return undefined;
  }
}

/** One read from this site's own API. Errors carry the problem document's detail. */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new ApiError(problemDetail(text) ?? `Request failed with HTTP ${response.status}`, response.status);
  // SAFETY: every /api path answers with the JSON its OpenAPI contract declares, and each caller names that contract as T.
  return JSON.parse(text) as T;
}

export const productPath = (slug: string, suffix = "") => `/api/products/${encodeURIComponent(slug)}${suffix}`;
export const productHref = (slug: string) => `/product/?slug=${encodeURIComponent(slug)}`;
