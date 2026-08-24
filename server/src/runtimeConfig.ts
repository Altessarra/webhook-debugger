const parseBoundedPositiveInt = (
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number => {
  const rawValue = process.env[name];
  if (rawValue === undefined || !/^\d+$/.test(rawValue)) {
    return defaultValue;
  }

  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : defaultValue;
};

export const rateLimitWindowMs = parseBoundedPositiveInt(
  "RATE_LIMIT_WINDOW_MS",
  60_000,
  1_000,
  3_600_000,
);
export const inboxCreationRateLimit = parseBoundedPositiveInt(
  "RATE_LIMIT_INBOX_CREATION",
  10,
  1,
  Number.MAX_SAFE_INTEGER,
);
export const webhookIngestionRateLimit = parseBoundedPositiveInt(
  "RATE_LIMIT_WEBHOOK_INGESTION",
  120,
  1,
  Number.MAX_SAFE_INTEGER,
);
export const historyReadRateLimit = parseBoundedPositiveInt(
  "RATE_LIMIT_HISTORY_READS",
  30,
  1,
  Number.MAX_SAFE_INTEGER,
);
export const manualSendRateLimit = parseBoundedPositiveInt(
  "RATE_LIMIT_MANUAL_SEND",
  10,
  1,
  Number.MAX_SAFE_INTEGER,
);
export const replayRateLimit = parseBoundedPositiveInt(
  "RATE_LIMIT_REPLAY",
  10,
  1,
  Number.MAX_SAFE_INTEGER,
);
export const maxRateLimitKeys = parseBoundedPositiveInt(
  "MAX_RATE_LIMIT_KEYS",
  10_000,
  100,
  100_000,
);
export const historyDefaultPageSize = parseBoundedPositiveInt(
  "HISTORY_DEFAULT_PAGE_SIZE",
  50,
  1,
  100,
);
export const requestRetentionHours = parseBoundedPositiveInt(
  "REQUEST_RETENTION_HOURS",
  168,
  1,
  8_760,
);
export const retentionCleanupIntervalMs = parseBoundedPositiveInt(
  "RETENTION_CLEANUP_INTERVAL_MS",
  900_000,
  60_000,
  86_400_000,
);
export const maxRequestsPerInbox = parseBoundedPositiveInt(
  "MAX_REQUESTS_PER_INBOX",
  1_000,
  1,
  100_000,
);
export const wsMaxConnectionsPerIp = parseBoundedPositiveInt(
  "WS_MAX_CONNECTIONS_PER_IP",
  10,
  1,
  100,
);
export const wsHeartbeatIntervalMs = parseBoundedPositiveInt(
  "WS_HEARTBEAT_INTERVAL_MS",
  30_000,
  5_000,
  300_000,
);
const configuredWsIdleTimeoutMs = parseBoundedPositiveInt(
  "WS_IDLE_TIMEOUT_MS",
  90_000,
  15_000,
  900_000,
);
export const wsIdleTimeoutMs =
  configuredWsIdleTimeoutMs > wsHeartbeatIntervalMs
    ? configuredWsIdleTimeoutMs
    : Math.min(900_000, Math.max(90_000, wsHeartbeatIntervalMs + 1));
export const wsMaxPayloadBytes = parseBoundedPositiveInt(
  "WS_MAX_PAYLOAD_BYTES",
  65_536,
  1_024,
  1_048_576,
);
export const enableHsts = /^true$/i.test(process.env.ENABLE_HSTS?.trim() ?? "");
