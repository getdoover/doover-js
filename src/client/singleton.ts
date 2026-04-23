import type { DooverClientConfig } from "../http/rest-client";
import { DooverClient } from "./doover-client";

const GLOBAL_KEY = "__doover_js_client__" as const;

interface GlobalWithClient {
  [GLOBAL_KEY]?: DooverClient;
}

function globalBag(): GlobalWithClient {
  return globalThis as unknown as GlobalWithClient;
}

/**
 * Get the process-wide `DooverClient` instance, creating it on first call.
 *
 * Uses `globalThis.__doover_js_client__` to survive module-level duplicates
 * — if this module is loaded more than once (HMR, federation boundaries,
 * multiple bundles) each load still returns the same instance and therefore
 * the same WebSocket + REST configuration.
 *
 * The first caller's `config` wins. Subsequent calls ignore the `config`
 * arg and return the existing instance — log a warning if they differ so
 * drift is visible in dev tools.
 */
export function getDooverClient(config: DooverClientConfig): DooverClient {
  const bag = globalBag();
  const existing = bag[GLOBAL_KEY];
  if (existing) {
    if (configsDiffer(existing, config)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[doover-js] getDooverClient called with a config that differs " +
          "from the already-initialised singleton. The existing client is " +
          "being reused; the new config is ignored.",
      );
    }
    return existing;
  }
  const client = new DooverClient(config);
  bag[GLOBAL_KEY] = client;
  return client;
}

/**
 * Returns the current singleton if one has been initialised, otherwise
 * `null`. Useful for callers that want to read the client opportunistically
 * without forcing construction.
 */
export function peekDooverClient(): DooverClient | null {
  return globalBag()[GLOBAL_KEY] ?? null;
}

/**
 * Clear the singleton. Primarily for tests — not recommended in production
 * code since any active subscriptions reference the old instance.
 */
export function resetDooverClient(): void {
  delete globalBag()[GLOBAL_KEY];
}

function configsDiffer(
  existing: DooverClient,
  next: DooverClientConfig,
): boolean {
  const a = existing.rest.config;
  return (
    a.dataRestUrl !== next.dataRestUrl ||
    a.dataWssUrl !== next.dataWssUrl ||
    a.controlApiUrl !== next.controlApiUrl
  );
}
