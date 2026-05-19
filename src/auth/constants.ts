/**
 * Auth constants — single place for all auth-related constants.
 *
 * Centralises SESSION_COOKIE_NAME, ADMIN_PASSWORD_HASH_KEY,
 * COOKIE_SIGNING_SECRET_KEY, and login rate-limit values so route
 * handlers and the rate-limiter can import from one place.
 */

export { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./session";
export { ADMIN_PASSWORD_HASH_KEY, COOKIE_SIGNING_SECRET_KEY } from "../types/auth";

/** Maximum login attempts per IP within the login rate-limit window. */
export const LOGIN_RATE_LIMIT_MAX = 10;

/** Login rate-limit window duration in milliseconds (1 hour). */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 3_600_000;

/**
 * Maximum POST /setup attempts per IP within the setup rate-limit window.
 *
 * The legitimate operator needs at most a handful of attempts within the
 * 10-minute setup window (typos, validation errors). 10 attempts tolerates
 * honest mistakes while strictly limiting brute-force candidates an attacker
 * can submit before the window closes.
 */
export const SETUP_RATE_LIMIT_MAX = 10;

/**
 * Setup rate-limit window duration in milliseconds (10 minutes).
 *
 * Matches SETUP_WINDOW_MS — once the setup window closes, the upstream gate
 * rejects POST /setup anyway, so a longer window adds no defensive value.
 */
export const SETUP_RATE_LIMIT_WINDOW_MS = 600_000;
