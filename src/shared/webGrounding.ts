export const WEB_MODES = ["off", "auto", "always"] as const;

export type WebMode = (typeof WEB_MODES)[number];

export function parseWebMode(
  value: unknown,
  fallback: WebMode = "auto",
): WebMode {
  if (
    typeof value === "string" &&
    WEB_MODES.includes(value as WebMode)
  ) {
    return value as WebMode;
  }

  return fallback;
}
