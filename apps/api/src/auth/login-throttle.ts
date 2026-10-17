const WINDOW_MS = 15 * 60_000;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 20;

/**
 * Slows password guessing: after 5 failures for an email (or 20 from one
 * address) within 15 minutes, further attempts are refused until the window
 * passes. In memory, so it is per API instance; move to Redis when scaling out.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  private recent(key: string, now: number) {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds until another attempt is allowed, or 0. */
  blockedFor(email: string, ip: string, now = Date.now()) {
    const checks: [string, number][] = [[`e:${email}`, MAX_PER_EMAIL], [`i:${ip}`, MAX_PER_IP]];
    let wait = 0;
    for (const [key, max] of checks) {
      const list = this.recent(key, now);
      if (list.length >= max) wait = Math.max(wait, Math.ceil((list[list.length - max] + WINDOW_MS - now) / 1000));
    }
    return wait;
  }

  fail(email: string, ip: string, now = Date.now()) {
    for (const key of [`e:${email}`, `i:${ip}`]) this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(email: string) {
    this.failures.delete(`e:${email}`);
  }
}
