export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

type WindowState = {
  windowStart: number;
  count: number;
};

export class FixedWindowLimiter {
  private readonly windows = new Map<string, WindowState>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: {
    limit: number;
    windowMs: number;
    maxKeys: number;
    now?: () => number;
  }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys;
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitDecision {
    const currentTime = this.now();
    this.removeExpired(currentTime);

    let state = this.windows.get(key);
    if (!state) {
      if (this.windows.size >= this.maxKeys) {
        let earliestWindowEnd = Number.POSITIVE_INFINITY;
        for (const activeState of this.windows.values()) {
          earliestWindowEnd = Math.min(
            earliestWindowEnd,
            activeState.windowStart + this.windowMs,
          );
        }
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((earliestWindowEnd - currentTime) / 1000),
          ),
        };
      }
      state = { windowStart: currentTime, count: 0 };
      this.windows.set(key, state);
    }

    if (state.windowStart + this.windowMs <= currentTime) {
      state.windowStart = currentTime;
      state.count = 0;
    }

    if (state.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((state.windowStart + this.windowMs - currentTime) / 1000),
        ),
      };
    }

    state.count += 1;
    return { allowed: true, remaining: this.limit - state.count };
  }

  private removeExpired(currentTime: number): void {
    for (const [key, state] of this.windows) {
      if (state.windowStart + this.windowMs <= currentTime) {
        this.windows.delete(key);
      }
    }
  }
}
