import { describe, expect, test } from "bun:test"
import {
  baseLanguage,
  detectEnvLanguage,
  languageName,
  looksLikeTarget,
  normalizeLanguage,
  resolveLanguage,
} from "../src/core/language.js"

describe("normalizeLanguage", () => {
  test("lowercases and converts underscores", () => {
    expect(normalizeLanguage("zh_CN")).toBe("zh-cn")
    expect(normalizeLanguage("EN")).toBe("en")
  })
  test("strips charset and modifier suffixes", () => {
    expect(normalizeLanguage("zh_CN.UTF-8")).toBe("zh-cn")
    expect(normalizeLanguage("de_DE@euro")).toBe("de-de")
  })
  test("rejects empty and C/POSIX", () => {
    expect(normalizeLanguage("")).toBeUndefined()
    expect(normalizeLanguage(undefined)).toBeUndefined()
    expect(normalizeLanguage("C")).toBeUndefined()
    expect(normalizeLanguage("POSIX")).toBeUndefined()
    expect(normalizeLanguage("  ")).toBeUndefined()
  })
})

describe("detectEnvLanguage", () => {
  test("prefers LC_ALL over LANG", () => {
    expect(detectEnvLanguage({ LC_ALL: "ja_JP.UTF-8", LANG: "en_US.UTF-8" })).toBe("ja-jp")
  })
  test("falls through LC_MESSAGES, LANG, LANGUAGE", () => {
    expect(detectEnvLanguage({ LANG: "fr_FR.UTF-8" })).toBe("fr-fr")
    expect(detectEnvLanguage({ LANGUAGE: "ko" })).toBe("ko")
  })
  test("skips C locale", () => {
    expect(detectEnvLanguage({ LC_ALL: "C", LANG: "zh_CN.UTF-8" })).toBe("zh-cn")
  })
})

describe("resolveLanguage", () => {
  test("explicit wins over environment", () => {
    expect(resolveLanguage("zh-cn", { LANG: "en_US.UTF-8" })).toBe("zh-cn")
  })
  test("falls back to environment", () => {
    expect(resolveLanguage(undefined, { LANG: "ja_JP.UTF-8" })).toBe("ja-jp")
  })
  test("falls back to the runtime locale with no environment", () => {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
    expect(resolveLanguage(undefined, {})).toBe(locale)
  })
})

describe("languageName / baseLanguage", () => {
  test("names known languages", () => {
    expect(languageName("zh-cn")).toBe("Simplified Chinese")
    expect(languageName("zh-tw")).toBe("Traditional Chinese")
    expect(languageName("ja")).toBe("Japanese")
  })
  test("falls back to base subtag", () => {
    expect(languageName("fr-ca")).toBe("French")
  })
  test("passes unknown tags through", () => {
    expect(languageName("xx-yy")).toBe("xx-yy")
  })
  test("baseLanguage", () => {
    expect(baseLanguage("zh-cn")).toBe("zh")
    expect(baseLanguage("en")).toBe("en")
  })
})

describe("looksLikeTarget", () => {
  test("Chinese text matches zh, not en", () => {
    expect(looksLikeTarget("部署应用到生产环境", "zh-cn")).toBe(true)
    expect(looksLikeTarget("部署应用到生产环境", "en")).toBe(false)
  })
  test("English text matches en", () => {
    expect(looksLikeTarget("Deploy the app to production", "en")).toBe(true)
    expect(looksLikeTarget("Deploy the app to production", "zh-cn")).toBe(false)
  })
  test("Japanese kana matches ja, not zh", () => {
    expect(looksLikeTarget("アプリをデプロイする", "ja")).toBe(true)
    expect(looksLikeTarget("アプリをデプロイする", "zh-cn")).toBe(false)
  })
  test("Korean hangul matches ko", () => {
    expect(looksLikeTarget("앱을 배포합니다", "ko")).toBe(true)
  })
  test("unknown targets are conservative", () => {
    expect(looksLikeTarget("anything", "xx")).toBe(false)
  })
})
