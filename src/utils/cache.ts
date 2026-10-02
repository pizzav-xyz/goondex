/**
 * Lightweight TTL cache for API responses.
 * Preserves exact behavior from original cache.js.
 * Evicts oldest entry when max capacity is reached.
 */
export class TTLCache<T = unknown> {
  #store = new Map<string, { value: T; expiresAt: number }>()
  #maxEntries: number
  #defaultTTL: number

  /**
   * @param defaultTTL - Default time-to-live in milliseconds
   * @param maxEntries - Maximum cache entries (evicts oldest when exceeded)
   */
  constructor(defaultTTL = 300_000, maxEntries = 50) {
    this.#defaultTTL = defaultTTL
    this.#maxEntries = maxEntries
  }

  get(key: string): T | undefined {
    const entry = this.#store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.#store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T, ttl = this.#defaultTTL): void {
    // Evict oldest if at capacity
    if (this.#store.size >= this.#maxEntries && !this.#store.has(key)) {
      const oldestKey = this.#store.keys().next().value
      if (oldestKey !== undefined) this.#store.delete(oldestKey)
    }
    this.#store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  delete(key: string): void {
    this.#store.delete(key)
  }

  clear(): void {
    this.#store.clear()
  }
}
