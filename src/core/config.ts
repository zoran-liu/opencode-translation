/**
 * Plugin options (from the `options` object in opencode.json) plus runtime
 * settings persisted through storage. All fields are optional and validated
 * defensively so a malformed config never breaks the host.
 */

export interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

/**
 * Default translation model: OpenCode's free tier (no account or key needed
 * inside OpenCode). This one is zero-retention and strong at Chinese/English.
 * The free lineup rotates — set `model` to pin another free model or a local
 * provider (Ollama, LM Studio, …).
 */
export const DEFAULT_MODEL: ModelRef = { providerID: "opencode", id: "deepseek-v4.1-flash-free" }

export interface TranslationOptions {
  /** Master switch. Default true. */
  enabled?: boolean
  /** Explicit target language tag; otherwise detected from the environment. */
  language?: string
  /** Translation model as "provider/model" or an object; otherwise DEFAULT_MODEL (OpenCode free tier). */
  model?: string | ModelRef
  /** Which domains to translate. Default all three. */
  targets?: Array<"command" | "skill" | "agent">
  /** Generate a description for commands/skills/agents that have none. Default false. */
  generateMissing?: boolean
  /** Manual descriptions keyed by command name or skill id/name. Applied before translation. */
  descriptions?: Record<string, string>
  /**
   * Also translate TUI-local command titles/descriptions (built-in TUI commands
   * and other plugins' palette entries) by shadowing them in the keymap.
   * Experimental; degrades gracefully. Default true.
   */
  tuiCommands?: boolean
  /** Parallel translation calls. Default 3. */
  concurrency?: number
  /** Per-call timeout in ms. Default 30000. */
  timeoutMs?: number
  /** Re-translate when commands/skills/config change. Default true. */
  refreshOnEvents?: boolean
}

export interface ResolvedConfig {
  enabled: boolean
  language?: string
  model?: ModelRef
  targets: Array<"command" | "skill" | "agent">
  generateMissing: boolean
  descriptions: Record<string, string>
  tuiCommands: boolean
  concurrency: number
  timeoutMs: number
  refreshOnEvents: boolean
}

export function parseModel(value: unknown): ModelRef | undefined {
  if (!value) return undefined
  if (typeof value === "string") {
    const slash = value.indexOf("/")
    if (slash <= 0 || slash === value.length - 1) return undefined
    return { providerID: value.slice(0, slash), id: value.slice(slash + 1) }
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>
    if (typeof v.providerID === "string" && typeof v.id === "string") {
      return {
        providerID: v.providerID,
        id: v.id,
        ...(typeof v.variant === "string" ? { variant: v.variant } : {}),
      }
    }
  }
  return undefined
}

export function resolveOptions(raw: unknown): ResolvedConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as TranslationOptions
  const all: Array<"command" | "skill" | "agent"> = ["command", "skill", "agent"]
  const targets = Array.isArray(o.targets)
    ? o.targets.filter((t): t is "command" | "skill" | "agent" => t === "command" || t === "skill" || t === "agent")
    : all
  const descriptions: Record<string, string> = {}
  if (o.descriptions && typeof o.descriptions === "object") {
    for (const [key, value] of Object.entries(o.descriptions)) {
      if (typeof value === "string" && value.trim()) descriptions[key] = value
    }
  }
  return {
    enabled: o.enabled !== false,
    language: typeof o.language === "string" && o.language.trim() ? o.language.trim() : undefined,
    model: parseModel(o.model) ?? DEFAULT_MODEL,
    targets: targets.length ? targets : all,
    generateMissing: o.generateMissing === true,
    descriptions,
    tuiCommands: o.tuiCommands !== false,
    concurrency: clampInt(o.concurrency, 1, 8, 3),
    timeoutMs: clampInt(o.timeoutMs, 1000, 120000, 30000),
    refreshOnEvents: o.refreshOnEvents !== false,
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** Persisted runtime settings (changeable from the TUI/GUI without editing config). */
export interface StoredSettings {
  language?: string
  model?: ModelRef
  enabled?: boolean
}
