import { describe, expect, test } from "bun:test"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import {
  SHADOW_MARKER,
  buildShadowCommand,
  isOwnCommand,
  isShadowCommand,
  selectShadowTargets,
  shadowSignature,
} from "../src/tui/shadow.js"

const cmd = (partial: Partial<KeymapCommand> & { id: string }): KeymapCommand => ({
  run: () => {},
  ...partial,
})

describe("isShadowCommand", () => {
  test("recognizes the marker after object spreads (host copies commands)", () => {
    const shadow = buildShadowCommand(cmd({ id: "a", title: "A" }), "甲", undefined)
    expect(isShadowCommand(shadow)).toBe(true)
    expect(isShadowCommand({ ...shadow, run: () => {} })).toBe(true)
  })
  test("rejects plain commands and junk", () => {
    expect(isShadowCommand(cmd({ id: "a" }))).toBe(false)
    expect(isShadowCommand(undefined)).toBe(false)
    expect(isShadowCommand(null)).toBe(false)
    expect(isShadowCommand("x")).toBe(false)
  })
})

describe("isOwnCommand", () => {
  test("matches the plugin prefix only", () => {
    expect(isOwnCommand(cmd({ id: "opencode-translation.menu" }), "opencode-translation.")).toBe(true)
    expect(isOwnCommand(cmd({ id: "app.exit" }), "opencode-translation.")).toBe(false)
    expect(isOwnCommand(cmd({ id: "x" }), "opencode-translation.")).toBe(false)
  })
})

describe("selectShadowTargets", () => {
  const commands = [
    cmd({ id: "app.exit", title: "Exit", description: "Close the app" }),
    cmd({ id: "app.zh", title: "退出", description: "关闭应用" }),
    cmd({ id: "app.empty" }),
    cmd({ id: "opencode-translation.menu", title: "Translation: menu" }),
    cmd({ id: "app.partial", title: "Open sidebar", description: "打开侧边栏" }),
  ]
  test("selects foreign commands with untranslated text", () => {
    const targets = selectShadowTargets(commands, "opencode-translation.", "zh-cn")
    expect(targets.map((c) => c.id)).toEqual(["app.exit", "app.partial"])
  })
  test("skips already-localized, empty and own commands", () => {
    const targets = selectShadowTargets(commands, "opencode-translation.", "en")
    // For an English target the Chinese entries need translation instead.
    expect(targets.map((c) => c.id)).toEqual(["app.zh", "app.partial"])
  })
  test("skips shadow entries (no double shadowing)", () => {
    const shadow = buildShadowCommand(commands[0], "退出", "关闭应用")
    expect(selectShadowTargets([shadow], "opencode-translation.", "zh-cn")).toEqual([])
  })
})

describe("buildShadowCommand", () => {
  const original = cmd({
    id: "app.exit",
    title: "Exit",
    description: "Close the app",
    group: "App",
    palette: true,
    slash: { name: "exit" },
    suggested: true,
    enabled: () => true,
    bind: "ctrl+q",
  })
  test("localizes text, keeps metadata, never rebinds keys", () => {
    const shadow = buildShadowCommand(original, "退出", "关闭应用")
    expect(shadow.id).toBe("app.exit")
    expect(shadow.title).toBe("退出")
    expect(shadow.description).toBe("关闭应用")
    expect(shadow.group).toBe("App")
    expect(shadow.palette).toBe(true)
    expect(shadow.slash).toEqual({ name: "exit" })
    expect(shadow.suggested).toBe(true)
    expect(typeof shadow.enabled).toBe("function")
    expect(shadow.bind).toBe(false)
    expect((shadow as unknown as Record<string, unknown>)[SHADOW_MARKER]).toBe(true)
  })
  test("run returns false so dispatch falls through to the original", () => {
    const shadow = buildShadowCommand(original, "退出", undefined)
    expect(shadow.run()).toBe(false)
  })
  test("undefined translations keep the original text", () => {
    const shadow = buildShadowCommand(original, undefined, undefined)
    expect(shadow.title).toBe("Exit")
    expect(shadow.description).toBe("Close the app")
  })
  test("works for commands without title/description", () => {
    const shadow = buildShadowCommand(cmd({ id: "x", description: "Do X" }), undefined, "做 X")
    expect(shadow.title).toBeUndefined()
    expect(shadow.description).toBe("做 X")
  })
})

describe("shadowSignature", () => {
  test("stable regardless of order, sensitive to text", () => {
    const a = buildShadowCommand(cmd({ id: "a", title: "A" }), "甲", undefined)
    const b = buildShadowCommand(cmd({ id: "b", title: "B" }), "乙", undefined)
    expect(shadowSignature([a, b])).toBe(shadowSignature([b, a]))
    const b2 = buildShadowCommand(cmd({ id: "b", title: "B" }), "乙乙", undefined)
    expect(shadowSignature([a, b])).not.toBe(shadowSignature([a, b2]))
  })
})