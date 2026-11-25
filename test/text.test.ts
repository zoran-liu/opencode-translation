import { describe, expect, test } from "bun:test"
import { extractProtectedTokens, sanitizeTranslation } from "../src/core/text.js"

describe("sanitizeTranslation", () => {
  const source = "Deploy the app"

  test("passes clean text through", () => {
    expect(sanitizeTranslation("部署应用", source)).toBe("部署应用")
  })
  test("trims and collapses whitespace", () => {
    expect(sanitizeTranslation("  部署\n  应用  ", source)).toBe("部署 应用")
  })
  test("unwraps a single code fence", () => {
    expect(sanitizeTranslation("```\n部署应用\n```", source)).toBe("部署应用")
    expect(sanitizeTranslation("```text\n部署应用\n```", source)).toBe("部署应用")
  })
  test("strips translation labels", () => {
    expect(sanitizeTranslation("Translation: 部署应用", source)).toBe("部署应用")
    expect(sanitizeTranslation("译文：部署应用", source)).toBe("部署应用")
  })
  test("strips wrapping quotes", () => {
    expect(sanitizeTranslation('"部署应用"', source)).toBe("部署应用")
    expect(sanitizeTranslation("“部署应用”", source)).toBe("部署应用")
  })
  test("rejects empty output", () => {
    expect(sanitizeTranslation("", source)).toBeUndefined()
    expect(sanitizeTranslation("   ", source)).toBeUndefined()
  })
  test("rejects runaway output", () => {
    expect(sanitizeTranslation("x".repeat(1000), source)).toBeUndefined()
  })
  test("allows reasonably longer translations", () => {
    const long = "这是一个比较长的中文翻译句子但是仍然在合理范围之内"
    expect(sanitizeTranslation(long, "Hi")).toBe(long)
  })
  test("rejects apologies", () => {
    expect(sanitizeTranslation("Sorry, I cannot translate this.", source)).toBeUndefined()
    expect(sanitizeTranslation("As an AI language model, I", source)).toBeUndefined()
  })
})

describe("extractProtectedTokens", () => {
  test("finds placeholders and code spans", () => {
    const tokens = extractProtectedTokens("Run $ARGUMENTS with $1 and `git status` plus {{name}}")
    expect(tokens).toContain("$ARGUMENTS")
    expect(tokens).toContain("$1")
    expect(tokens).toContain("`git status`")
    expect(tokens).toContain("{{name}}")
  })
  test("deduplicates", () => {
    expect(extractProtectedTokens("$1 $1")).toEqual(["$1"])
  })
  test("empty for plain text", () => {
    expect(extractProtectedTokens("Deploy the app")).toEqual([])
  })
})
