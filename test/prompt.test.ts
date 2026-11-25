import { describe, expect, test } from "bun:test"
import { buildDescribePrompt, buildTranslatePrompt } from "../src/core/prompt.js"

describe("buildTranslatePrompt", () => {
  test("names the target language and includes the source", () => {
    const prompt = buildTranslatePrompt("Deploy the app", "zh-cn")
    expect(prompt).toContain("Simplified Chinese")
    expect(prompt).toContain("Deploy the app")
    expect(prompt).toContain("ONLY")
  })
  test("lists protected tokens", () => {
    const prompt = buildTranslatePrompt("Run $ARGUMENTS with `git status`", "ja")
    expect(prompt).toContain("$ARGUMENTS")
    expect(prompt).toContain("`git status`")
    expect(prompt).toContain("Japanese")
  })
  test("no token line for plain text", () => {
    const prompt = buildTranslatePrompt("Deploy the app", "fr")
    expect(prompt).not.toContain("Keep these tokens")
  })
})

describe("buildDescribePrompt", () => {
  test("includes name and target language", () => {
    const prompt = buildDescribePrompt({ name: "deploy", targetTag: "zh-cn" })
    expect(prompt).toContain("deploy")
    expect(prompt).toContain("Simplified Chinese")
  })
  test("includes truncated content", () => {
    const content = "x".repeat(5000)
    const prompt = buildDescribePrompt({ name: "deploy", content, targetTag: "en" })
    expect(prompt).toContain("x".repeat(2000))
    expect(prompt).not.toContain("x".repeat(2001))
  })
})
