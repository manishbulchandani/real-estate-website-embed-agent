/**
 * cityCache.service.ts
 *
 * Lightweight in-memory TTL cache for city-level listing availability.
 * Prevents redundant DB hits when the agent probes inventory for a city
 * multiple times within a short window (e.g. rapid follow-up questions).
 *
 * TTL: 5 minutes (configurable via CITY_CACHE_TTL_MS)
 * Storage: process-local Map — cleared on server restart (acceptable for this use case)
 */

const CITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CityCacheEntry {
  hasListings: boolean;
  count: number;
  cachedAt: number;
}

// Normalise city keys so "pune" and "Pune" hit the same cache entry
const normalizeKey = (city: string): string => city.trim().toLowerCase();

const cache = new Map<string, CityCacheEntry>();

/**
 * Retrieve a cached city availability entry.
 * Returns null if not cached or if the entry has expired.
 */
export function getCityCacheEntry(city: string): CityCacheEntry | null {
  const key = normalizeKey(city);
  const entry = cache.get(key);
  if (!entry) return null;

  const isExpired = Date.now() - entry.cachedAt > CITY_CACHE_TTL_MS;
  if (isExpired) {
    cache.delete(key);
    return null;
  }

  return entry;
}

/**
 * Store a city availability result in the cache with the current timestamp.
 */
export function setCityCacheEntry(
  city: string,
  result: Pick<CityCacheEntry, "hasListings" | "count">,
): void {
  const key = normalizeKey(city);
  cache.set(key, { ...result, cachedAt: Date.now() });
}

/**
 * Manually invalidate a city cache entry (useful for testing or admin resets).
 */
export function invalidateCityCacheEntry(city: string): void {
  cache.delete(normalizeKey(city));
}
