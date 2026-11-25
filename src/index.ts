import { Plugin, Model } from "@opencode/plugin/effect"
import type { CommandDefinition, CommandEditor } from "@opencode/plugin/effect/command"
import type { SkillEditor } from "@opencode/plugin/effect/skill"
import type { AgentEditor } from "@opencode/plugin/effect/agent"
import { Effect, Option, Scope, Stream, type Schema } from "effect"
import { TranslationRpc, type ListItem, type StatusResult } from "./rpc.js"
import { resolveOptions, parseModel, type ModelRef, type StoredSettings } from "./core/config.js"
import { resolveLanguage, detectEnvLanguage, looksLikeTarget } from "./core/language.js"
import { cacheKey, isCacheEntry, CACHE_PREFIX, type CacheEntry } from "./core/cache.js"
import { sanitizeTranslation } from "./core/text.js"
import { buildTranslatePrompt, buildDescribePrompt } from "./core/prompt.js"
import { identifyRegistry, PROBE_NAME } from "./server/capture.js"
import { isOverrideKind, overrideKey, parseOverrides, serializeOverrides } from "./core/overrides.js"

/**
 * Server part. Translates command, skill and agent (subagent) descriptions in
 * the shared server registries, which both the TUI and the GUI read, so one
 * transform localizes both interfaces. Translation uses the configured (local)
 * model through `experimental.generate.text`, is cached by content, and always
 * falls back to the original text when a translation cannot be produced.
 *
 * Manual description overrides (editable from the TUI/GUI via `setDescription`)
 * win over config descriptions and registry originals, so items with an empty
 * description can be given a useful text. The `translate` RPC exposes the same
 * engine/cache to the TUI part for TUI-local command titles.
 */

interface SkillOriginal {
  id: string
  name: string
  description: string
  content: string
}

interface AgentOriginal {
  id: string
  name: string
  description: string
}

interface Task {
  kind: "command" | "skill" | "agent"
  name: string
  source: string
  type: "translate" | "generate"
  content?: string
  skillName?: string
}

interface TaskResult extends Task {
  text: string | undefined
  fromCache: boolean
}

