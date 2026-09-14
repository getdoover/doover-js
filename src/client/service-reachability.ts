import type { NetworkStatusSource } from "./network-status.js";

/** Reachability of the data API, independent of browser and gateway status. */
export type ServiceReachability = "unknown" | "reachable" | "unreachable";

export interface ServiceReachabilitySource {
  getSnapshot(): ServiceReachability;
  subscribe(listener: () => void): () => void;
}

export interface ReachabilityOptions {
  /** A CORS-enabled, read-only URL on the data service. Defaults to dataRestUrl.
   * Any HTTP response proves reachability, including authentication/server errors.
   * HEAD requests omit credentials and bypass the browser cache. */
  probeUrl?: string;
}

/** One polling loop per observed client. No requests or timers until subscribed. */
export class ServiceReachabilityMonitor implements ServiceReachabilitySource {
  private status: ServiceReachability = "unknown";
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private unsubscribeNetwork: (() => void) | undefined;
  private lastCheck = -Infinity;

  constructor(
    private readonly url: string,
    private readonly network: NetworkStatusSource,
    private readonly fetchImpl: typeof fetch,
  ) {}

  getSnapshot(): ServiceReachability { return this.status; }

  subscribe(listener: () => void): () => void {
    const notify = () => listener();
    this.listeners.add(notify);
    if (this.listeners.size === 1) {
      this.unsubscribeNetwork = this.network.subscribe(() => this.networkChanged());
      this.networkChanged();
    }
    return () => {
      this.listeners.delete(notify);
      if (!this.listeners.size) {
        this.unsubscribeNetwork?.();
        this.unsubscribeNetwork = undefined;
        this.cancel();
      }
    };
  }

  /** Transport failures trigger a probe; they never retry the failed request.
   * Coalesce failures and cap probes at one per second during request bursts. */
  requestFailed(): void {
    if (!this.listeners.size || this.controller || !this.network.getSnapshot().online) return;
    this.schedule(Math.max(0, 1000 - (Date.now() - this.lastCheck)));
  }

  private setStatus(status: ServiceReachability): void {
    if (status === this.status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const previous = this.controller;
    this.controller = undefined;
    previous?.abort();
  }

  private networkChanged(): void {
    if (!this.network.getSnapshot().online) {
      this.cancel();
      this.setStatus("unreachable");
    } else if (!this.controller) {
      void this.check();
    }
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.check(); }, delay);
  }

  private async check(): Promise<void> {
    if (!this.listeners.size || this.controller || !this.network.getSnapshot().online) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const controller = new AbortController();
    this.controller = controller;
    this.lastCheck = Date.now();
    // The explicit race also bounds native/custom fetch implementations that
    // ignore AbortSignal. Late responses cannot overwrite a newer observation.
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error("Reachability check cancelled or timed out"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => this.fetchImpl(this.url, {
          method: "HEAD", cache: "no-store", credentials: "omit",
          signal: controller.signal,
        })),
        aborted,
      ]);
      if (this.controller === controller) {
        this.setStatus(response.status > 0 ? "reachable" : "unreachable");
      }
    } catch {
      if (this.controller === controller) this.setStatus("unreachable");
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", rejectAbort);
      if (this.controller === controller) {
        this.controller = undefined;
        if (this.listeners.size) this.schedule(this.status === "reachable" ? 30_000 : 5000);
      }
    }
  }
}
