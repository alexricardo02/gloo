import type { ErrorCode } from "@/lib/actionResult";

/**
 * Maps a failed ActionResult to an i18n key (B11). Client-safe.
 *
 * The specific `messageKey` wins when the namespace has it; otherwise the
 * generic `code` (UNAUTHORIZED, RATE_LIMITED, ...). Usage with next-intl:
 *
 *   const t = useTranslations("Map.errors");
 *   t(actionErrorKey(result, (k) => t.has(k)))
 */
export function actionErrorKey(
  error: { code: ErrorCode; messageKey?: string },
  has: (key: string) => boolean,
): string {
  if (error.messageKey && has(error.messageKey)) return error.messageKey;
  return has(error.code) ? error.code : "INTERNAL";
}
