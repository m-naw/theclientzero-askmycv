/**
 * Bot user-agent detection. Spec §9 F7.
 *
 * Returns true (bot) when:
 * - ua is null or empty
 * - ua is shorter than 8 characters
 * - ua matches a known automated-client prefix (case-insensitive)
 */

const BOT_UA_PATTERN = /^(curl|wget|python-requests|httpie|go-http)/i;

export function isBotUserAgent(ua: string | null): boolean {
  if (ua === null || ua.length === 0) return true;
  if (ua.length < 8) return true;
  return BOT_UA_PATTERN.test(ua);
}
