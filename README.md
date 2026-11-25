# opencode-translation

OpenCode V2 plugin that translates **command, skill and agent (subagent)
descriptions** with a local model — in both the **TUI** and the **GUI
(desktop app)**. TUI-local palette commands (built-in TUI commands and other
plugins' entries) are translated too, experimentally.

- Replaces the descriptions shown in slash completion, the command palette,
  skill lists and the agent picker; can also **add** descriptions (manual
  overrides, or model-generated for items that have none).
- **Empty descriptions are editable**: set a manual description from the TUI
  or the GUI for any command, skill, agent or TUI command; it is persisted,
  wins over the original, and is translated like any other text.
- Target language follows the **environment** (`LC_ALL` / `LC_MESSAGES` /
  `LANG` / `LANGUAGE`, then the runtime locale) or an explicit setting.
- Translations are **cached by content** (language + exact source text), so the
  same description is translated once and reused across projects and restarts.
- Translation runs through OpenCode's own model call
  (`experimental.generate.text`). By default it uses **OpenCode's free model**
  (`opencode/deepseek-v4.1-flash-free`, no account needed inside OpenCode);
  you can also point it at any local provider (Ollama, LM Studio, llama.cpp,
  vLLM, …) for offline translation.
- **On any failure the original text is kept.** Timeouts, unreachable models,
  malformed output — nothing breaks, nothing is lost.

## How it works

Both the TUI and the GUI render descriptions from the **server registry**, so
one server-side transform localizes both interfaces:

- **Skills and agents** are edited in place through `skill.transform` /
  `agent.transform` → `editor.update`. Hidden agents (internal helpers such as
  title/summary) are skipped.
- **Commands** only expose `editor.add`, which replaces a whole definition
  (including `execute`). To translate a command without changing its behavior,
  the plugin identifies the registry map during its transform (a short-lived
  probe, see `src/server/capture.ts`), snapshots the pristine definitions, and
  re-adds each command with the translated description **and the original
  `execute`**. If the registry cannot be identified (e.g. a future host
  changes internals), command translation is skipped gracefully — skills and
  everything else keep working.
- **TUI-local commands** never pass through the server registries. The TUI
  part shadows them in the keymap: a high-priority layer re-registers each
  command under the same id with translated title/description, `bind: false`
  (original keybindings untouched) and a run that falls through to the
  original command — the palette shows the translation, behavior is unchanged
  (see `src/tui/shadow.ts`). Experimental; disable with `tuiCommands: false`.
- The TUI and GUI parts are control surfaces (refresh, language, model,
  enable/disable, cache, status, description editing) that talk to the server
  part over plugin RPC.

## Install

Requires OpenCode V2 (tested against 2.3.2).

```jsonc
// opencode.json (project) — server + TUI
{
  "plugins": ["opencode-translation"]
}
```

With options:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-translation",
      "options": { "model": "opencode/deepseek-v4.1-flash-free" }
    }
  ]
}
```

(For development you can also point `package` at a local checkout path.)

For the **GUI**, the plugin must also be listed in the **global** config
(`~/.config/opencode/opencode.json`). The npm package ships the prebuilt GUI
bundle; only a local checkout needs to build it once:

```sh
bun install
bun run build   # writes dist/gui-experimental.cjs
```

Then open Settings → **Translation** in the desktop app, or run the
“Translation settings” palette command. In the TUI, press **Ctrl+P** and use
the palette entries **Translation: menu**, **Translation: refresh** and
**Translation: edit description**.

### Editing descriptions

- **TUI**: palette → *Translation: edit description* (or menu → *Edit
  description*) → pick a command/skill/agent/TUI command → type the
  description. Leave it empty to clear a manual override.
- **GUI**: Settings → Translation → per-row **Edit** → type → **Save**.
- Manual overrides are persisted server-side, apply to items with an empty
  description, and are themselves translated. Priority: manual override >
  `descriptions` option > registry original.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. |
| `language` | auto | Target language tag (`zh-cn`, `ja`, …). Otherwise detected from the environment. |
| `model` | `opencode/deepseek-v4.1-flash-free` | `provider/model` (or `{providerID, id, variant?}`). Defaults to OpenCode's free model; the free lineup rotates, so pin another free model or a local provider for offline translation. |
| `targets` | `["command","skill","agent"]` | Which domains to translate. |
| `generateMissing` | `false` | Ask the model to write a description for items that have none (cached by kind/name/content). |
| `descriptions` | `{}` | Manual descriptions keyed by command name, skill id/name or agent name. Applied before translation (so they get translated too). |
| `tuiCommands` | `true` | Also translate TUI-local palette commands by shadowing them (experimental, degrades gracefully). |
| `concurrency` | `3` | Parallel translation calls (1–8). |
| `timeoutMs` | `30000` | Per-call timeout (1000–120000). |
| `refreshOnEvents` | `true` | Re-translate when commands/skills/agents/config change. |

Runtime settings changed from the TUI/GUI (language, model, enabled) are
persisted in plugin storage and win over `options` until cleared
(“Auto” in the language picker).

Example with manual overrides:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-translation",
      "options": {
        "language": "zh-cn",
        "model": "opencode/deepseek-v4.1-flash-free",
        "generateMissing": true,
        "descriptions": {
          "deploy": "Deploy the current branch to production",
          "my-skill": "Run the release checklist"
        }
      }
    }
  ]
}
```

