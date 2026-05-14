// Types for the `doover_connection` channel — the platform-maintained
// per-device aggregate that summarises each device agent's transport status,
// keepalive timing, and connection config. Populated server-side from the
// device agent's pings (see channels-rest `connection_sync.rs`) and mirrored
// in pydoover's `ConnectionStatus` / `ConnectionDetermination` /
// `ConnectionType` / `ConnectionDisplay` / `ConnectionConfig`.

/** Platform's binary "is this device currently online?" verdict. */
export type ConnectionDetermination = "Online" | "Offline";

/**
 * Transport mode the device negotiates.
 *  - `Continuous` keeps a long-lived websocket.
 *  - `Periodic` checks in on a schedule and disconnects between.
 *  - `PeriodicContinuous` holds a websocket while awake but lets it drop
 *    during scheduled sleep windows.
 */
export type ConnectionType = "Continuous" | "Periodic" | "PeriodicContinuous";

/**
 * Fine-grained transport status code. `…Online…` and `…Pending…` mean the
 * device is up; `…Offline` means down; `…Unknown` / `PeriodicUnknown` means
 * the platform hasn't determined either way yet (e.g. a Periodic device
 * outside its expected check-in window).
 */
export type ConnectionStatusCode =
  | "ContinuousOnline"
  | "ContinuousOnlineNoPing"
  | "ContinuousOffline"
  | "ContinuousPending"
  | "PeriodicUnknown"
  | "Unknown";

/**
 * Per-app preference for how this device's connection state should surface in
 * user-facing UIs. The platform stores it but doesn't act on it itself — apps
 * render accordingly.
 */
export type ConnectionDisplay = "Always" | "OnlineOnly" | "OfflineOnly" | "Never";

/**
 * The connection config block on a `doover_connection` aggregate. Mirrors
 * pydoover's `ConnectionConfig`. All durations are in seconds (the project's
 * convention only switches to ms for absolute timestamps); `next_wake_time`
 * is an absolute timestamp and is therefore epoch ms.
 */
export interface ConnectionConfig {
  connection_type?: ConnectionType | null;
  /** Expected interval between pings, in seconds (set by the device agent). */
  expected_interval?: number | null;
  /**
   * Seconds of silence after which the platform marks the device offline.
   * When unset the platform applies its defaults (120 s for `Continuous`,
   * `expected_interval × 2` otherwise, 1 h fallback) — the resolved value
   * may also be populated server-side.
   */
  offline_after?: number | null;
  /** For `PeriodicContinuous` devices: how long the device sleeps between connections, in seconds. */
  sleep_time?: number | null;
  /** Epoch ms of the device's next scheduled wake (Periodic / PeriodicContinuous). */
  next_wake_time?: number | null;
  display?: ConnectionDisplay | null;
}

/**
 * The status block on a `doover_connection` aggregate — the device's most
 * recent transport observation. Timestamps are epoch ms.
 */
export interface ConnectionStatusBlock {
  status?: ConnectionStatusCode | null;
  last_online?: number | null;
  last_ping?: number | null;
  user_agent?: string | null;
  ip?: string | null;
  /** Round-trip latency to the platform in ms (`Continuous` transports). */
  latency_ms?: number | null;
}

/**
 * Data shape of a device's `doover_connection` aggregate. Use as the generic
 * to `useAgentChannel` for a typed read:
 *
 * ```ts
 * const { data } = useAgentChannel<ConnectionAggregate>(agentId, "doover_connection");
 * ```
 */
export interface ConnectionAggregate {
  status?: ConnectionStatusBlock | null;
  determination?: ConnectionDetermination | null;
  config?: ConnectionConfig | null;
}
