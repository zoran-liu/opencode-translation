import { Rpc } from "@opencode/plugin/rpc"

/**
 * Typed control surface implemented by the server part and called by the TUI and
 * GUI parts (and any external client). JSON Schema keeps it dependency-free.
 */

const str = { type: "string" } as const
const bool = { type: "boolean" } as const
const num = { type: "number" } as const

export const TranslationRpc = Rpc.define({
  id: "opencode-translation",
  methods: {
    /** Current configuration and translation counts. */
    status: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: {
          enabled: bool,
          language: str,
          detectedLanguage: str,
          model: str,
          commands: num,
          skills: num,
          agents: num,
          translated: num,
          cached: num,
          failed: num,
          pending: num,
        },
        required: ["enabled", "language", "commands", "skills", "agents", "translated", "cached", "failed", "pending"],
        additionalProperties: false,
      },
    },
    /** Re-scan and translate. `force` retries entries that previously failed. */
    refresh: {
      input: {
        type: "object",
        properties: { force: bool },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: bool, translated: num, failed: num },
        required: ["ok", "translated", "failed"],
        additionalProperties: false,
      },
    },
    /** Set (or clear, with null) the target language override. */
    setLanguage: {
      input: {
        type: "object",
        properties: { language: { type: ["string", "null"] } },
        required: ["language"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { language: str },
        required: ["language"],
        additionalProperties: false,
      },
    },
    /** Set (or clear, with null) the translation model override ("provider/model"). */
    setModel: {
      input: {
        type: "object",
        properties: { model: { type: ["string", "null"] } },
        required: ["model"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { model: str },
        required: ["model"],
        additionalProperties: false,
      },
    },
    /** Enable or disable translation. */
    setEnabled: {
      input: {
        type: "object",
        properties: { enabled: bool },
        required: ["enabled"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { enabled: bool },
        required: ["enabled"],
        additionalProperties: false,
      },
    },
    /** Drop all cached translations. */
    clearCache: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { removed: num },
        required: ["removed"],
        additionalProperties: false,
      },
    },
    /** Per-item translation detail, for a status view. */
    list: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: str,
                key: str,
                name: str,
                original: str,
                translated: str,
                state: str,
                override: str,
              },
              required: ["kind", "key", "name", "original", "translated", "state"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    /**
     * Set (or clear, with null/empty) a manual description override for one
     * item. Overrides win over config descriptions and originals, and are
     * translated like any other source text. `kind` is command/skill/agent/tui;
     * `key` is the command name, skill id, agent name or TUI command id.
     */
    setDescription: {
      input: {
        type: "object",
        properties: {
          kind: str,
          key: str,
          description: { type: ["string", "null"] },
        },
        required: ["kind", "key", "description"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: bool },
        required: ["ok"],
        additionalProperties: false,
      },
    },
    /** All manual description overrides, keyed "kind:key". */
    getOverrides: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: {
          overrides: { type: "object", additionalProperties: str },
        },
        required: ["overrides"],
        additionalProperties: false,
      },
    },
    /**
     * Translate one arbitrary text with the shared engine and cache. Used by
     * the TUI part for TUI-local command titles/descriptions. Returns the
     * original text when translation is disabled, unnecessary or fails.
     */
    translate: {
      input: {
        type: "object",
        properties: { text: str },
        required: ["text"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: str, changed: bool },
        required: ["text", "changed"],
        additionalProperties: false,
      },
    },
  },
  events: {
    /** Emitted after a refresh applies translations. */
    updated: {
      schema: {
        type: "object",
        properties: { language: str, translated: num, failed: num },
        required: ["language", "translated", "failed"],
        additionalProperties: false,
      },
    },
  },
})

/** Convenience shapes for clients (JSON Schema values are `unknown` at runtime). */
export interface StatusResult {
  enabled: boolean
  language: string
  detectedLanguage?: string
  model?: string
  commands: number
  skills: number
  agents: number
  translated: number
  cached: number
  failed: number
  pending: number
}
export interface RefreshResult {
  ok: boolean
  translated: number
  failed: number
}
export type ItemKind = "command" | "skill" | "agent" | "tui"
export interface ListItem {
  kind: ItemKind
  /** Stable identifier used by setDescription: command name, skill id, agent name, TUI command id. */
  key: string
  name: string
  original: string
  translated: string
  state: "translated" | "cached" | "original" | "failed" | "pending"
  /** Manual override text, when one is set. */
  override?: string
}
