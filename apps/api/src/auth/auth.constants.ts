export const SESSION_COOKIE = "solarcrm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

/** Secure cookies in production unless explicitly turned off (e.g. a plain-HTTP intranet trial). */
export const cookieSecure = () =>
  process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
