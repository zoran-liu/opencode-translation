/**
 * Helpers for translating TUI-local keymap commands (built-in TUI commands and
 * other plugins' palette entries), which never pass through the server
 * registries.
 *
 * Mechanism (verified against @opentui/keymap 0.8.4, used by opencode 2.3.2):
 * layers are ordered by priority (higher first, later registration wins ties);
 * the palette lists the FIRST reachable entry per command name, and dispatch
 * walks the same-name chain until a command handles the call — a command whose
 * run returns `false` falls through to the next one. So a high-priority layer
 * that re-registers a command under the same id, with translated title /
 * description, `bind: false` (keeps the original keybindings) and
 * `run: () => false` (delegates to the original), localizes the palette without
 * changing behavior.
 *
 * Shadow entries carry a marker field so the plugin can recognize its own
 * contributions in `keymap.commands()` (the host spreads the command object,
 * which preserves extra enumerable fields).
 */

import type { KeymapCommand } from "@opencode/plugin/tui/context"
import { looksLikeTarget } from "../core/language.js"

export const SHADOW_MARKER = "__opencodeTranslationShadow"

export function isShadowCommand(command: unknown): boolean {
  return Boolean(command && typeof command === "object" && (command as Record<string, unknown>)[SHADOW_MARKER])
}

export function isOwnCommand(command: KeymapCommand, ownPrefix: string): boolean {
  return typeof command.id === "string" && command.id.startsWith(ownPrefix)
}

/** Commands worth shadowing: named, foreign, with text that is not already localized. */
export function selectShadowTargets(
  commands: readonly KeymapCommand[],
  ownPrefix: string,
  targetTag: string,
): KeymapCommand[] {
  return commands.filter((command) => {
    if (!command.id || isOwnCommand(command, ownPrefix) || isShadowCommand(command)) return false
    const texts = [command.title, command.description].filter((t): t is string => Boolean(t && t.trim()))
    if (texts.length === 0) return false
    return texts.some((text) => !looksLikeTarget(text, targetTag))
  })
}

/**
 * Build the shadow entry for one original command. `title`/`description` are
 * the localized texts (undefined keeps the original). The marker survives the
 * host's object spreads; `bind: false` registers no keybindings and
 * `run: () => false` falls through to the original command on dispatch.
 */
export function buildShadowCommand(
  original: KeymapCommand,
  title: string | undefined,
  description: string | undefined,
): KeymapCommand {
  const shadow: KeymapCommand & Record<string, unknown> = {
    id: original.id,
    ...(title !== undefined ? { title } : original.title !== undefined ? { title: original.title } : {}),
    ...(description !== undefined
      ? { description }
      : original.description !== undefined
        ? { description: original.description }
        : {}),
    ...(original.group !== undefined ? { group: original.group } : {}),
    ...(original.palette !== undefined ? { palette: original.palette } : {}),
    ...(original.slash !== undefined ? { slash: original.slash } : {}),
    ...(original.suggested !== undefined ? { suggested: original.suggested } : {}),
    ...(original.enabled !== undefined ? { enabled: original.enabled } : {}),
    bind: false,
    run: () => false,
    [SHADOW_MARKER]: true,
  }
  return shadow
}

/** Stable signature of the translatable data of a shadow list (skip no-op updates). */
export function shadowSignature(shadows: readonly KeymapCommand[]): string {
  return JSON.stringify(shadows.map((s) => [s.id, s.title ?? "", s.description ?? ""]).sort())
}
