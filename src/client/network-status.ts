/** Network availability is independent of the Doover gateway connection. */
export interface NetworkStatusSnapshot {
  readonly online: boolean;
  readonly at: number;
}

/** Snapshots must retain their identity until the status changes. */
export interface NetworkStatusSource {
  getSnapshot(): NetworkStatusSnapshot;
  subscribe(listener: () => void): () => void;
}

/** A source that native network callbacks can update. */
export function createNetworkStatusStore(initialOnline: boolean) {
  let snapshot: NetworkStatusSnapshot = { online: initialOnline, at: Date.now() };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setOnline(online: boolean) {
      if (online === snapshot.online) return;
      snapshot = { online, at: Date.now() };
      listeners.forEach((listener) => listener());
    },
  };
}

function readBrowserOnline(): boolean {
  const nav = typeof window !== "undefined" ? window.navigator
    : typeof navigator !== "undefined" ? navigator : undefined;
  return typeof nav?.onLine === "boolean" ? nav.onLine : true;
}

// Listen only while observed. getSnapshot also refreshes after periods with
// no subscribers, including initial offline loads. No browser globals at import.
function createBrowserNetworkStatus(): NetworkStatusSource {
  let snapshot: NetworkStatusSnapshot = { online: true, at: 0 };
  const listeners = new Set<() => void>();
  let detach: (() => void) | undefined;
  const getSnapshot = () => {
    const online = readBrowserOnline();
    if (online !== snapshot.online) snapshot = { online, at: Date.now() };
    return snapshot;
  };
  const refresh = () => {
    getSnapshot();
    // A request may already have read the new snapshot before this event.
    // Still notify mounted consumers; React ignores an unchanged snapshot.
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (!detach && typeof window !== "undefined") {
        const target = window;
        target.addEventListener("online", refresh);
        target.addEventListener("offline", refresh);
        detach = () => {
          target.removeEventListener("online", refresh);
          target.removeEventListener("offline", refresh);
        };
      }
      refresh();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { detach?.(); detach = undefined; }
      };
    },
  };
}

export const browserNetworkStatus: NetworkStatusSource = createBrowserNetworkStatus();
