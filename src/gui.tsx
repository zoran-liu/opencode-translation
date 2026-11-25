import { Plugin, Command, SettingsPage } from "@opencode/plugin/gui"
import { createSignal, For, onCleanup, Show } from "solid-js"
import { TranslationRpc, type StatusResult, type ListItem } from "./rpc.js"

/**
 * GUI part (desktop app). Contributes a settings page and a palette command
 * that drive the server part through its RPC. The translated descriptions
 * themselves come from the server registry, so the GUI's slash menu and skill
 * list are localized without any client-side interception.
 */

export default Plugin.define({
  i18n: {
    en: {
      title: "Translation",
      openSettings: "Translation settings",
      pageDesc: "Translate command, skill and agent descriptions with a local model. Failed translations keep the original text.",
      general: "General",
      enabled: "Enable translation",
      enabledDesc: "Translate command, skill and agent descriptions in the TUI and GUI.",
      language: "Target language",
      languageDesc: "Auto follows the environment language (LANG / LC_ALL).",
      auto: "Auto (environment)",
      model: "Translation model",
      modelDesc: "provider/model, e.g. opencode/deepseek-v4.1-flash-free. Empty uses the default free model.",
      apply: "Apply",
      actions: "Maintenance",
      refresh: "Refresh",
      forceRefresh: "Force refresh",
      forceRefreshDesc: "Re-translate everything, retrying entries that previously failed.",
      clearCache: "Clear cache",
      clearCacheDesc: "Drop all cached translations; the next refresh translates again.",
      statusTitle: "Status",
      items: "Descriptions",
      translated: "translated",
      original: "original",
      error: "Request failed",
      commands: "commands",
      skills: "skills",
      agents: "agents",
      cached: "cached",
      failed: "failed",
      pending: "pending",
      edit: "Edit",
      save: "Save",
      cancel: "Cancel",
      emptyDesc: "(no description)",
      overrideBadge: "manual",
    },
    zh: {
      title: "描述翻译",
      openSettings: "翻译设置",
      pageDesc: "使用本地模型翻译命令、技能与智能体描述。翻译失败时保留原文。",
      general: "常规",
      enabled: "启用翻译",
      enabledDesc: "在 TUI 和 GUI 中翻译命令、技能与智能体描述。",
      language: "目标语言",
      languageDesc: "自动跟随环境语言（LANG / LC_ALL）。",
      auto: "自动（跟随环境）",
      model: "翻译模型",
      modelDesc: "provider/model，例如 opencode/deepseek-v4.1-flash-free。留空使用默认免费模型。",
      apply: "应用",
      actions: "维护",
      refresh: "刷新",
      forceRefresh: "强制刷新",
      forceRefreshDesc: "重新翻译全部内容，并重试之前失败的条目。",
      clearCache: "清空缓存",
      clearCacheDesc: "删除所有已缓存的翻译；下次刷新将重新翻译。",
      statusTitle: "状态",
      items: "描述列表",
      translated: "已翻译",
      original: "原文",
      error: "请求失败",
      commands: "命令",
      skills: "技能",
      agents: "智能体",
      cached: "缓存命中",
      failed: "失败",
      pending: "进行中",
      edit: "编辑",
      save: "保存",
      cancel: "取消",
      emptyDesc: "（无描述）",
      overrideBadge: "手动",
    },
  },
  setup(ctx) {
    // Read the client where it is called: a restarted server gets a new one.
    const rpc = () => ctx.client.rpc(TranslationRpc)

    const [status, setStatus] = createSignal<StatusResult | undefined>(undefined)
    const [items, setItems] = createSignal<ListItem[]>([])
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal<string | undefined>(undefined)
    const [modelInput, setModelInput] = createSignal("")
    const [editingKey, setEditingKey] = createSignal<string | undefined>(undefined)

    const load = async () => {
      try {
        const s = (await rpc().status({})) as StatusResult
        if (ctx.signal.aborted) return
        setStatus(s)
        setModelInput(s.model && s.model !== "(default)" ? s.model : "")
        const l = (await rpc().list({})) as { items?: ListItem[] }
        if (ctx.signal.aborted) return
        setItems((l.items ?? []) as ListItem[])
        setError(undefined)
      } catch (e) {
        if (!ctx.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      }
    }

    const act = async (fn: () => Promise<unknown>) => {
      if (busy()) return
      setBusy(true)
      setError(undefined)
      try {
        await fn()
        if (!ctx.signal.aborted) await load()
      } catch (e) {
        if (!ctx.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!ctx.signal.aborted) setBusy(false)
      }
    }

    const saveDescription = async (item: ListItem, value: string) => {
      await act(() => rpc().setDescription({ kind: item.kind, key: item.key, description: value.trim() || null }))
      if (!error()) setEditingKey(undefined)
    }

    void load()
    const off = rpc().events.on("updated", () => {
      void load()
    })
    onCleanup(off)

    ctx.add(Command, () => ({
      id: "settings",
      title: ctx.t("openSettings"),
      group: ctx.t("title"),
      keywords: "translate language i18n 翻译 语言 描述",
      run: () => ctx.layout.settings(ctx.id),
    }))

    const languageOptions = () => {
      const options = [
        { value: "auto", label: ctx.t("auto") },
        { value: "en", label: "English" },
        { value: "zh-cn", label: "简体中文" },
        { value: "zh-tw", label: "繁體中文" },
        { value: "ja", label: "日本語" },
        { value: "ko", label: "한국어" },
        { value: "fr", label: "Français" },
        { value: "de", label: "Deutsch" },
        { value: "es", label: "Español" },
        { value: "pt", label: "Português" },
        { value: "ru", label: "Русский" },
      ]
      const current = status()?.language
      if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: current })
      return options
    }

    const statusText = () => {
      const s = status()
      if (!s) return "…"
      return [
        `${ctx.t("commands")}: ${s.commands}`,
        `${ctx.t("skills")}: ${s.skills}`,
        `${ctx.t("agents")}: ${s.agents}`,
        `${ctx.t("translated")}: ${s.translated}`,
        `${ctx.t("cached")}: ${s.cached}`,
        `${ctx.t("failed")}: ${s.failed}`,
        `${ctx.t("pending")}: ${s.pending}`,
      ].join(" · ")
    }

    ctx.add(SettingsPage, () => ({
      id: ctx.id,
      title: ctx.t("title"),
      entries: [
        { id: ctx.id, title: ctx.t("title"), description: ctx.t("pageDesc"), keywords: "translate language i18n 翻译 语言 描述" },
        { id: "enabled", title: ctx.t("enabled") },
        { id: "language", title: ctx.t("language") },
        { id: "model", title: ctx.t("model") },
        { id: "refresh", title: ctx.t("forceRefresh") },
        { id: "clearCache", title: ctx.t("clearCache") },
      ],
      render: () => (
        <ctx.ui.SettingsLayout
          title={ctx.t("title")}
          description={ctx.t("pageDesc")}
          actions={
            <ctx.ui.Button size="small" busy={busy()} onClick={() => void act(() => rpc().refresh({}))}>
              {ctx.t("refresh")}
            </ctx.ui.Button>
          }
        >
          <ctx.ui.SettingsSection title={ctx.t("general")}>
            <ctx.ui.SettingsRow id="enabled" title={ctx.t("enabled")} description={ctx.t("enabledDesc")}>
              <ctx.ui.Switch
                label={ctx.t("enabled")}
                hideLabel
                checked={status()?.enabled ?? true}
                disabled={busy()}
                onChange={(v) => void act(() => rpc().setEnabled({ enabled: v }))}
              />
            </ctx.ui.SettingsRow>
            <ctx.ui.SettingsRow id="language" title={ctx.t("language")} description={ctx.t("languageDesc")}>
              <ctx.ui.Select
                label={ctx.t("language")}
                options={languageOptions()}
                value={status()?.language}
                disabled={busy()}
                onChange={(v) => void act(() => rpc().setLanguage({ language: v === "auto" ? null : v }))}
              />
            </ctx.ui.SettingsRow>
            <ctx.ui.SettingsRow id="model" title={ctx.t("model")} description={ctx.t("modelDesc")}>
              <>
                <ctx.ui.TextInput
                  label={ctx.t("model")}
                  value={modelInput()}
                  onInput={setModelInput}
                  placeholder="opencode/deepseek-v4.1-flash-free"
                  disabled={busy()}
                  onSubmit={(v) => void act(() => rpc().setModel({ model: v.trim() || null }))}
                />
                <ctx.ui.Button
                  size="small"
                  disabled={busy()}
                  onClick={() => void act(() => rpc().setModel({ model: modelInput().trim() || null }))}
                >
                  {ctx.t("apply")}
                </ctx.ui.Button>
              </>
            </ctx.ui.SettingsRow>
          </ctx.ui.SettingsSection>

          <ctx.ui.SettingsSection title={ctx.t("actions")}>
            <ctx.ui.SettingsRow id="refresh" title={ctx.t("forceRefresh")} description={ctx.t("forceRefreshDesc")}>
              <ctx.ui.Button size="small" busy={busy()} onClick={() => void act(() => rpc().refresh({ force: true }))}>
                {ctx.t("refresh")}
              </ctx.ui.Button>
            </ctx.ui.SettingsRow>
            <ctx.ui.SettingsRow id="clearCache" title={ctx.t("clearCache")} description={ctx.t("clearCacheDesc")}>
              <ctx.ui.Button size="small" variant="danger" disabled={busy()} onClick={() => void act(() => rpc().clearCache({}))}>
                {ctx.t("clearCache")}
              </ctx.ui.Button>
            </ctx.ui.SettingsRow>
            <ctx.ui.SettingsRow title={ctx.t("statusTitle")} description={statusText()} />
          </ctx.ui.SettingsSection>

          <Show when={error()}>
            <ctx.ui.SettingsSection title={ctx.t("error")}>
              <ctx.ui.SettingsRow title={error()!} />
            </ctx.ui.SettingsSection>
          </Show>

          <ctx.ui.SettingsSection title={ctx.t("items")}>
            <For each={items()}>
              {(item) => {
                const key = `${item.kind}:${item.key}`
                const editing = () => editingKey() === key
                const [draft, setDraft] = createSignal("")
                const icon =
                  item.kind === "command" ? "/" : item.kind === "skill" ? "✦ " : item.kind === "agent" ? "◈ " : ""
                const description = () =>
                  item.original && item.translated && item.translated !== item.original
                    ? `${item.original} → ${item.translated}`
                    : item.translated || item.original || ctx.t("emptyDesc")
                return (
                  <ctx.ui.SettingsRow title={`${icon}${item.name}`} description={description()}>
                    <Show
                      when={editing()}
                      fallback={
                        <>
                          <Show when={item.override}>
                            <span>{ctx.t("overrideBadge")}</span>
                          </Show>
                          <span>{item.state === "translated" ? ctx.t("translated") : ctx.t("original")}</span>
                          <ctx.ui.Button
                            size="small"
                            disabled={busy()}
                            onClick={() => {
                              setDraft(item.override ?? item.translated ?? item.original)
                              setEditingKey(key)
                            }}
                          >
                            {ctx.t("edit")}
                          </ctx.ui.Button>
                        </>
                      }
                    >
                      <>
                        <ctx.ui.TextInput
                          label={ctx.t("edit")}
                          value={draft()}
                          onInput={setDraft}
                          onSubmit={(v) => void saveDescription(item, v)}
                          disabled={busy()}
                        />
                        <ctx.ui.Button
                          size="small"
                          disabled={busy()}
                          onClick={() => void saveDescription(item, draft())}
                        >
                          {ctx.t("save")}
                        </ctx.ui.Button>
                        <ctx.ui.Button
                          size="small"
                          variant="ghost"
                          disabled={busy()}
                          onClick={() => setEditingKey(undefined)}
                        >
                          {ctx.t("cancel")}
                        </ctx.ui.Button>
                      </>
                    </Show>
                  </ctx.ui.SettingsRow>
                )
              }}
            </For>
          </ctx.ui.SettingsSection>
        </ctx.ui.SettingsLayout>
      ),
    }))
  },
})