export default Plugin.define({
  id: "opencode-translation",
  effect: Effect.fn("TranslationPlugin")(function* (ctx) {
    const scope = yield* Effect.scope
    const config = resolveOptions(ctx.options)
    const detectedLanguage = detectEnvLanguage() ?? "en"

    const storedRaw = yield* ctx.storage.get("settings").pipe(Effect.catch(() => Effect.succeed(undefined)))
    const settings: StoredSettings = {}
    if (storedRaw && typeof storedRaw === "object") {
      const s = storedRaw as Record<string, unknown>
      if (typeof s.language === "string" && s.language.trim()) settings.language = s.language.trim()
      const m = parseModel(s.model)
      if (m) settings.model = m
      if (typeof s.enabled === "boolean") settings.enabled = s.enabled
    }

    const overridesRaw = yield* ctx.storage.get("overrides").pipe(Effect.catch(() => Effect.succeed(undefined)))
    const overrides = parseOverrides(overridesRaw)

    let enabled = settings.enabled ?? config.enabled
    let targetLang = resolveLanguage(settings.language ?? config.language)
    let model: ModelRef | undefined = settings.model ?? config.model

    // Content-keyed translations and name-keyed generated descriptions.
    let commandTranslations = new Map<string, string>()
    let skillTranslations = new Map<string, string>()
    let agentTranslations = new Map<string, string>()
    let commandGenerated = new Map<string, string>()
    let skillGenerated = new Map<string, string>()
    let agentGenerated = new Map<string, string>()

    let commandOriginals = new Map<string, CommandDefinition>()
    let skillOriginals = new Map<string, SkillOriginal>()
    let agentOriginals = new Map<string, AgentOriginal>()
    let lastStats = { translated: 0, cached: 0, failed: 0 }
    let pendingCount = 0
    let refreshing = false
    // What the registry currently reflects; used to skip no-op reloads (which
    // would otherwise re-trigger change events in a loop).
    let lastApplied: { enabled: boolean; lang: string; sig: string } | undefined

    const modelLabel = () => (model ? `${model.providerID}/${model.id}` : "(default)")

    const persistSettings = () => {
      const value: Record<string, unknown> = {}
      if (settings.language !== undefined) value.language = settings.language
      if (settings.model) value.model = settings.model
      if (settings.enabled !== undefined) value.enabled = settings.enabled
      return ctx.storage.set("settings", value as Schema.Json).pipe(Effect.catch(() => Effect.void))
    }

    const persistOverrides = () =>
      ctx.storage.set("overrides", serializeOverrides(overrides) as Schema.Json).pipe(Effect.catch(() => Effect.void))

    // Source text priority: manual override > config descriptions > original.
    const commandSource = (name: string, original: string): string =>
      overrides.get(overrideKey("command", name)) ?? config.descriptions[name] ?? original
    const skillSource = (id: string, name: string, original: string): string =>
      overrides.get(overrideKey("skill", id)) ??
      overrides.get(overrideKey("skill", name)) ??
      config.descriptions[id] ??
      config.descriptions[name] ??
      original
    const agentSource = (id: string, original: string): string =>
      overrides.get(overrideKey("agent", id)) ?? config.descriptions[id] ?? original

    const commandDesired = (name: string, original: string): string => {
      const source = commandSource(name, original)
      let desired = commandTranslations.get(source) ?? source
      if (!source && commandGenerated.has(name)) desired = commandGenerated.get(name)!
      return desired ?? ""
    }
    const skillDesired = (id: string, name: string, original: string): string => {
      const source = skillSource(id, name, original)
      let desired = skillTranslations.get(source) ?? source
      if (!source && skillGenerated.has(id)) desired = skillGenerated.get(id)!
      return desired ?? ""
    }
    const agentDesired = (id: string, original: string): string => {
      const source = agentSource(id, original)
      let desired = agentTranslations.get(source) ?? source
      if (!source && agentGenerated.has(id)) desired = agentGenerated.get(id)!
      return desired ?? ""
    }

    // Command transform: identify the registry, snapshot the pristine
    // definitions (including execute), then re-add translated descriptions
    // that delegate to the captured execute. Behavior is unchanged.
    const commandTransform = (editor: CommandEditor) => {
      const probe: CommandDefinition = { name: PROBE_NAME, execute: () => Effect.void }
      const registry = identifyRegistry(editor, probe)
      if (registry) {
        const originals = new Map<string, CommandDefinition>()
        for (const [name, def] of registry) {
          if (def && typeof def.execute === "function") originals.set(name, def)
        }
        commandOriginals = originals
      }
      if (!enabled || !config.targets.includes("command")) return
      for (const [name, def] of commandOriginals) {
        const desired = commandDesired(name, def.description ?? "")
        if (desired && desired !== (def.description ?? "")) {
          editor.add({ name, description: desired, execute: def.execute })
        }
      }
    }

    // Skill transform: edit the description in place.
    const skillTransform = (editor: SkillEditor) => {
      const skills = editor.list()
      skillOriginals = new Map(
        skills.map((s) => [s.id, { id: s.id, name: s.name, description: s.description ?? "", content: s.content }]),
      )
      if (!enabled || !config.targets.includes("skill")) return
      for (const s of skills) {
        const desired = skillDesired(s.id, s.name, s.description ?? "")
        if (desired && desired !== (s.description ?? "")) {
          editor.update(s.id, (draft) => {
            draft.description = desired
          })
        }
      }
    }

    // Agent transform: edit descriptions in place, like skills. Hidden agents
    // (internal helpers such as title/summary) are never shown and are skipped.
    const agentTransform = (editor: AgentEditor) => {
      const agents = editor.list()
      agentOriginals = new Map(
        agents
          .filter((a) => !a.hidden)
          .map((a) => [a.id, { id: a.id, name: a.name, description: a.description ?? "" }]),
      )
      if (!enabled || !config.targets.includes("agent")) return
      for (const a of agents) {
        if (a.hidden) continue
        const desired = agentDesired(a.id, a.description ?? "")
        if (desired && desired !== (a.description ?? "")) {
          editor.update(a.id, (draft) => {
            draft.description = desired
          })
        }
      }
    }

    // Transforms replay in registration order. Some internal config plugins
    // (file commands, skills) register late, after an async scan, so items can
    // land after our transform. We then re-register (dispose + register moves
    // us to the end of the order) — see doRefresh.
    let commandReg = yield* ctx.command.transform(commandTransform)
    let skillReg = yield* ctx.skill.transform(skillTransform)
    let agentReg = yield* ctx.agent.transform(agentTransform)

    // ---- translation engine ----

    const genWithTimeout = (prompt: string): Effect.Effect<string | undefined> => {
      // Model.Ref brands its ids at the type level only; runtime values are plain strings.
      const ref = model
        ? ({ providerID: model.providerID, id: model.id, ...(model.variant ? { variant: model.variant } : {}) } as unknown as Model.Ref)
        : undefined
      return ctx.experimental.generate.text({ prompt, ...(ref ? { model: ref } : {}) }).pipe(
        Effect.map((r) => r.text),
        Effect.timeoutOption(config.timeoutMs),
        Effect.map(Option.getOrUndefined),
        Effect.catch(() => Effect.succeed(undefined)),
      )
    }

    const translateText = (
      source: string,
      force: boolean,
    ): Effect.Effect<{ text?: string; fromCache: boolean; failed: boolean }> =>
      Effect.gen(function* () {
        const key = cacheKey(targetLang, source)
        if (!force) {
          const cached = yield* ctx.storage.get(key).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (isCacheEntry(cached) && cached.text) return { text: cached.text, fromCache: true, failed: false }
        }
        const raw = yield* genWithTimeout(buildTranslatePrompt(source, targetLang))
        const text = raw === undefined ? undefined : sanitizeTranslation(raw, source)
        if (text === undefined) return { fromCache: false, failed: true }
        const entry: CacheEntry = { lang: targetLang, source, text, model: modelLabel(), at: Date.now() }
        yield* ctx.storage.set(key, entry as unknown as Schema.Json).pipe(Effect.catch(() => Effect.void))
        return { text, fromCache: false, failed: false }
      })

    // Generated descriptions are cached too, keyed by kind/name/content so a
    // changed skill body invalidates them. `force` retries failed generations.
    const generateDescription = (
      task: Task,
      force: boolean,
    ): Effect.Effect<{ text?: string; fromCache: boolean }> =>
      Effect.gen(function* () {
        const source = `generate:${task.kind}:${task.name}:${task.content ?? ""}`
        const key = cacheKey(targetLang, source)
        if (!force) {
          const cached = yield* ctx.storage.get(key).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (isCacheEntry(cached) && cached.text) return { text: cached.text, fromCache: true }
        }
        const raw = yield* genWithTimeout(
          buildDescribePrompt({ name: task.skillName ?? task.name, content: task.content, targetTag: targetLang }),
        )
        const text = raw === undefined ? undefined : sanitizeTranslation(raw, task.skillName ?? task.name)
        if (text === undefined) return { fromCache: false }
        const entry: CacheEntry = { lang: targetLang, source, text, model: modelLabel(), at: Date.now() }
        yield* ctx.storage.set(key, entry as unknown as Schema.Json).pipe(Effect.catch(() => Effect.void))
        return { text, fromCache: false }
      })

    const sigOf = (m: Map<string, string>) => JSON.stringify([...m.entries()].sort())

    const doRefresh = (force: boolean): Effect.Effect<{ ok: boolean; translated: number; failed: number }, never, Scope.Scope> =>
      Effect.gen(function* () {
        if (!enabled) {
          if (lastApplied && !lastApplied.enabled) return { ok: true, translated: 0, failed: 0 }
          commandTranslations = new Map()
          skillTranslations = new Map()
          agentTranslations = new Map()
          commandGenerated = new Map()
          skillGenerated = new Map()
          agentGenerated = new Map()
          lastStats = { translated: 0, cached: 0, failed: 0 }
          yield* ctx.command.reload()
          yield* ctx.skill.reload()
          yield* ctx.agent.reload()
          lastApplied = { enabled: false, lang: targetLang, sig: "" }
          yield* rpc.events.emit("updated", { language: targetLang, translated: 0, failed: 0 }).pipe(Effect.catch(() => Effect.void))
          return { ok: true, translated: 0, failed: 0 }
        }

        // Late-registered transforms (file commands/skills scanned async) can
        // add items after ours in replay order. When the live registry holds
        // items we never captured, re-register our transforms so they run last,
        // then continue with the complete snapshot.
        const liveCommands = yield* ctx.command.list().pipe(Effect.catch(() => Effect.succeed({ data: [] as ReadonlyArray<{ name: string }> })))
        const liveSkills = yield* ctx.skill.list().pipe(Effect.catch(() => Effect.succeed({ data: [] as ReadonlyArray<{ id: string }> })))
        const liveAgents = yield* ctx.agent.list().pipe(Effect.catch(() => Effect.succeed({ data: [] as ReadonlyArray<{ id: string; hidden?: boolean }> })))
        const missingCommands = config.targets.includes("command") && liveCommands.data.some((c) => !commandOriginals.has(c.name))
        const missingSkills = config.targets.includes("skill") && liveSkills.data.some((s) => !skillOriginals.has(s.id))
        const missingAgents = config.targets.includes("agent") && liveAgents.data.some((a) => !a.hidden && !agentOriginals.has(a.id))
        if (missingCommands) {
          yield* commandReg.dispose
          commandReg = yield* ctx.command.transform(commandTransform)
        }
        if (missingSkills) {
          yield* skillReg.dispose
          skillReg = yield* ctx.skill.transform(skillTransform)
        }
        if (missingAgents) {
          yield* agentReg.dispose
          agentReg = yield* ctx.agent.transform(agentTransform)
        }

        const tasks: Task[] = []
        if (config.targets.includes("command")) {
          for (const [name, def] of commandOriginals) {
            const source = commandSource(name, def.description ?? "")
            if (source) {
              if (!looksLikeTarget(source, targetLang)) tasks.push({ kind: "command", name, source, type: "translate" })
            } else if (config.generateMissing) {
              tasks.push({ kind: "command", name, source: "", type: "generate" })
            }
          }
        }
        if (config.targets.includes("skill")) {
          for (const [id, s] of skillOriginals) {
            const source = skillSource(id, s.name, s.description ?? "")
            if (source) {
              if (!looksLikeTarget(source, targetLang)) tasks.push({ kind: "skill", name: id, source, type: "translate" })
            } else if (config.generateMissing) {
              tasks.push({ kind: "skill", name: id, source: "", type: "generate", content: s.content, skillName: s.name })
            }
          }
        }
        if (config.targets.includes("agent")) {
          for (const [id, a] of agentOriginals) {
            const source = agentSource(id, a.description ?? "")
            if (source) {
              if (!looksLikeTarget(source, targetLang)) tasks.push({ kind: "agent", name: id, source, type: "translate" })
            } else if (config.generateMissing) {
              tasks.push({ kind: "agent", name: id, source: "", type: "generate" })
            }
          }
        }

        pendingCount = tasks.length
        let translated = 0
        let cached = 0
        let failed = 0

        const results = yield* Effect.forEach(
          tasks,
          (task): Effect.Effect<TaskResult> =>
            Effect.gen(function* () {
              if (task.type === "generate") {
                const r = yield* generateDescription(task, force)
                if (r.text === undefined) {
                  failed++
                  return { ...task, text: undefined, fromCache: false }
                }
                if (r.fromCache) cached++
                else translated++
                return { ...task, text: r.text, fromCache: r.fromCache }
              }
              const r = yield* translateText(task.source, force)
              if (r.failed || r.text === undefined) {
                failed++
                return { ...task, text: undefined, fromCache: false }
              }
              if (r.fromCache) cached++
              else translated++
              return { ...task, text: r.text, fromCache: r.fromCache }
            }),
          { concurrency: config.concurrency },
        )
        pendingCount = 0

        const nextCommandTranslations = new Map<string, string>()
        const nextSkillTranslations = new Map<string, string>()
        const nextAgentTranslations = new Map<string, string>()
        const nextCommandGenerated = new Map<string, string>()
        const nextSkillGenerated = new Map<string, string>()
        const nextAgentGenerated = new Map<string, string>()
        for (const r of results) {
          if (r.text === undefined) continue
          if (r.type === "generate") {
            if (r.kind === "command") nextCommandGenerated.set(r.name, r.text)
            else if (r.kind === "skill") nextSkillGenerated.set(r.name, r.text)
            else nextAgentGenerated.set(r.name, r.text)
          } else if (r.kind === "command") nextCommandTranslations.set(r.source, r.text)
          else if (r.kind === "skill") nextSkillTranslations.set(r.source, r.text)
          else nextAgentTranslations.set(r.source, r.text)
        }

        lastStats = { translated, cached, failed }
        const sig = [
          sigOf(nextCommandTranslations),
          sigOf(nextSkillTranslations),
          sigOf(nextAgentTranslations),
          sigOf(nextCommandGenerated),
          sigOf(nextSkillGenerated),
          sigOf(nextAgentGenerated),
        ].join("|")
        // Nothing changed since the last apply: skip the reload so we do not
        // emit change events that would schedule yet another refresh.
        if (lastApplied?.enabled && lastApplied.lang === targetLang && lastApplied.sig === sig) {
          return { ok: true, translated, failed }
        }

        commandTranslations = nextCommandTranslations
        skillTranslations = nextSkillTranslations
        agentTranslations = nextAgentTranslations
        commandGenerated = nextCommandGenerated
        skillGenerated = nextSkillGenerated
        agentGenerated = nextAgentGenerated
        yield* ctx.command.reload()
        yield* ctx.skill.reload()
        yield* ctx.agent.reload()
        lastApplied = { enabled: true, lang: targetLang, sig }
        yield* rpc.events.emit("updated", { language: targetLang, translated, failed }).pipe(Effect.catch(() => Effect.void))
        return { ok: true, translated, failed }
      })

    const refresh = (force: boolean) =>
      Effect.gen(function* () {
        if (refreshing) return { ok: false, translated: 0, failed: 0 }
        refreshing = true
        return yield* doRefresh(force).pipe(
          Effect.catchCause(() => Effect.succeed({ ok: false, translated: 0, failed: 0 })),
          Effect.ensuring(Effect.sync(() => (refreshing = false))),
        )
      })

    // Refresh with the plugin scope provided, for call sites that have none
    // (RPC handlers, event fibers).
    const refreshIn = (force: boolean) => refresh(force).pipe(Effect.provideService(Scope.Scope, scope))

    // ---- RPC control surface ----

    const countTranslated = (): number => {
      let n = 0
      for (const [name, def] of commandOriginals) {
        const d = commandDesired(name, def.description ?? "")
        if (d && d !== (def.description ?? "")) n++
      }
      for (const [id, s] of skillOriginals) {
        const d = skillDesired(id, s.name, s.description)
        if (d && d !== s.description) n++
      }
      for (const [id, a] of agentOriginals) {
        const d = agentDesired(id, a.description)
        if (d && d !== a.description) n++
      }
      return n
    }

    const rpc = yield* ctx.rpc
      .register(TranslationRpc, {
        status: () =>
          Effect.sync((): StatusResult => ({
            enabled,
            language: targetLang,
            detectedLanguage,
            model: modelLabel(),
            commands: commandOriginals.size,
            skills: skillOriginals.size,
            agents: agentOriginals.size,
            translated: countTranslated(),
            cached: lastStats.cached,
            failed: lastStats.failed,
            pending: pendingCount,
          })),
        refresh: (input) => refreshIn(Boolean((input as { force?: boolean }).force)),
        setLanguage: (input) =>
          Effect.gen(function* () {
            const value = (input as { language: string | null }).language
            settings.language = typeof value === "string" && value.trim() ? value.trim() : undefined
            targetLang = resolveLanguage(settings.language ?? config.language)
            yield* persistSettings()
            yield* refreshIn(false)
            return { language: targetLang }
          }),
        setModel: (input) =>
          Effect.gen(function* () {
            const value = (input as { model: string | null }).model
            settings.model = typeof value === "string" ? parseModel(value) : undefined
            model = settings.model ?? config.model
            yield* persistSettings()
            yield* refreshIn(true)
            return { model: modelLabel() }
          }),
        setEnabled: (input) =>
          Effect.gen(function* () {
            enabled = Boolean((input as { enabled: boolean }).enabled)
            settings.enabled = enabled
            yield* persistSettings()
            yield* refreshIn(false)
            return { enabled }
          }),
        clearCache: () =>
          Effect.gen(function* () {
            let removed = 0
            let after: string | undefined
            do {
              const page = yield* ctx.storage
                .scan({ prefix: CACHE_PREFIX, after, limit: 200 })
                .pipe(Effect.catch(() => Effect.succeed({ entries: [] as ReadonlyArray<{ key: string }>, next: undefined })))
              for (const entry of page.entries) {
                yield* ctx.storage.remove(entry.key).pipe(Effect.catch(() => Effect.void))
                removed++
              }
              after = page.next
            } while (after)
            return { removed }
          }),
        list: () =>
          Effect.sync(() => {
            const items: ListItem[] = []
            for (const [name, def] of commandOriginals) {
              const original = def.description ?? ""
              const desired = commandDesired(name, original)
              const override = overrides.get(overrideKey("command", name))
              items.push({
                kind: "command",
                key: name,
                name,
                original,
                translated: desired,
                state: desired && desired !== original ? "translated" : "original",
                ...(override !== undefined ? { override } : {}),
              })
            }
            for (const [id, s] of skillOriginals) {
              const desired = skillDesired(id, s.name, s.description)
              const override = overrides.get(overrideKey("skill", id)) ?? overrides.get(overrideKey("skill", s.name))
              items.push({
                kind: "skill",
                key: id,
                name: s.name || id,
                original: s.description,
                translated: desired,
                state: desired && desired !== s.description ? "translated" : "original",
                ...(override !== undefined ? { override } : {}),
              })
            }
            for (const [id, a] of agentOriginals) {
              const desired = agentDesired(id, a.description)
              const override = overrides.get(overrideKey("agent", id))
              items.push({
                kind: "agent",
                key: id,
                name: a.name || id,
                original: a.description,
                translated: desired,
                state: desired && desired !== a.description ? "translated" : "original",
                ...(override !== undefined ? { override } : {}),
              })
            }
            return { items }
          }),
        setDescription: (input) =>
          Effect.gen(function* () {
            const { kind, key, description } = input as { kind: unknown; key: unknown; description: unknown }
            if (!isOverrideKind(kind) || typeof key !== "string" || !key.trim()) return { ok: false }
            const mapKey = overrideKey(kind, key.trim())
            if (typeof description === "string" && description.trim()) overrides.set(mapKey, description.trim())
            else overrides.delete(mapKey)
            yield* persistOverrides()
            yield* refreshIn(false)
            return { ok: true }
          }),
        getOverrides: () => Effect.sync(() => ({ overrides: serializeOverrides(overrides) })),
        translate: (input) =>
          Effect.gen(function* () {
            const value = (input as { text?: unknown }).text
            const text = typeof value === "string" ? value : ""
            if (!enabled || !text.trim() || looksLikeTarget(text, targetLang)) return { text, changed: false }
            const r = yield* translateText(text, false)
            if (r.failed || r.text === undefined) return { text, changed: false }
            return { text: r.text, changed: r.text !== text }
          }),
      })
      .pipe(Effect.orDie)

    // ---- refresh on change ----

    let refreshScheduled = false
    const scheduleRefresh = () =>
      Effect.gen(function* () {
        if (!enabled || refreshScheduled) return
        refreshScheduled = true
        yield* Effect.sleep(300)
        refreshScheduled = false
        yield* refreshIn(false)
      })

    if (config.refreshOnEvents) {
      yield* ctx.event
        .subscribe({ types: ["command.updated", "skill.updated", "agent.updated", "config.updated"] })
        .pipe(
          Stream.runForEach(() => scheduleRefresh()),
          Effect.catchCause(() => Effect.void),
          Effect.forkScoped({ startImmediately: true }),
        )
    }

    // Initial pass once boot has built the registries (boot also emits the
    // events above; this is a backup in case they were missed).
    yield* Effect.sleep(500).pipe(
      Effect.flatMap(() => refreshIn(false)),
      Effect.asVoid,
      Effect.catchCause(() => Effect.void),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* Effect.void
  }),
})