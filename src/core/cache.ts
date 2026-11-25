import { createHash } from "node:crypto"

/**
 * Content-addressed translation cache.
 *
 * The key is derived from the target language plus the exact source text, so the
 * same description is translated once and reused across commands, skills,
 * projects and restarts. Stored through the plugin's durable `ctx.storage`.
 */

export const CACHE_PREFIX = "cache/"

export interface CacheEntry {
  /** Normalized target language tag. */
  lang: string
  /** Original description text. */
  source: string
  /** Translated text. */
  text: string
  /** Model used, for diagnostics. */
  model?: string
  /** Epoch ms when written. */
  at: number
}

/** Stable content hash for a (language, source) pair. */
export function cacheKey(lang: string, source: string): string {
  const hash = createHash("sha256").update(`${lang}\n${source}`).digest("hex")
  return `${CACHE_PREFIX}${hash}`
}

/** Type-guard for values read back out of storage. */
export function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return typeof v.lang === "string" && typeof v.source === "string" && typeof v.text === "string"
}
