declare global {
  interface Env {
    /** Secret: API token used internally by bounded typed history handlers and the daily lake audit. */
    CATALOG_TOKEN?: string;
  }
}

export {};
