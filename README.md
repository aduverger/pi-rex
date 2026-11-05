# @aduverger/pi-rex

<img width="200" height="200" alt="pi-rex" src="https://github.com/aduverger/pi-rex/blob/main/assets/pirex_icon.png" />

Compact, foldable [Pi](https://pi.dev) tool output when your Rex terminal is controlled by the iOS app.

## Install

From this checkout:

```sh
pi install /absolute/path/to/pi-rex
```

Run `/reload` in an existing Pi session, or start a new one. To try it without installing:

```sh
pi -e ./src/index.ts
```

Tested with Pi 1.4.0 and Rex server `0.0.1793231964-ga3e149`. Use Pi's fullscreen mode for tapping individual tool rows; pi-rex does not change that setting.

## Behavior

- Uses `REX_SESSION` and `REX_BLOCK` to find the terminal, then checks its owner's client platform. A connected phone alone does not activate mobile mode.
- Follows Rex's `block_owner_changed` event, including handoffs where terminal dimensions stay the same.
- On iOS, tools are borderless in summary, preview and full output, with blank spacer rows, text inset and a one-column right gutter for Pi's scrollbar. Each starts folded to one summary content line: status, tool name, and path or command when available. Errors include their first nonempty text line, space permitting. Only the tick/cross carries success/error color, with no summary background. Preview/full retain native backgrounds and code/diff highlighting; custom self-rendered details keep their own padding.
- Tap a tool row or its padding to cycle **summary → native preview → full → summary**. Ordinary tool text also advances the cycle; custom interactive controls keep their own actions. The preview is whatever Pi normally shows when collapsed (five visual output rows for bash, not a universal limit). Preview/full retain native backgrounds, formatting and detail views. Pi's global tool-expansion shortcut selects full or summary and resets local previews when its preference changes. Tools without renderers use Pi's native fallback, including sanitization, argument formatting and image placeholders.
- Restores normal rendering on desktop handoff. The global expansion preference from before mobile mode is restored; Pi retains individual row choices unless its global expansion control resets them.
- Caches unchanged summaries and mobile output formatting for long sessions. Delegated children are still checked for interactive updates, and native renderers still receive lifecycle updates while hidden so streaming timers stop normally.
- Does not change reasoning, assistant Markdown, editor, footer, tool execution, or saved messages.

Outside Rex, the extension does nothing. RPC, print, and JSON modes do not start the owner watcher. Missing ownership information or a failed Rex command leaves normal rendering in place. If the event stream ends, normal rendering returns; use `/reload` to start watching again. There is no polling or automatic reconnect loop.

### P0 limitations

- Borderless presentation was accepted after a Rex iOS field trial; broad native touch, keyboard/IME and accessibility validation remains open. Automated tests exercise Pi's actual tool components and normalized mouse clicks, not the iOS app. Host benchmarks do not establish phone latency.
- Inline images remain under Pi's own image-display setting, outside the mobile text shell.
- No separate nested-call reconstruction or custom tool-detail views.
- HTML exports made during iOS ownership can omit custom-tool arguments from the visible call header. The arguments remain in the embedded session data and JSONL export. Export after desktop handoff or use JSONL; a reliable terminal/export distinction requires upstream Pi support.

## Develop

```sh
npm ci
make check
make pack-check
```

Run `node scripts/benchmark-renderer.mjs` for a non-gating native/summary/preview comparison at 1,000 and 5,000 tools. This measures host rendering, not phone or end-to-end latency. The implementation plan, decisions and validation are in [docs/three_state_tools_plan.md](docs/three_state_tools_plan.md).

The checks run strict TypeScript validation, Node tests, and package verification. CLI fixtures test ownership changes and failure recovery without touching existing Rex sessions. Renderer tests use Pi's native tool components. CI runs the same gates on Node 22 and 24 for pushes and pull requests. Packaging verifies the source-based extension entry point and permits only the six runtime/documentation files; no compiled build is needed.

## Release

From a clean, synchronized `main` branch:

```sh
make release VERSION=0.0.2
```

For a prerelease, use a non-`latest` npm tag:

```sh
make release VERSION=0.1.0-rc.1 NPM_TAG=next
```

The release target validates Git and npm state, updates package versions, runs all quality gates, pushes the release commit, publishes the public package, verifies registry visibility, and pushes the matching Git tag. It requires local npm authentication.

`.github/workflows/publish.yml` also supports npm trusted publishing with provenance. Configure the npm trusted publisher for repository `aduverger/pi-rex`, workflow `publish.yml`, and GitHub environment `npm`. Dispatch with `dry_run: true` to verify release gates without publishing; actual publication requires `dry_run: false`. Supply a unique `run_nonce` to identify the run and choose the npm dist-tag (`next` by default). Unlike `make release`, this workflow publishes the checked-out package version without bumping it or creating a Git tag.
