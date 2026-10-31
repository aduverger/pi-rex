# @aduverger/pi-rex

<img width="200" height="200" alt="pi-rex" src="https://github.com/aduverger/pi-rex/blob/main/assets/pirex_icon.png" />

Compact [Pi](https://pi.dev) tool output and a separate conversation tab when Rex's iOS app owns your Pi terminal.

## Install

From this checkout:

```sh
pi install /absolute/path/to/pi-rex
```

Run `/reload` in an existing Pi session, or start a new one. To try it without installing:

```sh
pi -e ./src/index.ts
```

Requires Pi ≥1.4.0, Node ≥22.19.0, and a local Rex server that negotiates control API revision 7. Tested with Rex `0.0.1793420730-g6d0d9a`. Use Pi's fullscreen mode for tapping individual tool rows; pi-rex does not change that setting.

## Original Pi tab

- Uses `REX_SESSION` and `REX_BLOCK` to find the terminal, then checks its owner's client platform. A connected phone alone does not activate mobile mode.
- Follows Rex's `block_owner_changed` event, including handoffs where terminal dimensions stay the same.
- On iOS, each tool has a neutral rounded frame with a one-column right gutter for Pi's scrollbar, and starts folded to one summary line: status, tool name, and path or command when available. Errors include their first nonempty text line, space permitting. When folded, only the tick/cross carries success/error color and there is no tool background. Expanded tools retain their native backgrounds and code/diff highlighting. Standard blank padding becomes border rows; custom self-rendered details keep their own padding.
- Tap a tool row to expand or collapse it. Pi's tool-expansion shortcut still works. Expanded views reuse the existing renderers, including codemode's own detail view. Tools without renderers use Pi's native fallback, including sanitized output, argument formatting, previews, and image placeholders.
- Restores normal rendering on desktop handoff. The global expansion preference from before mobile mode is restored; Pi retains individual row choices unless its global expansion control resets them.
- Does not change reasoning, assistant Markdown, editor, footer, tool execution, or saved messages.

Outside Rex, the extension does nothing. RPC, print, and JSON modes do not start the owner watcher. Missing ownership information or a failed Rex command leaves normal rendering in place. If the owner event stream ends, normal rendering returns; use `/reload` to start watching again. The owner watcher does not poll or reconnect automatically.

### Original-tab limitations

- The new frame's interaction on Rex iOS still needs device validation. Automated tests exercise Pi's actual tool components and normalized mouse clicks, not the iOS app.
- Inline images remain under Pi's own image-display setting; they are not hidden or enclosed by the text-tool frame.
- No separate nested-call reconstruction or custom tool-detail views.
- HTML exports made during iOS ownership can omit custom-tool arguments from the visible call header. The arguments remain in the embedded session data and JSONL export. Export after desktop handoff or use JSONL; a reliable terminal/export distinction requires upstream Pi support.

## Conversation tab

When an iOS app takes ownership of the original Pi block, pi-rex creates one separate **Pi conversation** tab without switching focus. Open it yourself in Rex. `/rex-view` in Pi opens or reuses it manually, including on desktop.

- The existing Pi process executes everything and owns the session files; the new tab is only a terminal viewer. It uses Rex client actions over the existing local Unix socket, not terminal scraping or simulated input.
- Markdown, code, reasoning, neutral expandable tool cards, and edit diffs are text-based. More than five consecutive root tool calls form a folded group. Nested calls use Pi's supplied identities; historical nested outputs that Pi did not save are marked unavailable. Images become placeholders.
- The composer is independent of Pi's original editor. Use **Send**, **Steer**, **Follow-up**, and **Stop**. Enter sends when idle and steers while running; Shift+Enter inserts a newline. Dispatch acknowledgements clear only the matching draft, never later edits or another session's draft. Every attempt stays in **Submission recovery** until dismissed; inserting its text preserves newer draft text and never resends it automatically.
- Extension slash commands, prompt templates, and skills use Pi's normal dispatch. Standard confirm/select/input/editor dialogs can be answered on either surface; the first answer wins. Standard extension notifications are mirrored. The original standard editor retains Pi's configured external-editor command (Ctrl+G). Unsupported terminal-only commands (including `/model` and `/thinking`) are rejected, not sent to the model. Arbitrary custom extension screens remain original-tab-only and are explicitly flagged in the viewer.
- Tap tool headings to fold/unfold; Ctrl+O toggles all tools/groups. Scrolling, selection, and folding are local to the viewer. Drafts are retained separately per conversation while the viewer stays open.
- The same tab follows `/new`, resume, fork, tree navigation, and `/reload`. Temporary bridge loss disables submission and reconnects. Acknowledgement means dispatch to Pi's public API, not acceptance or successful execution. Observed compaction rejects model-bound prompts before dispatch; other Pi-private errors may not be reported, so dispatched text remains explicitly unconfirmed and recoverable. A timed-out send is **not** automatically replayed: check the conversation, then explicitly retry the same request or dismiss the uncertainty. Retry is refused after a generation change.
- Closing the viewer leaves Pi running and remains respected across reload. `/rex-view` or a later desktop→iOS ownership handoff reopens it. Actual Pi process exit closes the viewer. Ctrl+Q, or Ctrl+D with an empty composer, closes only the viewer. Closing discards local drafts and recovery copies.

Rex iOS touch/keyboard behavior still needs device validation. No keyboard settings, automatic tab switching, extra servers, or live Rex configuration changes are involved. See [the implementation plan and validation record](docs/mobile_viewer.md).

## Develop

```sh
npm ci
make check
make pack-check
```

The checks run strict TypeScript validation, Node tests, and package verification. Renderer and viewer tests use Pi's actual TUI components. When the Rex CLI is installed, integration tests start isolated servers and a real Pi process with a deterministic local provider; they never use model credentials or live Rex settings. Those integration tests explicitly skip when Rex is absent. CI runs the gates on Node 22 and 24.

Packaging allows only the extension/viewer sources, manifest, README, and license. The integration test uses Pi's managed npm installer with no installed Pi peers. A small bootstrap uses `jiti` to load the viewer's TypeScript (Node's native stripping excludes dependencies), explicitly resolving public Pi SDK/TUI exports from the host package directory rather than the extension's dependency tree. Non-Node hosts need Node and filesystem-resolvable host exports; Bun-hosted Pi remains unverified. `ws` implements the existing Rex transport. No compiled build is needed.

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
