import {
  QueryClient,
  type QueryClientConfig,
} from "@tanstack/react-query";

const GLOBAL_KEY = "__doover_js_query_client__" as const;

interface GlobalWithQueryClient {
  [GLOBAL_KEY]?: QueryClient;
}

function globalBag(): GlobalWithQueryClient {
  return globalThis as unknown as GlobalWithQueryClient;
}

/**
 * Get a process-wide `QueryClient` instance, creating it on first call.
 *
 * Uses `globalThis.__doover_js_query_client__` so that every app + remote
 * in a module-federation setup ends up with the same `QueryClient` — and
 * therefore the same cache — even if they each load their own copy of the
 * react-query library. The first caller's `config` wins.
 *
 * Wrap your tree once at the app root:
 *
 * ```tsx
 * import { QueryClientProvider } from "@tanstack/react-query";
 * import { getSharedQueryClient } from "doover-js/react";
 *
 * <QueryClientProvider client={getSharedQueryClient()}>…</QueryClientProvider>
 * ```
 */
export function getSharedQueryClient(config?: QueryClientConfig): QueryClient {
  const bag = globalBag();
  const existing = bag[GLOBAL_KEY];
  if (existing) return existing;
  const client = new QueryClient(config);
  bag[GLOBAL_KEY] = client;
  return client;
}

/** Test-only: clear the shared `QueryClient`. */
export function resetSharedQueryClient(): void {
  delete globalBag()[GLOBAL_KEY];
}
