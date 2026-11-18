/** Repeated-login protection: per client address and for the account as a whole (so
 * rotating addresses does not help). In memory: a restart clears it, which is acceptable
 * for a single admin behind nginx's own request limits. */
export const WINDOW_MS = 15 * 60 * 1000;
export const PER_ADDRESS = 5;
export const PER_ACCOUNT = 20;

interface Counter { failures: number; windowStart: number; blockedUntil: number }

export class LoginThrottle {
  private readonly addresses = new Map<string, Counter>();
  private readonly account: Counter = { failures: 0, windowStart: 0, blockedUntil: 0 };

  /** Seconds to wait before another attempt, or 0 when allowed. */
  retryAfter(address: string, now = Date.now()): number {
    const blockedUntil = Math.max(this.account.blockedUntil, this.addresses.get(address)?.blockedUntil ?? 0);
    return blockedUntil > now ? Math.ceil((blockedUntil - now) / 1000) : 0;
  }

  fail(address: string, now = Date.now()): void {
    if (this.addresses.size > 5000) this.prune(now);
    const counter = this.addresses.get(address) ?? { failures: 0, windowStart: now, blockedUntil: 0 };
    this.addresses.set(address, counter);
    for (const [entry, limit] of [[counter, PER_ADDRESS], [this.account, PER_ACCOUNT]] as const) {
      if (now - entry.windowStart > WINDOW_MS) { entry.failures = 0; entry.windowStart = now; }
      entry.failures++;
      if (entry.failures >= limit) { entry.blockedUntil = now + WINDOW_MS; entry.failures = 0; entry.windowStart = now; }
    }
  }

  succeed(address: string): void {
    this.addresses.delete(address);
    this.account.failures = 0;
  }

  private prune(now: number) {
    for (const [address, counter] of this.addresses) if (counter.blockedUntil < now && now - counter.windowStart > WINDOW_MS) this.addresses.delete(address);
  }
}

export const loginThrottle = new LoginThrottle();
