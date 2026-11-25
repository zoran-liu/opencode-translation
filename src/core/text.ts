/**
 * Cleaning and validation of raw model output before it is used as a
 * description. If the output cannot be trusted we return `undefined` and the
 * caller keeps the original text (the plugin's core safety guarantee).
 */

const FENCE = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/
const LABEL = /^(translation|translated text|译文|翻译|翻译结果| Übersetzung|traduction|traducción)\s*[:：]\s*/i

/** Strip code fences, wrapping quotes and "Translation:" style labels. */
export function sanitizeTranslation(raw: string, source: string): string | undefined {
  if (typeof raw !== "string") return undefined
  let text = raw.trim()
  if (!text) return undefined

  // A single fenced block: use its contents.
  const fenced = text.match(FENCE)
  if (fenced) text = fenced[1].trim()

  // A leading label the model sometimes adds.
  text = text.replace(LABEL, "").trim()

  // Wrapping quotes around the whole string.
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1).trim()
  }

  // Descriptions are short summaries; collapse whitespace to one line.
  text = text.replace(/\s+/g, " ").trim()
  if (!text) return undefined

  // Reject runaway output: far longer than the source is almost never a valid
  // description translation (the model likely explained instead of translating).
  const limit = Math.max(200, source.length * 4)
  if (text.length > limit) return undefined

  // Reject output that is just the prompt leaking back or an apology.
  if (/^(sorry|i cannot|i can't|as an ai)/i.test(text)) return undefined

  return text
}

/**
 * Placeholders and code-ish tokens that must survive translation unchanged.
 * Used to build the prompt's "do not translate" instruction.
 */
export function extractProtectedTokens(source: string): string[] {
  const tokens = new Set<string>()
  const patterns = [
    /\$ARGUMENTS/g,
    /\$[1-9]\d*/g,
    /\{\{[^}]+\}\}/g,
    /`[^`]+`/g,
  ]
  for (const re of patterns) {
    for (const match of source.matchAll(re)) tokens.add(match[0])
  }
  return [...tokens]
}
