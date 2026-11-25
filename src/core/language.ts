/**
 * Target-language detection and normalization.
 *
 * Priority: explicit option / stored setting > environment (LC_ALL, LC_MESSAGES,
 * LANG, LANGUAGE) > the runtime's default locale. Everything is normalized to a
 * BCP-47-ish tag so caching and prompts are stable.
 */

/** A small set of languages we can name confidently in a translation prompt. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  zh: "Simplified Chinese",
  "zh-cn": "Simplified Chinese",
  "zh-sg": "Simplified Chinese",
  "zh-hans": "Simplified Chinese",
  "zh-tw": "Traditional Chinese",
  "zh-hk": "Traditional Chinese",
  "zh-mo": "Traditional Chinese",
  "zh-hant": "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  "pt-br": "Brazilian Portuguese",
  ru: "Russian",
  it: "Italian",
  ar: "Arabic",
  hi: "Hindi",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  tr: "Turkish",
  nl: "Dutch",
  pl: "Polish",
  uk: "Ukrainian",
}

/** Normalize a locale tag: lowercase, underscores -> dashes, strip encoding/charset. */
export function normalizeLanguage(input: string | undefined | null): string | undefined {
  if (!input) return undefined
  let tag = String(input).trim()
  if (!tag) return undefined
  // Drop charset/modifier suffixes like ".UTF-8" or "@euro".
  tag = tag.split(/[.@]/)[0]
  tag = tag.replace(/_/g, "-").toLowerCase()
  if (!tag || tag === "c" || tag === "posix") return undefined
  return tag
}

/** Read the environment's language, if any. */
export function detectEnvLanguage(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]) {
    const value = normalizeLanguage(env[key])
    if (value) return value
  }
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    return normalizeLanguage(locale)
  } catch {
    return undefined
  }
}

/**
 * Resolve the target language. `explicit` wins (option or stored setting), then
 * the environment, then a fallback of English.
 */
export function resolveLanguage(explicit: string | undefined, env?: Record<string, string | undefined>): string {
  return normalizeLanguage(explicit) ?? detectEnvLanguage(env) ?? "en"
}

/** The base language subtag ("zh-cn" -> "zh"). */
export function baseLanguage(tag: string): string {
  return tag.split("-")[0]
}

/** A human-readable language name for the translation prompt. */
export function languageName(tag: string): string {
  const norm = normalizeLanguage(tag) ?? "en"
  if (LANGUAGE_NAMES[norm]) return LANGUAGE_NAMES[norm]
  const base = baseLanguage(norm)
  if (LANGUAGE_NAMES[base]) return LANGUAGE_NAMES[base]
  // Unknown language: pass the tag through; the model usually understands it.
  return norm
}

/** CJK / kana / hangul ranges used to guess whether text already matches the target. */
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/
const KANA = /[\u3040-\u30ff]/
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/
const CYRILLIC = /[\u0400-\u04ff]/
const ARABIC = /[\u0600-\u06ff]/
const THAI = /[\u0e00-\u0e7f]/
const DEVANAGARI = /[\u0900-\u097f]/

/**
 * Heuristic: does the text already look like it is written in the target
 * language? Used to skip needless model calls (and to avoid translating an
 * already-localized description back and forth). Conservative: when unsure we
 * return false so the text is still offered for translation.
 */
export function looksLikeTarget(text: string, tag: string): boolean {
  const base = baseLanguage(normalizeLanguage(tag) ?? "en")
  const has = (re: RegExp) => re.test(text)
  switch (base) {
    case "zh":
      return has(CJK) && !has(KANA) && !has(HANGUL)
    case "ja":
      return has(KANA) || (has(CJK) && has(KANA))
    case "ko":
      return has(HANGUL)
    case "ru":
    case "uk":
      return has(CYRILLIC)
    case "ar":
      return has(ARABIC)
    case "th":
      return has(THAI)
    case "hi":
      return has(DEVANAGARI)
    case "en":
      // Mostly latin letters and no other script => likely already English.
      return !has(CJK) && !has(KANA) && !has(HANGUL) && !has(CYRILLIC) && !has(ARABIC) && !has(THAI) && !has(DEVANAGARI)
    default:
      return false
  }
}
