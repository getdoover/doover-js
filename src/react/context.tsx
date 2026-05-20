import { createContext, useContext, type ReactNode } from "react";

import type { DataClient } from "../client/data-client";

const DooverClientContext = createContext<DataClient | null>(null);

export interface DooverProviderProps {
  client: DataClient;
  children: ReactNode;
}

/**
 * Wraps a React subtree with a `DataClient` instance so downstream hooks
 * (`useDooverClient`, `useChannelAggregate`, etc.) can read it from context.
 *
 * Pair with a `@tanstack/react-query` `<QueryClientProvider>` in the same tree —
 * the hooks call `useQueryClient()` internally and will throw without one.
 *
 * Accepts any `DataClient` implementation — `DooverClient` (single cloud source),
 * `LocalAgentClient` (single local device), or `MultiplexClient` (fan-out across
 * multiple sources).
 */
export function DooverProvider({ client, children }: DooverProviderProps) {
  return (
    <DooverClientContext.Provider value={client}>
      {children}
    </DooverClientContext.Provider>
  );
}

/**
 * Read the `DataClient` from context. Throws if called outside a
 * `<DooverProvider>`.
 */
export function useDooverClient(): DataClient {
  const client = useContext(DooverClientContext);
  if (!client) {
    throw new Error(
      "useDooverClient must be called inside a <DooverProvider>.",
    );
  }
  return client;
}
