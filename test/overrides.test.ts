import { describe, expect, test } from "bun:test"
import { isOverrideKind, overrideKey, parseOverrides, resolveSource, serializeOverrides } from "../src/core/overrides.js"

describe("overrideKey", () => {
  test("joins kind and key", () => {
    expect(overrideKey("command", "deploy")).toBe("command:deploy")
    expect(overrideKey("skill", "demo")).toBe("skill:demo")
    expect(overrideKey("agent", "explorer")).toBe("agent:explorer")
    expect(overrideKey("tui", "app.exit")).toBe("tui:app.exit")
  })
})

describe("isOverrideKind", () => {
  test("accepts the four kinds", () => {
    for (const kind of ["command", "skill", "agent", "tui"]) expect(isOverrideKind(kind)).toBe(true)
  })
  test("rejects anything else", () => {
    for (const value of ["", "bogus", 3, null, undefined, {}]) expect(isOverrideKind(value)).toBe(false)
  })
})

describe("parseOverrides", () => {
  test("reads string entries and trims them", () => {
    const m = parseOverrides({ "command:deploy": "  部署应用  ", "skill:demo": "演示" })
    expect(m.get("command:deploy")).toBe("部署应用")
    expect(m.get("skill:demo")).toBe("演示")
  })
  test("drops malformed entries", () => {
    const m = parseOverrides({ "command:x": 3, "command:y": "   ", "": "text", "skill:ok": "好" })
    expect(m.size).toBe(1)
    expect(m.get("skill:ok")).toBe("好")
  })
  test("tolerates non-object input", () => {
    expect(parseOverrides(null).size).toBe(0)
    expect(parseOverrides("x").size).toBe(0)
    expect(parseOverrides(undefined).size).toBe(0)
  })
})

describe("serializeOverrides", () => {
  test("round-trips through parse", () => {
    const m = new Map([["command:a", "甲"], ["agent:b", "乙"]])
    expect(parseOverrides(serializeOverrides(m))).toEqual(m)
  })
})

describe("resolveSource", () => {
  test("override wins over config and original", () => {
    expect(resolveSource("override", "config", "original")).toBe("override")
  })
  test("config wins over original", () => {
    expect(resolveSource(undefined, "config", "original")).toBe("config")
  })
  test("falls back to original (possibly empty)", () => {
    expect(resolveSource(undefined, undefined, "original")).toBe("original")
    expect(resolveSource(undefined, undefined, "")).toBe("")
  })
})