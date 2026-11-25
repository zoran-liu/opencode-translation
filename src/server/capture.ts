/**
 * Identify the command registry during a transform, without a lasting global
 * hook.
 *
 * The command registry is a `Map<string, Definition>` rebuilt from scratch on
 * every transform replay, and its editor only exposes `add`, which does
 * `map.set(name, definition)` — replacing the whole definition, including
 * `execute`. There is no public API to read an existing command's `execute`.
 *
 * To translate a command's description while preserving its behavior exactly,
 * we need the registry map itself. We find it with a probe:
 *
 * 1. Temporarily wrap `Map.prototype.set` (saving whatever is there, so another
 *    plugin's wrapper is preserved).
 * 2. `editor.add(probe)` — the wrapper records which map receives the probe.
 * 3. Restore `Map.prototype.set` immediately. The wrap exists only for the
 *    synchronous duration of one `add` call; transforms are synchronous, so no
 *    other code can run while it is installed.
 * 4. Delete the probe from the map (only if it is still our object) and return
 *    the map. The caller reads the pristine definitions — added by earlier
 *    transforms in this replay — straight from it.
 *
 * If the editor's `add` is not map-backed (a future host version), no map is
 * recorded and we return `undefined`; the caller then skips command translation
 * and everything else keeps working.
 */

export const PROBE_NAME = "__opencode_translation_probe__"

let probing = false

/**
 * Returns the registry map the editor writes to, with the probe removed, or
 * `undefined` when it cannot be identified. `probe` must be a valid definition
 * for the editor (its `execute` is never run: the probe is removed before the
 * replay finishes, and nothing observes the map mid-replay).
 */
export function identifyRegistry<D extends { name: string }>(
  editor: { add: (definition: D) => void },
  probe: D,
): Map<string, D> | undefined {
  if (probing) return undefined
  probing = true
  const previousSet = Map.prototype.set
  let found: Map<string, D> | undefined
  let displaced: D | undefined
  let hadDisplaced = false
  Map.prototype.set = function patchedSet(this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (key === probe.name && value === probe) {
      found = this as Map<string, D>
      hadDisplaced = this.has(key)
      displaced = this.get(key) as D | undefined
    }
    return previousSet.call(this, key, value)
  } as typeof Map.prototype.set
  try {
    editor.add(probe)
  } catch {
    // The editor rejected the probe; we cannot identify the registry.
  } finally {
    Map.prototype.set = previousSet
    probing = false
  }
  if (!found) return undefined
  // Undo the probe: restore a real command that happened to share its name,
  // otherwise remove the probe entry.
  if (hadDisplaced) found.set(probe.name, displaced as D)
  else found.delete(probe.name)
  return found
}
