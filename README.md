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
- On iOS, each tool has a neutral rounded frame with a one-column right gutter for Pi's scrollbar, and starts folded to one summary line: status, tool name, and path or command when available. Errors include their first nonempty text line, space permitting. When folded, only the tick/cross carries success/error color and there is no tool background. Expanded tools retain their native backgrounds and code/diff highlighting. Standard blank padding becomes border rows; custom self-rendered details keep their own padding.
- Tap a tool row to expand or collapse it. Pi's tool-expansion shortcut still works. Expanded views reuse the existing renderers, including codemode's own detail view. Tools without renderers use Pi's native fallback, including sanitized output, argument formatting, previews, and image placeholders.
- Restores normal rendering on desktop handoff. The global expansion preference from before mobile mode is restored; Pi retains individual row choices unless its global expansion control resets them.
- Does not change reasoning, assistant Markdown, editor, footer, tool execution, or saved messages.

Outside Rex, the extension does nothing. RPC, print, and JSON modes do not start the owner watcher. Missing ownership information or a failed Rex command leaves normal rendering in place. If the event stream ends, normal rendering returns; use `/reload` to start watching again. There is no polling or automatic reconnect loop.

### P0 limitations

- The new frame's interaction on Rex iOS still needs device validation. Automated tests exercise Pi's actual tool components and normalized mouse clicks, not the iOS app.
- Inline images remain under Pi's own image-display setting; they are not hidden or enclosed by the text-tool frame.
- No separate nested-call reconstruction or custom tool-detail views.
- HTML exports made during iOS ownership can omit custom-tool arguments from the visible call header. The arguments remain in the embedded session data and JSONL export. Export after desktop handoff or use JSONL; a reliable terminal/export distinction requires upstream Pi support.

## Develop

```sh
npm ci
make check
make pack-check
```

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
