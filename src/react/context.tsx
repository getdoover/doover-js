import { createContext, useContext, type ReactNode } from "react";

import { DooverClient } from "../client/doover-client";

const DooverClientContext = createContext<DooverClient | null>(null);

export interface DooverProviderProps {
  client: DooverClient;
  children: ReactNode;
}

/**
 * Wraps a React subtree with a `DooverClient` instance so downstream hooks
 * (`useDooverClient`, `useChannelAggregate`, etc.) can read it from context.
 *
 * Pair with a `@tanstack/react-query` `<QueryClientProvider>` in the same tree —
 * the hooks call `useQueryClient()` internally and will throw without one.
 */
export function DooverProvider({ client, children }: DooverProviderProps) {
  return (
    <DooverClientContext.Provider value={client}>
      {children}
    </DooverClientContext.Provider>
  );
}

/**
 * Read the `DooverClient` from context. Throws if called outside a
 * `<DooverProvider>`.
 */
export function useDooverClient(): DooverClient {
  const client = useContext(DooverClientContext);
  if (!client) {
    throw new Error(
      "useDooverClient must be called inside a <DooverProvider>.",
    );
  }
  return client;
}