## RPC

The server part registers `opencode-translation` with methods `status`,
`refresh`, `setLanguage`, `setModel`, `setEnabled`, `clearCache`, `list`,
`setDescription`, `getOverrides`, `translate` and an `updated` event.

- `list` items carry a stable `key` (command name, skill id, agent name) and
  the optional manual `override`.
- `setDescription({kind, key, description})` sets a manual override
  (`kind`: `command`/`skill`/`agent`/`tui`); `null` or empty clears it.
- `translate({text})` translates one arbitrary text with the shared
  engine/cache (used by the TUI part for TUI-local commands); returns
  `{text, changed}` and falls back to the input on failure.

Any client can call it:

```ts
import { TranslationRpc } from "opencode-translation/rpc"
const status = await client.rpc(TranslationRpc).status({})
```

## Development

```sh
bun install
bun test          # unit tests (language, cache, sanitization, prompts, capture)
bun run typecheck # tsc --noEmit
bun run build     # GUI bundle (vite + @opencode/plugin/gui/vite preset)
```

Layout:

```
src/core/      pure logic: language, cache keys, sanitization, prompts, options, overrides
src/server/    command-registry probe (capture.ts)
src/tui/       keymap shadow helpers for TUI-local commands (shadow.ts)
src/index.ts   server part (transforms, translation engine, RPC, storage)
src/tui.ts     TUI part (palette commands, dialogs, editing, shadow translation)
src/gui.tsx    GUI part (settings page, per-row editing, palette command)
src/rpc.ts     shared RPC contract
test/          bun unit tests
```

## Notes & limits

- Command behavior is preserved by delegating to the captured original
  `execute`; the plugin never re-implements command execution.
- Descriptions already written in the target language are skipped (script
  heuristic), so localized descriptions are not round-tripped.
- Translation output is sanitized (fences/labels/quotes stripped, runaway or
  apologetic output rejected); anything untrusted falls back to the original.
- The GUI bundle must be rebuilt after changing `src/gui.tsx` or `src/rpc.ts`.
- The default free model needs no account inside OpenCode, but free usage has
  a **daily cap** and the free lineup **rotates** (models retire without
  notice). When the cap is reached or a model retires, translation falls back
  to the original text; set `model` to another free model or a local provider
  for guaranteed/offline translation.
- TUI-local shadowing is experimental: it briefly disables its shadow layer
  to observe the true command list (on boot, route changes, server updates
  and a periodic sweep), then re-applies translations. If anything about the
  keymap internals changes, set `tuiCommands: false` — server-side
  translation is unaffected.
