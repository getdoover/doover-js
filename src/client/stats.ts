/**
 * Opt-in instrumentation for `DooverClient`. When enabled, counts REST
 * requests and gateway messages and keeps running latency stats. Disabled
 * by default — the record methods short-circuit so production apps pay
 * nothing unless a debug UI turns it on.
 */

export interface RestStatsSnapshot {
  enabled: boolean;
  /** Total requests started since stats were enabled (or last reset). */
  totalRequests: number;
  /** Requests currently in flight. */
  pendingRequests: number;
  /** Requests that resolved successfully. */
  completedRequests: number;
  /** Requests that threw / rejected. */
  failedRequests: number;
  /** Mean latency of settled requests, ms. Null until at least one lands. */
  averageLatencyMs: number | null;
  /** Latency of the most recently settled request, ms. */
  lastLatencyMs: number | null;
}

export interface GatewayStatsSnapshot {
  enabled: boolean;
  /** Frames we've sent on the gateway socket. */
  messagesSent: number;
  /** Frames we've received on the gateway socket. */
  messagesReceived: number;
}

export interface DooverStatsSnapshot {
  rest: RestStatsSnapshot;
  gateway: GatewayStatsSnapshot;
}

export class DooverStatsCollector {
  private enabled = false;

  private rTotal = 0;
  private rPending = 0;
  private rCompleted = 0;
  private rFailed = 0;
  private rLatencySum = 0;
  private rLastLatency: number | null = null;

  private gSent = 0;
  private gReceived = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    this.rTotal = 0;
    this.rPending = 0;
    this.rCompleted = 0;
    this.rFailed = 0;
    this.rLatencySum = 0;
    this.rLastLatency = null;
    this.gSent = 0;
    this.gReceived = 0;
  }

  /**
   * Record the start of a REST request. Returns the start timestamp the
   * caller must hand back to `recordRestEnd`, or `null` if stats are off.
   */
  recordRestStart(): number | null {
    if (!this.enabled) return null;
    this.rTotal += 1;
    this.rPending += 1;
    return now();
  }

  recordRestEnd(startedAt: number | null, succeeded: boolean): void {
    if (!this.enabled || startedAt === null) return;
    this.rPending = Math.max(0, this.rPending - 1);
    if (succeeded) this.rCompleted += 1;
    else this.rFailed += 1;
    const latency = now() - startedAt;
    this.rLastLatency = latency;
    this.rLatencySum += latency;
  }

  recordGatewaySent(): void {
    if (!this.enabled) return;
    this.gSent += 1;
  }

  recordGatewayReceived(): void {
    if (!this.enabled) return;
    this.gReceived += 1;
  }

  snapshot(): DooverStatsSnapshot {
    const settled = this.rCompleted + this.rFailed;
    return {
      rest: {
        enabled: this.enabled,
        totalRequests: this.rTotal,
        pendingRequests: this.rPending,
        completedRequests: this.rCompleted,
        failedRequests: this.rFailed,
        averageLatencyMs: settled > 0 ? this.rLatencySum / settled : null,
        lastLatencyMs: this.rLastLatency,
      },
      gateway: {
        enabled: this.enabled,
        messagesSent: this.gSent,
        messagesReceived: this.gReceived,
      },
    };
  }
}

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
