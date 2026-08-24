const REDACTED_VALUE = "[REDACTED]";

const EXACT_SENSITIVE_HEADERS = new Set([
  "api-key",
  "apikey",
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "stripe-signature",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-amz-security-token",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-paddle-signature",
  "x-razorpay-signature",
  "x-shopify-hmac-sha256",
  "x-signature",
  "x-signature-256",
  "x-slack-signature",
  "x-svix-signature",
  "x-twilio-signature",
  "x-webhook-signature",
]);

const TOKEN_HEADER_PATTERN =
  /(^|[-_])(?:access|api|auth|bearer|id|refresh|session)[-_]?(?:key|token|secret)($|[-_])/i;
const WEBHOOK_SIGNATURE_PATTERN =
  /(^|[-_])(?:hub|slack|stripe|svix|shopify|twilio|paddle|razorpay|webhook)[-_].*(?:hmac|signature)|(^|[-_])(?:hub|slack|stripe|svix|shopify|twilio|paddle|razorpay|webhook)[-_](?:hmac|signature)($|[-_])/i;

function isStringRecord(
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSensitiveHeader(name: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  return (
    EXACT_SENSITIVE_HEADERS.has(normalizedName) ||
    TOKEN_HEADER_PATTERN.test(normalizedName) ||
    WEBHOOK_SIGNATURE_PATTERN.test(normalizedName)
  );
}

export function maskSensitiveHeaders(
  value: string,
  revealed: boolean,
): string {
  if (revealed) return value;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isStringRecord(parsed)) return value;

    const maskedEntries = Object.entries(parsed).map(([name, headerValue]) => [
      name,
      isSensitiveHeader(name) ? REDACTED_VALUE : headerValue,
    ]);

    return JSON.stringify(Object.fromEntries(maskedEntries), null, 2);
  } catch {
    return value;
  }
}
