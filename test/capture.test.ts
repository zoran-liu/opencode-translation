import { describe, expect, test } from "bun:test"
import { identifyRegistry, PROBE_NAME } from "../src/server/capture.js"

interface Def {
  name: string
  description?: string
  execute: () => void
}

const nativeSet = Map.prototype.set

describe("identifyRegistry", () => {
  test("finds the map behind a map-backed editor and removes the probe", () => {
    const map = new Map<string, Def>()
    const original: Def = { name: "deploy", description: "Deploy the app", execute: () => {} }
    map.set("deploy", original)
    const editor = { add: (def: Def) => void map.set(def.name, def) }
    const probe: Def = { name: PROBE_NAME, execute: () => {} }

    const found = identifyRegistry(editor, probe)

    expect(found).toBe(map)
    expect(map.has(PROBE_NAME)).toBe(false)
    expect(map.get("deploy")).toBe(original)
    expect(Map.prototype.set).toBe(nativeSet)
  })

  test("returns undefined when add is not map-backed", () => {
    const editor = { add: (_def: Def) => {} }
    expect(identifyRegistry(editor, { name: PROBE_NAME, execute: () => {} })).toBeUndefined()
    expect(Map.prototype.set).toBe(nativeSet)
  })

  test("restores Map.prototype.set even when add throws", () => {
    const editor = {
      add: (_def: Def) => {
        throw new Error("rejected")
      },
    }
    expect(identifyRegistry(editor, { name: PROBE_NAME, execute: () => {} })).toBeUndefined()
    expect(Map.prototype.set).toBe(nativeSet)
  })

  test("preserves a pre-existing Map.prototype.set wrapper", () => {
    const calls: unknown[] = []
    const wrapper = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      calls.push(key)
      return nativeSet.call(this, key, value)
    } as typeof Map.prototype.set
    Map.prototype.set = wrapper
    try {
      const map = new Map<string, Def>()
      const editor = { add: (def: Def) => void map.set(def.name, def) }
      const found = identifyRegistry(editor, { name: PROBE_NAME, execute: () => {} })
      expect(found).toBe(map)
      expect(Map.prototype.set).toBe(wrapper)
      expect(calls).toContain(PROBE_NAME)
    } finally {
      Map.prototype.set = nativeSet
    }
  })

  test("restores a real command that shares the probe name", () => {
    const map = new Map<string, Def>()
    const real: Def = { name: PROBE_NAME, description: "real", execute: () => {} }
    map.set(PROBE_NAME, real)
    const editor = { add: (def: Def) => void map.set(def.name, def) }

    const found = identifyRegistry(editor, { name: PROBE_NAME, execute: () => {} })

    expect(found).toBe(map)
    expect(map.get(PROBE_NAME)).toBe(real)
  })

  test("unrelated maps are not captured", () => {
    const other = new Map<string, Def>()
    const registry = new Map<string, Def>()
    const editor = {
      add: (def: Def) => {
        other.set("decoy", { name: "decoy", execute: () => {} })
        registry.set(def.name, def)
      },
    }
    const found = identifyRegistry(editor, { name: PROBE_NAME, execute: () => {} })
    expect(found).toBe(registry)
    expect(other.has(PROBE_NAME)).toBe(false)
  })
})
