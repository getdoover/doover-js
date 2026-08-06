/** Doover's snowflake epoch: 2025-01-01T00:00:00Z. Nothing predates it. */
const SNOWFLAKE_EPOCH_MS = 1735689600000;

/**
 * Snowflake id for a point in time, floored at the epoch.
 *
 * Ids are unsigned, so a pre-epoch time has no id to generate. Returning the
 * negative arithmetic result produced a value the API rejects outright
 * ("expected a snowflake id value"), failing the whole request; `0` is the
 * oldest addressable id, which is what a caller reaching further back wants.
 */
export function generateSnowflakeIdAtTime(time: { valueOf(): number }) {
  const offsetMs = time.valueOf() - SNOWFLAKE_EPOCH_MS;
  if (Number.isNaN(offsetMs)) {
    throw new TypeError("generateSnowflakeIdAtTime received an invalid time");
  }
  const bigId = BigInt(Math.max(0, offsetMs)) << 22n;
  return bigId.toString();
}

export function extractSnowflakeId(id: string) {
  const offset = 1735689600000n;
  return {
    timestamp: Number((BigInt(id) >> 22n) + offset),
    machineId: Number((BigInt(id) >> 12n) & 1023n),
    sequence: Number(BigInt(id) & 4095n),
  };
}

export function addTimestampToMessage<T extends { id: string }>(
  message: T,
): T & { timestamp: number } {
  const extracted = extractSnowflakeId(message.id);
  return {
    ...message,
    timestamp: extracted.timestamp,
  };
}
