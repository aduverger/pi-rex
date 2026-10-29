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
- On iOS, tool content starts folded to one summary line: status, tool name, and path or command when available. Errors include their first nonempty text line, space permitting. When folded, only the tick/cross carries success/error color and there is no tool background. Expanded tools retain their native backgrounds and code/diff highlighting. Existing spacing remains.
- Tap a tool row to expand or collapse it. Pi's tool-expansion shortcut still works. Expanded views reuse the existing renderers, including codemode's own detail view. Tools without renderers show raw arguments and text results.
- Restores normal rendering on desktop handoff. The global expansion preference from before mobile mode is restored; Pi retains individual row choices unless its global expansion control resets them.
- Does not change reasoning, assistant Markdown, editor, footer, tool execution, or saved messages.

Outside Rex, the extension does nothing. RPC, print, and JSON modes do not start the owner watcher. Missing ownership information or a failed Rex command leaves normal rendering in place. If the event stream ends, normal rendering returns; use `/reload` to start watching again. There is no polling or automatic reconnect loop.

### P0 limitations

- Real Rex iOS tap forwarding still needs device validation. Automated tests exercise Pi's actual tool components and normalized mouse clicks, not the iOS app.
- Inline images remain under Pi's own image-display setting; they are not hidden by the text-tool summary renderer.
- No separate nested-call reconstruction or custom tool-detail views.

## Develop

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

The checks run strict TypeScript validation and Node tests. CLI fixtures test ownership changes and failure recovery without touching existing Rex sessions. Renderer tests use Pi's native tool components.
