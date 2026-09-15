declare global {
  interface Env {
    /** Secret: the Metro Lisboa API store application's consumer key. */
    ML_CONSUMER_KEY?: string;
    /** Secret: the same application's consumer secret. */
    ML_CONSUMER_SECRET?: string;
  }
}

export {};
