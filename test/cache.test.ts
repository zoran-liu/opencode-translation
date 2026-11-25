import { describe, expect, test } from "bun:test"
import { CACHE_PREFIX, cacheKey, isCacheEntry } from "../src/core/cache.js"

describe("cacheKey", () => {
  test("is stable for the same language and source", () => {
    expect(cacheKey("zh-cn", "Deploy the app")).toBe(cacheKey("zh-cn", "Deploy the app"))
  })
  test("differs by language", () => {
    expect(cacheKey("zh-cn", "Deploy the app")).not.toBe(cacheKey("ja", "Deploy the app"))
  })
  test("differs by source", () => {
    expect(cacheKey("zh-cn", "Deploy the app")).not.toBe(cacheKey("zh-cn", "Deploy the app!"))
  })
  test("uses the cache prefix", () => {
    expect(cacheKey("en", "x").startsWith(CACHE_PREFIX)).toBe(true)
  })
})

describe("isCacheEntry", () => {
  test("accepts a valid entry", () => {
    expect(isCacheEntry({ lang: "zh-cn", source: "a", text: "甲", at: 1 })).toBe(true)
  })
  test("rejects malformed values", () => {
    expect(isCacheEntry(undefined)).toBe(false)
    expect(isCacheEntry(null)).toBe(false)
    expect(isCacheEntry("x")).toBe(false)
    expect(isCacheEntry({ lang: "zh-cn" })).toBe(false)
    expect(isCacheEntry({ lang: 1, source: "a", text: "b" })).toBe(false)
  })
})
