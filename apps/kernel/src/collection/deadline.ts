/** One deadline covers acquisition, consumption and durable acceptance, including stalled I/O. */
export class CollectionDeadline {
  private readonly controller = new AbortController();
  private readonly expiresAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(deadline: string) {
    this.expiresAt = Date.parse(deadline);
    const remaining = this.expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Collection deadline exceeded");
    this.timer = setTimeout(() => this.controller.abort(new Error("Collection deadline exceeded")), remaining);
  }
  async wait<T>(promise: Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    if (Date.now() >= this.expiresAt && !signal.aborted) this.controller.abort(new Error("Collection deadline exceeded"));
    if (signal.aborted) {
      // The operation may already be in flight even when its budget has elapsed.
      void promise.catch(() => undefined);
      throw signal.reason;
    }
    let abort: () => void = () => undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  /**
   * Call `release` once when the deadline passes, for example to cancel a
   * stalled read, instead of racing every read against it. Returns a function
   * that forgets the callback.
   */
  onExpiry(release: () => void): () => void {
    const signal = this.controller.signal;
    if (signal.aborted) {
      release();
      return () => undefined;
    }
    signal.addEventListener("abort", release, { once: true });
    return () => signal.removeEventListener("abort", release);
  }
  /** Throw once the deadline has passed. */
  check(): void {
    const signal = this.controller.signal;
    if (Date.now() >= this.expiresAt && !signal.aborted) this.controller.abort(new Error("Collection deadline exceeded"));
    if (signal.aborted) throw signal.reason;
  }
  close(): void {
    clearTimeout(this.timer);
  }
}
