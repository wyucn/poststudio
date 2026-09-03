export interface CacheLoadResult<T> {
  value: Promise<T>;
  hit: boolean;
}

interface CacheEntry<T> {
  value: Promise<T>;
  expiresAt: number;
}

/** 进程内短时缓存：合并相同并发请求，并限制键数量避免长期增长。 */
export class TtlPromiseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 128
  ) {}

  getOrLoad(
    key: string,
    loader: () => T | Promise<T>,
    nowMs = Date.now()
  ): CacheLoadResult<T> {
    this.deleteExpired(nowMs);
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > nowMs) {
      return { value: existing.value, hit: true };
    }

    const value = Promise.resolve().then(loader);
    const entry = { value, expiresAt: nowMs + this.ttlMs };
    this.entries.set(key, entry);
    this.trim();
    void value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return { value, hit: false };
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private deleteExpired(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= nowMs) this.entries.delete(key);
    }
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
    }
  }
}
