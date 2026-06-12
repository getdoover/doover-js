import type { Capability } from "./capabilities";
import { DooverApiError } from "../http/errors";

/**
 * Thrown when a `DataClient` method is called whose backing capability the
 * client does not advertise. Extends `DooverApiError` so existing
 * `instanceof DooverApiError` error handling catches it; the HTTP-ish fields
 * are placeholders since no request was made.
 */
export class UnsupportedCapabilityError extends DooverApiError {
  readonly capability: Capability;
  readonly clientId?: string;

  constructor(capability: Capability, clientId?: string) {
    super({
      status: 0,
      body: { capability, clientId },
      url: "",
      method: "",
      message:
        `Capability "${capability}" is not supported` +
        (clientId ? ` by client "${clientId}"` : "") + ".",
    });
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
    this.clientId = clientId;
    Object.setPrototypeOf(this, UnsupportedCapabilityError.prototype);
  }
}

/**
 * Thrown by `MultiplexClient` when a write cannot be routed to a single
 * member — more than one enabled member owns the targeted agent and has the
 * write capability, and the call was not `sources`-scoped to one of them.
 */
export class AmbiguousWriteError extends DooverApiError {
  readonly capability: Capability;
  readonly candidateSourceIds: string[];

  constructor(capability: Capability, candidateSourceIds: string[]) {
    super({
      status: 0,
      body: { capability, candidateSourceIds },
      url: "",
      method: "",
      message:
        `Ambiguous write for "${capability}": ${candidateSourceIds.length} ` +
        `members are eligible (${candidateSourceIds.join(", ")}). ` +
        `Scope the call with { sources: [<one-id>] }.`,
    });
    this.name = "AmbiguousWriteError";
    this.capability = capability;
    this.candidateSourceIds = candidateSourceIds;
    Object.setPrototypeOf(this, AmbiguousWriteError.prototype);
  }
}

/**
 * Thrown by offline-aware clients when a network-only operation is attempted
 * while offline, or when an offline read has no usable cached value.
 */
export class DooverOfflineError extends DooverApiError {
  readonly operation: string;
  readonly cacheKey?: string;

  constructor(operation: string, message?: string, cacheKey?: string) {
    super({
      status: 0,
      body: { operation, cacheKey },
      url: "",
      method: "",
      message: message ?? `Operation "${operation}" is unavailable while offline.`,
    });
    this.name = "DooverOfflineError";
    this.operation = operation;
    this.cacheKey = cacheKey;
    Object.setPrototypeOf(this, DooverOfflineError.prototype);
  }
}
