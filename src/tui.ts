import { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import { createEffect, createRoot, createSignal, untrack } from "solid-js"
import { TranslationRpc, type ItemKind, type ListItem, type RefreshResult, type StatusResult } from "./rpc.js"
import { looksLikeTarget } from "./core/language.js"
import { buildShadowCommand, isOwnCommand, isShadowCommand, selectShadowTargets, shadowSignature } from "./tui/shadow.js"

/**
 * TUI part. Adds command-palette entries that drive the server part through its
 * RPC: refresh, language, model, enable/disable, cache, status and manual
 * description editing. Server-side descriptions (commands, skills, agents) are
 * already localized by the server transforms; this part additionally translates
 * TUI-local keymap commands (built-in TUI commands and other plugins' palette
 * entries) by shadowing them — see src/tui/shadow.ts for the mechanism.
 */

type Labels = Record<string, string | ((...args: any[]) => string)>

const en: Labels = {
  menuTitle: "Translation",
  menuDescription: "Command, skill & agent description translation",
  refresh: "Refresh translations",
  forceRefresh: "Force refresh (retry failed)",
  language: "Language",
  model: "Model",
  enabled: "Enabled",
  on: "on",
  off: "off",
  clearCache: "Clear translation cache",
  status: "Show status",
  auto: "Auto (environment)",
  custom: "Custom…",
  languageTitle: "Target language",
  modelTitle: "Translation model",
  modelDescription: "provider/model — leave empty for the default free model (opencode/deepseek-v4.1-flash-free)",
  clearConfirm: "Remove all cached translations?",
  unreachable: "Translation plugin server is not reachable",
  busy: "A refresh is already running",
  refreshed: (n: number, f: number) => `Translated ${n}, failed ${f}`,
  removed: (n: number) => `Removed ${n} cached translations`,
  languageSet: (lang: string) => `Language: ${lang}`,
  modelSet: (model: string) => `Model: ${model}`,
  toggled: (on: boolean) => `Translation ${on ? "enabled" : "disabled"}`,
  failed: "Translation request failed",
  edit: "Edit description",
  editTitle: "Edit description",
  editPlaceholder: "Pick a command, skill, agent or TUI command",
  editPromptTitle: "Description",
  editPromptDesc: "Manual text wins over the original and is translated too. Leave empty to clear it.",
  emptyDesc: "(no description)",
  saved: "Description saved",
  agents: "agents",
  paletteMenu: "Translation: menu",
  paletteMenuDesc: "Command, skill & agent description translation settings",
  paletteRefresh: "Translation: refresh",
  paletteRefreshDesc: "Re-translate command, skill and agent descriptions",
  paletteEdit: "Translation: edit description",
  paletteEditDesc: "Set a manual description for a command, skill, agent or TUI command",
}

const zh: Labels = {
  menuTitle: "描述翻译",
  menuDescription: "命令、技能与智能体描述翻译",
  refresh: "刷新翻译",
  forceRefresh: "强制刷新（重试失败项）",
  language: "语言",
  model: "模型",
  enabled: "启用",
  on: "开",
  off: "关",
  clearCache: "清空翻译缓存",
  status: "查看状态",
  auto: "自动（跟随环境）",
  custom: "自定义…",
  languageTitle: "目标语言",
  modelTitle: "翻译模型",
  modelDescription: "provider/model —— 留空使用默认免费模型（opencode/deepseek-v4.1-flash-free）",
  clearConfirm: "删除所有已缓存的翻译？",
  unreachable: "无法连接翻译插件服务端",
  busy: "已有刷新任务在进行中",
  refreshed: (n: number, f: number) => `已翻译 ${n} 项，失败 ${f} 项`,
  removed: (n: number) => `已删除 ${n} 条缓存翻译`,
  languageSet: (lang: string) => `语言：${lang}`,
  modelSet: (model: string) => `模型：${model}`,
  toggled: (on: boolean) => `翻译已${on ? "启用" : "停用"}`,
  failed: "翻译请求失败",
  edit: "编辑描述",
  editTitle: "编辑描述",
  editPlaceholder: "选择命令、技能、智能体或 TUI 命令",
  editPromptTitle: "描述",
  editPromptDesc: "手动描述优先于原文，同样会被翻译。留空则清除。",
  emptyDesc: "（无描述）",
  saved: "描述已保存",
  agents: "智能体",
  paletteMenu: "翻译：菜单",
  paletteMenuDesc: "命令、技能与智能体描述翻译设置",
  paletteRefresh: "翻译：刷新",
  paletteRefreshDesc: "重新翻译命令、技能与智能体描述",
  paletteEdit: "翻译：编辑描述",
  paletteEditDesc: "为命令、技能、智能体或 TUI 命令设置手动描述",
}

const COMMON_LANGUAGES = [
  { value: "en", title: "English" },
  { value: "zh-cn", title: "简体中文" },
  { value: "zh-tw", title: "繁體中文" },
  { value: "ja", title: "日本語" },
  { value: "ko", title: "한국어" },
  { value: "fr", title: "Français" },
  { value: "de", title: "Deutsch" },
  { value: "es", title: "Español" },
  { value: "pt", title: "Português" },
  { value: "ru", title: "Русский" },
]

const OWN_PREFIX = "opencode-translation."

const KIND_ICON: Record<ItemKind, string> = {
  command: "/",
  skill: "✦ ",
  agent: "◈ ",
  tui: "⌨ ",
}

interface EditTarget {
  kind: ItemKind
  key: string
  name: string
  current: string
}

export default Plugin.define({
  id: "opencode-translation",
  setup(context) {
    const rpc = () => context.client.rpc(TranslationRpc)
    let labels: Labels = en
    const [lang, setLang] = createSignal<"en" | "zh">("en")
    const t = (key: string): string => {
      const value = labels[key] ?? en[key]
      return typeof value === "string" ? value : key
    }
    const fmt = (key: string, ...args: unknown[]): string => {
      const value = labels[key] ?? en[key]
      return typeof value === "function" ? value(...args) : key
    }

    const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
      context.ui.toast.show({ message, variant })

    const getStatus = async (): Promise<StatusResult | undefined> => {
      try {
        const status = (await rpc().status({})) as StatusResult
        labels = status.language.startsWith("zh") ? zh : en
        setLang(status.language.startsWith("zh") ? "zh" : "en")
        return status
      } catch {
        toast(t("unreachable"), "error")
        return undefined
      }
    }

    const runRefresh = async (force: boolean) => {
      try {
        const result = (await rpc().refresh({ force })) as RefreshResult
        if (!result.ok) {
          toast(t("busy"), "warning")
          return
        }
        toast(fmt("refreshed", result.translated, result.failed), "success")
      } catch {
        toast(t("failed"), "error")
      }
    }

    const chooseLanguage = async (status: StatusResult) => {
      const options = [
        { title: t("auto"), value: "auto", description: status.detectedLanguage },
        ...COMMON_LANGUAGES.map((l) => ({ ...l, value: l.value as string })),
        { title: t("custom"), value: "custom" },
      ]
      if (!options.some((o) => o.value === status.language)) {
        options.splice(options.length - 1, 0, { title: status.language, value: status.language })
      }
      const choice = await context.ui.dialog.select({
        title: t("languageTitle"),
        options,
        current: status.language,
      })
      if (!choice) return
      let language: string | null = choice
      if (choice === "auto") language = null
      if (choice === "custom") {
        const input = await context.ui.dialog.prompt({
          title: t("languageTitle"),
          placeholder: "e.g. zh-cn, ja, fr",
        })
        if (!input) return
        language = input.trim()
      }
      try {
        const result = (await rpc().setLanguage({ language })) as { language: string }
        toast(fmt("languageSet", result.language), "success")
      } catch {
        toast(t("failed"), "error")
      }
    }

    const chooseModel = async (status: StatusResult) => {
      const input = await context.ui.dialog.prompt({
        title: t("modelTitle"),
        description: t("modelDescription"),
        placeholder: "opencode/deepseek-v4.1-flash-free",
        value: status.model && status.model !== "(default)" ? status.model : "",
      })
      if (input === undefined) return
      try {
        const result = (await rpc().setModel({ model: input.trim() || null })) as { model: string }
        toast(fmt("modelSet", result.model), "success")
      } catch {
        toast(t("failed"), "error")
      }
    }

    // ---- TUI-local command translation (experimental, graceful degradation) ----

    const cleanups: Array<() => void> = []
    let rescan: () => Promise<void> = async () => {}

    if (context.options?.tuiCommands !== false) {
      const [shadows, setShadows] = createSignal<readonly KeymapCommand[]>([])
      const [observing, setObserving] = createSignal(false)
      const [active, setActive] = createSignal(false)

      // keymap.layer resolves the Keymap provider through Solid context, so it
      // must be called in setup context — calling it inside a nested
      // createRoot detaches the context and setup fails ("Keymap.Provider is
      // missing"). The factory may read signals; the host re-runs it
      // reactively (useBindings).
      context.keymap.layer(() => ({
        mode: "global",
        priority: 1,
        enabled: () => active() && !observing(),
        commands: observing() ? [] : shadows(),
      }))

      createRoot((dispose) => {
        cleanups.push(dispose)
        let rescanning = false
        let lastFail = 0
        let lastSig = ""
        let snapshotIds = new Set<string>()
        let shadowedIds = new Set<string>()

        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

        rescan = async () => {
          if (rescanning || Date.now() - lastFail < 5000) return
          rescanning = true
          try {
            const status = (await rpc().status({})) as StatusResult
            labels = status.language.startsWith("zh") ? zh : en
            setLang(status.language.startsWith("zh") ? "zh" : "en")
            if (!status.enabled) {
              setActive(false)
              setShadows([])
              snapshotIds = new Set()
              shadowedIds = new Set()
              lastSig = ""
              return
            }
            setActive(true)
            // Observation window: disable the shadow layer, wait until the
            // reachable command list shows the originals again, snapshot it.
            setObserving(true)
            let originals: readonly KeymapCommand[] | undefined
            for (let i = 0; i < 30; i++) {
              await sleep(40)
              const cmds = context.keymap.commands()
              if (!cmds.some(isShadowCommand)) {
                originals = cmds
                break
              }
            }
            if (!originals) {
              // Layer did not deactivate in time; keep the previous shadows.
              setObserving(false)
              return
            }
            const overrides =
              ((await rpc().getOverrides({})) as { overrides?: Record<string, string> }).overrides ?? {}
            const targets = selectShadowTargets(originals, OWN_PREFIX, status.language)
            const texts = new Set<string>()
            for (const command of targets) {
              const override = overrides[`tui:${command.id}`]
              for (const text of [command.title, override ?? command.description]) {
                if (text && text.trim() && !looksLikeTarget(text, status.language)) texts.add(text)
              }
            }
            const translated = new Map<string, string>()
            await Promise.all(
              [...texts].map(async (text) => {
                try {
                  const r = (await rpc().translate({ text })) as { text: string }
                  translated.set(text, r.text)
                } catch {
                  // Keep the original text for this entry.
                }
              }),
            )
            const next = targets.map((command) => {
              const override = overrides[`tui:${command.id}`]
              const title = command.title ? (translated.get(command.title) ?? command.title) : undefined
              const descSource = override ?? command.description
              const description = descSource ? (translated.get(descSource) ?? descSource) : undefined
              return buildShadowCommand(command, title, description)
            })
            const sig = shadowSignature(next)
            if (sig !== lastSig) {
              setShadows(next)
              lastSig = sig
            }
            snapshotIds = new Set(
              originals.filter((c) => c.id && !isOwnCommand(c, OWN_PREFIX)).map((c) => c.id!),
            )
            shadowedIds = new Set(next.map((c) => c.id!))
            setObserving(false)
          } catch {
            lastFail = Date.now()
            setObserving(false)
          } finally {
            rescanning = false
          }
        }

        // Initial pass once the host boot settles.
        const initial = setTimeout(() => void rescan(), 1500)
        cleanups.push(() => clearTimeout(initial))
        // Backup sweep: catches route-scoped layers being disposed and dynamic
        // titles that change while shadowed.
        const interval = setInterval(() => void rescan(), 8000)
        cleanups.push(() => clearInterval(interval))
        // Route changes register/dispose route-scoped command layers.
        createEffect(() => {
          context.ui.router.current()
          void untrack(() => rescan())
        })
        // Language / enabled changes from the server part.
        try {
          const off = rpc().events.on("updated", () => void rescan())
          cleanups.push(off)
        } catch {
          // Event subscription unavailable; the interval still covers changes.
        }
        // Foreign commands appearing (other plugins registering late).
        createEffect(() => {
          const cmds = context.keymap.commands()
          if (observing()) return
          const foreign = new Set(
            cmds.filter((c) => c.id && !isShadowCommand(c) && !isOwnCommand(c, OWN_PREFIX)).map((c) => c.id!),
          )
          const expected = new Set([...snapshotIds].filter((id) => !shadowedIds.has(id)))
          if (foreign.size !== expected.size || [...foreign].some((id) => !expected.has(id))) {
            void untrack(() => rescan())
          }
        })
      })
    }

    // ---- manual description editing ----

    const editDescription = async () => {
      const status = await getStatus()
      if (!status) return
      let items: ListItem[] = []
      try {
        items = ((await rpc().list({})) as { items?: ListItem[] }).items ?? []
      } catch {
        toast(t("failed"), "error")
        return
      }
      const targets: EditTarget[] = items.map((item) => ({
        kind: item.kind,
        key: item.key,
        name: item.name,
        current: item.override ?? (item.translated || item.original),
      }))
      // TUI-local commands: both unshadowed originals and our shadow entries
      // (which mask the originals while active).
      for (const command of context.keymap.commands()) {
        if (!command.id || isOwnCommand(command, OWN_PREFIX)) continue
        if (targets.some((target) => target.kind === "tui" && target.key === command.id)) continue
        targets.push({
          kind: "tui",
          key: command.id,
          name: command.title ?? command.id,
          current: command.description ?? "",
        })
      }
      const choice = await context.ui.dialog.select<EditTarget>({
        title: t("editTitle"),
        placeholder: t("editPlaceholder"),
        options: targets.map((target) => ({
          title: `${KIND_ICON[target.kind]}${target.name}`,
          value: target,
          description: target.current || t("emptyDesc"),
        })),
      })
      if (!choice) return
      const input = await context.ui.dialog.prompt({
        title: `${t("editPromptTitle")}: ${choice.name}`,
        description: t("editPromptDesc"),
        value: choice.current,
      })
      if (input === undefined) return
      try {
        await rpc().setDescription({ kind: choice.kind, key: choice.key, description: input.trim() || null })
        toast(t("saved"), "success")
        if (choice.kind === "tui") void rescan()
      } catch {
        toast(t("failed"), "error")
      }
    }

    // ---- menu ----

    const openMenu = async () => {
      const status = await getStatus()
      if (!status) return
      const choice = await context.ui.dialog.select({
        title: t("menuTitle"),
        placeholder: t("menuDescription"),
        options: [
          {
            title: t("refresh"),
            value: "refresh",
            description: `${status.translated}/${status.commands + status.skills + status.agents}`,
          },
          { title: t("forceRefresh"), value: "force" },
          { title: t("edit"), value: "edit" },
          { title: `${t("language")}: ${status.language}`, value: "language" },
          { title: `${t("model")}: ${status.model ?? "(default)"}`, value: "model" },
          { title: `${t("enabled")}: ${status.enabled ? t("on") : t("off")}`, value: "toggle" },
          { title: t("clearCache"), value: "clear" },
          { title: t("status"), value: "status" },
        ],
      })
      if (!choice) return
      switch (choice) {
        case "refresh":
          await runRefresh(false)
          break
        case "force":
          await runRefresh(true)
          break
        case "edit":
          await editDescription()
          break
        case "language":
          await chooseLanguage(status)
          break
        case "model":
          await chooseModel(status)
          break
        case "toggle":
          try {
            const result = (await rpc().setEnabled({ enabled: !status.enabled })) as { enabled: boolean }
            toast(fmt("toggled", result.enabled), "success")
          } catch {
            toast(t("failed"), "error")
          }
          break
        case "clear": {
          const confirmed = await context.ui.dialog.confirm({ title: t("clearCache"), message: t("clearConfirm") })
          if (!confirmed) break
          try {
            const result = (await rpc().clearCache({})) as { removed: number }
            toast(fmt("removed", result.removed), "success")
          } catch {
            toast(t("failed"), "error")
          }
          break
        }
        case "status":
          await context.ui.dialog.alert({
            title: t("status"),
            message: [
              `${t("enabled")}: ${status.enabled ? t("on") : t("off")}`,
              `${t("language")}: ${status.language} (auto: ${status.detectedLanguage ?? "?"})`,
              `${t("model")}: ${status.model ?? "(default)"}`,
              `commands: ${status.commands}, skills: ${status.skills}, ${t("agents")}: ${status.agents}`,
              `translated: ${status.translated}, cached: ${status.cached}, failed: ${status.failed}, pending: ${status.pending}`,
            ].join("\n"),
          })
          break
      }
    }

    context.keymap.layer(() => {
      const localized = lang() === "zh" ? zh : en
      const tt = (key: string): string => {
        const value = localized[key] ?? en[key]
        return typeof value === "string" ? value : key
      }
      return {
        // Dialogs (including the command palette) push "modal" mode, which
        // deactivates base-mode layers — palette entries must be global.
        mode: "global",
        commands: [
          {
            id: "opencode-translation.menu",
            title: tt("paletteMenu"),
            description: tt("paletteMenuDesc"),
            group: tt("menuTitle"),
            palette: true,
            run: () => {
              void openMenu()
            },
          },
          {
            id: "opencode-translation.refresh",
            title: tt("paletteRefresh"),
            description: tt("paletteRefreshDesc"),
            group: tt("menuTitle"),
            palette: true,
            run: () => {
              void runRefresh(false)
            },
          },
          {
            id: "opencode-translation.edit",
            title: tt("paletteEdit"),
            description: tt("paletteEditDesc"),
            group: tt("menuTitle"),
            palette: true,
            run: () => {
              void editDescription()
            },
          },
        ],
      }
    })

    return () => {
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          cleanup()
        } catch {
          // Best-effort cleanup.
        }
      }
    }
  },
})