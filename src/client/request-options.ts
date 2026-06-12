import type { OfflineReadCacheOptions } from "./offline-cache";

export const REQUEST_OPTIONS_SYMBOL: unique symbol = Symbol.for(
  "doover.requestOptions",
) as typeof REQUEST_OPTIONS_SYMBOL;

export interface DooverRequestOptions {
  /**
   * Restrict a call to these source ids on a `MultiplexClient`.
   */
  sources?: string[];
  /**
   * Offline cache behavior for this specific call. `false` opts out even when
   * a stored channel policy would otherwise match.
   */
  cache?: OfflineReadCacheOptions | false;
  [REQUEST_OPTIONS_SYMBOL]?: true;
}

export function requestOptions<T extends Omit<DooverRequestOptions, typeof REQUEST_OPTIONS_SYMBOL>>(
  options: T,
): T & { [REQUEST_OPTIONS_SYMBOL]: true } {
  return { ...options, [REQUEST_OPTIONS_SYMBOL]: true };
}

export function isDooverRequestOptions(value: unknown): value is DooverRequestOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as DooverRequestOptions;
  return (
    candidate[REQUEST_OPTIONS_SYMBOL] === true ||
    Array.isArray(candidate.sources) ||
    "cache" in candidate
  );
}

export function splitRequestOptions(args: unknown[]): {
  args: unknown[];
  request?: DooverRequestOptions;
} {
  const last = args[args.length - 1];
  if (!isDooverRequestOptions(last)) return { args };
  return { args: args.slice(0, -1), request: last };
}

export function delegateRequestOptions(request?: DooverRequestOptions): DooverRequestOptions | undefined {
  if (!request?.sources) return undefined;
  return requestOptions({ sources: request.sources });
}
