import { describe, expect, test } from "bun:test"
import { parseModel, resolveOptions } from "../src/core/config.js"

describe("parseModel", () => {
  test("parses provider/model strings", () => {
    expect(parseModel("ollama/qwen2.5:7b")).toEqual({ providerID: "ollama", id: "qwen2.5:7b" })
  })
  test("keeps slashes inside the model id", () => {
    expect(parseModel("openrouter/meta/llama-3")).toEqual({ providerID: "openrouter", id: "meta/llama-3" })
  })
  test("parses objects with variant", () => {
    expect(parseModel({ providerID: "p", id: "m", variant: "fast" })).toEqual({ providerID: "p", id: "m", variant: "fast" })
  })
  test("rejects malformed values", () => {
    expect(parseModel("")).toBeUndefined()
    expect(parseModel("no-slash")).toBeUndefined()
    expect(parseModel("/model")).toBeUndefined()
    expect(parseModel("provider/")).toBeUndefined()
    expect(parseModel({ providerID: "p" })).toBeUndefined()
    expect(parseModel(null)).toBeUndefined()
  })
})

describe("resolveOptions", () => {
  test("defaults", () => {
    const c = resolveOptions({})
    expect(c.enabled).toBe(true)
    expect(c.targets).toEqual(["command", "skill", "agent"])
    expect(c.generateMissing).toBe(false)
    expect(c.tuiCommands).toBe(true)
    expect(c.concurrency).toBe(3)
    expect(c.timeoutMs).toBe(30000)
    expect(c.refreshOnEvents).toBe(true)
    expect(c.language).toBeUndefined()
    expect(c.model).toEqual({ providerID: "opencode", id: "deepseek-v4.1-flash-free" })
  })
  test("reads explicit values", () => {
    const c = resolveOptions({
      enabled: false,
      language: " zh-cn ",
      model: "opencode/hy4-flash-free",
      targets: ["skill"],
      generateMissing: true,
      descriptions: { deploy: "手动描述", empty: "  " },
      tuiCommands: false,
      concurrency: 5,
      timeoutMs: 5000,
      refreshOnEvents: false,
    })
    expect(c.enabled).toBe(false)
    expect(c.language).toBe("zh-cn")
    expect(c.model).toEqual({ providerID: "opencode", id: "hy4-flash-free" })
    expect(c.targets).toEqual(["skill"])
    expect(c.generateMissing).toBe(true)
    expect(c.descriptions).toEqual({ deploy: "手动描述" })
    expect(c.tuiCommands).toBe(false)
    expect(c.concurrency).toBe(5)
    expect(c.timeoutMs).toBe(5000)
    expect(c.refreshOnEvents).toBe(false)
  })
  test("clamps out-of-range numbers", () => {
    expect(resolveOptions({ concurrency: 100 }).concurrency).toBe(8)
    expect(resolveOptions({ concurrency: 0 }).concurrency).toBe(1)
    expect(resolveOptions({ timeoutMs: 1 }).timeoutMs).toBe(1000)
    expect(resolveOptions({ timeoutMs: 999999 }).timeoutMs).toBe(120000)
    expect(resolveOptions({ concurrency: "x" }).concurrency).toBe(3)
  })
  test("invalid targets fall back to all", () => {
    expect(resolveOptions({ targets: ["bogus"] }).targets).toEqual(["command", "skill", "agent"])
  })
  test("invalid model falls back to the free default", () => {
    expect(resolveOptions({ model: "no-slash" }).model).toEqual({ providerID: "opencode", id: "deepseek-v4.1-flash-free" })
    expect(resolveOptions({ model: "" }).model).toEqual({ providerID: "opencode", id: "deepseek-v4.1-flash-free" })
  })
  test("accepts agent target", () => {
    expect(resolveOptions({ targets: ["agent"] }).targets).toEqual(["agent"])
    expect(resolveOptions({ targets: ["command", "agent", "nope"] }).targets).toEqual(["command", "agent"])
  })
  test("tolerates non-object input", () => {
    expect(resolveOptions(null).enabled).toBe(true)
    expect(resolveOptions("x").targets).toEqual(["command", "skill", "agent"])
  })
})
