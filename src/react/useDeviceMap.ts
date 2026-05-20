import { useMemo } from "react";

import { useAgentChannel } from "./useAgentChannel";

/**
 * Default shape for entries in an agent's `DEVICE_MAP` — covers every field
 * an app may request via `x-extraDeviceFields` on its
 * `dv_proc_extended_permissions` schema (see doover-control's
 * `ALLOWED_DEVICE_MAP_EXTRA_FIELDS` / `COMPOUND_DEVICE_MAP_SUBFIELDS`). All
 * fields are optional because the app picks which to include — `id` is the
 * one constant (the platform always uses it as the dict key, and the hook
 * ensures it's also present on the entry value).
 *
 * Pass a narrower type as the hook's generic argument when you know exactly
 * which fields your app requested.
 */
export interface DeviceMapEntry {
  /** Snowflake id — always present (the hook fills it from the dict key). */
  id: string;
  name?: string | null;
  display_name?: string | null;
  type?: {
    id?: string | number | null;
    name?: string | null;
    /** `type.config` is the device-type's JSON config; shape depends on the type. */
    config?: Record<string, unknown> | null;
  } | null;
  group?: {
    id?: string | number | null;
    name?: string | null;
  } | null;
  organisation?: {
    id?: string | number | null;
    name?: string | null;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
  fa_icon?: string | null;
  notes?: string | null;
  /** `extra_config` is a free-form JSON dict on the device; shape depends on org/usage. */
  extra_config?: Record<string, unknown> | null;
  /** Each app installation visible to this app, when `app_installs` (or any subfield) was requested. */
  app_installs?: Array<{
    id?: string | number | null;
    name?: string | null;
    display_name?: string | null;
    application_id?: string | number | null;
    application_name?: string | null;
  }>;
  /** Each solution installation, when `solution_installs` (or any subfield) was requested. */
  solution_installs?: Array<{
    id?: string | number | null;
    display_name?: string | null;
    solution_id?: string | number | null;
    solution_display_name?: string | null;
  }>;
  /** Any other field requested via `x-extraDeviceFields` ends up here. */
  [extra: string]: unknown;
}

export interface UseDeviceMapOptions {
  /**
   * Drop the agent's own id from the returned set. Defaults true — a
   * dashboard generally doesn't want to render itself as a "device". Set
   * false to include it.
   */
  excludeSelf?: boolean;
}

export interface UseDeviceMapResult<TEntry extends DeviceMapEntry> {
  /** The device entries, in `DEVICE_MAP` insertion order, with `id` populated from each entry's dict key. */
  devices: TEntry[];
  /** Just the device ids — handy as the input to `useMultiAgentAggregates` etc. */
  deviceIds: string[];
  /** The `DEVICE_MAP` keyed by id — for O(1) per-device lookups. */
  raw: Record<string, TEntry>;
  /** True while the agent's `deployment_config` is loading for the first time. */
  isLoading: boolean;
  /** True if the underlying channel fetch errored. */
  isError: boolean;
  /**
   * True when both `agentId` and `appKey` were supplied and the loaded
   * `deployment_config` actually contains a `DEVICE_MAP` at
   * `applications[appKey].DEVICE_MAP`. False indicates the hook is either
   * still warming up or the app isn't configured to expose a DEVICE_MAP —
   * use this to distinguish "no devices granted yet" from "look at your config".
   */
  hasDeviceMap: boolean;
}

/**
 * Read an agent's `DEVICE_MAP` — the platform-populated list of devices a
 * given app instance has been granted permission to see — from the agent's
 * `deployment_config` channel. Returns the entries flattened, keyed, and with
 * `id` filled in from the dict key, plus a ready-to-use `deviceIds` array.
 *
 * Pass a narrower entry type as the generic when your app declares specific
 * `x-extraDeviceFields`, e.g.:
 *
 * ```ts
 * interface MyEntry extends DeviceMapEntry {
 *   type?: { id?: string | null; name?: string | null; config?: { battery_voltage_tag?: string | null } | null } | null;
 * }
 * const { devices, deviceIds } = useDeviceMap<MyEntry>(agentId, "my_dashboard");
 * ```
 *
 * If `appKey` is missing or `applications[appKey].DEVICE_MAP` isn't present,
 * the hook returns an empty result with `hasDeviceMap: false` — it does not
 * silently fall back to whichever other app block happens to carry a
 * DEVICE_MAP, since that masks misconfiguration.
 *
 * @param agentId    The agent's id (typically from `customer_site/useRemoteParams`).
 * @param appKey     The app's key, e.g. `"connectivity_dashboard"`. `DEVICE_MAP` lives at `deployment_config.applications[appKey].DEVICE_MAP`.
 * @param options    See `UseDeviceMapOptions`.
 */
export function useDeviceMap<
  TEntry extends DeviceMapEntry = DeviceMapEntry,
>(
  agentId: string | undefined,
  appKey: string | undefined,
  options?: UseDeviceMapOptions,
): UseDeviceMapResult<TEntry> {
  const excludeSelf = options?.excludeSelf ?? true;

  const { data: deploymentConfig, isLoading, isError } = useAgentChannel<{
    applications?: Record<string, { DEVICE_MAP?: Record<string, Partial<TEntry>> } & Record<string, unknown>>;
  }>(agentId, "deployment_config");

  return useMemo(() => {
    const empty = {
      devices: [] as TEntry[],
      deviceIds: [] as string[],
      raw: {} as Record<string, TEntry>,
      isLoading,
      isError,
      hasDeviceMap: false,
    };
    if (!appKey) return empty;
    const block = deploymentConfig?.applications?.[appKey];
    const map = block?.DEVICE_MAP;
    if (!map || typeof map !== "object") return empty;

    const raw: Record<string, TEntry> = {};
    const devices: TEntry[] = [];
    for (const [id, entry] of Object.entries(map)) {
      if (excludeSelf && id === agentId) continue;
      // dict key is the source of truth for `id` — the platform only puts it
      // on the entry value when the app explicitly requested "id" in extra_fields
      const filled = { ...(entry ?? {}), id } as TEntry;
      raw[id] = filled;
      devices.push(filled);
    }
    return { devices, deviceIds: devices.map((d) => d.id), raw, isLoading, isError, hasDeviceMap: true };
  }, [deploymentConfig, appKey, agentId, excludeSelf, isLoading, isError]);
}
