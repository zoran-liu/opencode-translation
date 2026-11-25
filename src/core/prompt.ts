import { extractProtectedTokens } from "./text.js"
import { languageName } from "./language.js"

/**
 * Prompts for the local model. Kept short and explicit so small local models
 * follow them reliably. The model is asked to return ONLY the translated text.
 */

export function buildTranslatePrompt(source: string, targetTag: string): string {
  const target = languageName(targetTag)
  const protectedTokens = extractProtectedTokens(source)
  const keep =
    protectedTokens.length > 0
      ? `\nKeep these tokens exactly as they are (do not translate or alter them): ${protectedTokens.join(", ")}`
      : ""
  return [
    `Translate the following software command/skill description into ${target}.`,
    "Rules:",
    "- Output ONLY the translated description, nothing else. No quotes, no explanation, no prefix.",
    "- Keep it concise and natural, as a short UI description.",
    "- Preserve technical terms, identifiers, file paths, flags and code.",
    keep,
    "",
    "Description:",
    source,
  ]
    .filter((line) => line !== undefined)
    .join("\n")
}

/**
 * Prompt to write a missing description for a command or skill, in the target
 * language, based on its name and (for skills) its content.
 */
export function buildDescribePrompt(input: { name: string; content?: string; targetTag: string }): string {
  const target = languageName(input.targetTag)
  const body = input.content ? `\n\nContent:\n${truncate(input.content, 2000)}` : ""
  return [
    `Write a single short description (one sentence) in ${target} for a software tool named "${input.name}".`,
    "Output ONLY the description, nothing else. No quotes, no explanation, no prefix.",
    "Base it on the name and content below. Be accurate and concise.",
    body,
  ].join("\n")
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
