export function generateSnowflakeIdAtTime(time: { valueOf(): number }) {
  const offset = 1735689600000;
  const bigTime = BigInt(time.valueOf() - offset);
  const bigId = bigTime << 22n;
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
    timestamp: extracted.timestamp / 1000,
  };
}
