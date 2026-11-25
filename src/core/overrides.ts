/**
 * Manual description overrides. Persisted server-side and editable from the
 * TUI/GUI, they win over config descriptions and registry originals — which
 * makes it possible to give items with an empty description a useful text.
 * Keys are "kind:key" (command name, skill id, agent name, TUI command id).
 */

export const OVERRIDE_KINDS = ["command", "skill", "agent", "tui"] as const
export type OverrideKind = (typeof OVERRIDE_KINDS)[number]

export function isOverrideKind(value: unknown): value is OverrideKind {
  return typeof value === "string" && (OVERRIDE_KINDS as readonly string[]).includes(value)
}

export function overrideKey(kind: string, key: string): string {
  return `${kind}:${key}`
}

/** Parse a persisted overrides object defensively; drop malformed entries. */
export function parseOverrides(raw: unknown): Map<string, string> {
  const result = new Map<string, string>()
  if (!raw || typeof raw !== "object") return result
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue
    const text = value.trim()
    if (!key || !text) continue
    result.set(key, text)
  }
  return result
}

/** Serialize for storage (plain JSON object). */
export function serializeOverrides(overrides: Map<string, string>): Record<string, string> {
  return Object.fromEntries(overrides)
}

/**
 * Resolve the source text to translate: manual override first, then the
 * config `descriptions` map, then the registry original.
 */
export function resolveSource(
  override: string | undefined,
  configured: string | undefined,
  original: string,
): string {
  return override ?? configured ?? original
}
