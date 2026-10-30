# P0: compact tools in Rex iOS

## Scope

- Detect Rex using `REX_SESSION` and `REX_BLOCK`.
- Read the terminal block owner and identify its client platform.
- Follow `block_owner_changed`; enable compact rendering only for an iOS owner.
- Collapse tool content to one summary line; keep Pi's spacing and tap/keyboard expansion. On iOS, folded tools indicate success/error with colored icons and no background; expanded tools retain native backgrounds.
- Delegate expanded and desktop views to the existing tool renderers, with a generic fallback.
- Leave reasoning, assistant Markdown, editor, footer, tool execution, and saved messages unchanged.
- Require fullscreen mode for tapping; do not change terminal settings.

## Implementation

1. Add the extension entry point and minimal TypeScript/test tooling.
2. Add a Rex CLI owner watcher, with an initial snapshot and one event-stream process.
3. Wrap tool renderers: compact mobile calls/results, original expanded details.
4. Test actual Pi tool components, ownership transitions, detection failure, and cleanup. Smoke-test the installed Rex CLI.
5. Document installation and limitations. Commit the completed task.

## Validation

- One-line tool content at narrow widths, including streaming calls and errors.
- Expansion preserves existing renderers, result details, and renderer component state.
- Desktop/iOS handoff, including unchanged terminal dimensions.
- Missing Rex context, missing CLI, failed queries, ended event stream, and shutdown.
- Typecheck, automated tests, package contents, and a live read-only Rex smoke test.
- Rex iOS tap forwarding requires a real-device check; do not claim it without testing.

## Decision ledger

Least-confident first:

1. Initially kept Pi's existing tool framing and spacing. “One line” means one visible content line. The background choice was superseded by the styling feedback below; spacing is still unchanged.
2. Inline images remain controlled by Pi, because its tool-image display sits outside the text renderer. P0 folds tool text/code, not image attachments. This limitation is documented rather than changing global image settings.
3. Reuse native per-row expansion. Entering mobile mode collapses Pi's global tool preference, and leaving restores the previous preference. Individually opened rows remain subject to Pi's normal behavior; no separate expansion-state store was added.
4. If the event stream exits, restore normal rendering and require `/reload` to watch again. Query failures can recover on a later owner-change event. No polling, reconnect worker, or retries were added.
5. An iOS owner must report both `kind: app` and `platform: ios`. Unknown owners/platforms and failed queries use normal rendering. Use Rex's supplied binary directory when available and never auto-start a server.
6. Bound each CLI query to a two-second connection timeout, a 2.5-second subprocess timeout, and 1 MiB of JSON output. These keep a broken CLI from hanging detection; failures use ordinary rendering.
7. Tests use Node's built-in test runner and Pi 1.4.0 development dependencies, with no additional test framework. The package has only host-provided peer dependencies at runtime.

## Completed validation

- `npm run check`: strict TypeScript and 25 tests passed.
- Tests use real Pi tool components for read/write/edit/bash rendering, native mouse expansion, desktop handoff, Unicode widths, partial output, and errors. A custom self-rendering tool checks delegated state/detail preservation; codemode itself was not run against a model.
- Rex CLI fixtures cover owner handoff without resize, unrelated blocks, failed-query recovery, stream exit, missing executable, malformed JSON, non-TUI mode, and idempotent shutdown.
- Live read-only detection and watcher startup/shutdown passed against the installed Rex server (macOS owner).
- A disposable Rex session confirmed the actual `block_owner_changed` JSON schema, including owner release. The disposable session was removed.
- Pi's actual extension loader loaded `src/index.ts` without errors, registering one renderer resolver and the two lifecycle handlers.
- `npm pack --dry-run` and `git diff --check` passed.
- `npm audit --omit=dev`: zero vulnerabilities. The full development dependency tree reports advisories through Pi 1.4.0's `undici` dependency. An attempted dependency update was blocked by auto mode and was not retried.

## Styling feedback: icon-only status

- Initially removed native status-colored backgrounds on iOS, including while expanded. This was too broad and is corrected below. Collapsed error text remains neutral; the tick/cross alone carries success/error color.
- Reused Pi's public self-rendering shell support and `Box`/`Container` components to keep existing spacing and native desktop backgrounds. No global theme changes or ANSI background-stripping hacks.
- Desktop handoff tests now compare raw ANSI output against native Pi components. Regression checks cover pending/success/error backgrounds, icon colors, expansion, switching back to mobile, and preserving results through Pi's actual HTML exporter.

### Styling decision ledger

Least-confident first:

1. Preserve syntax/diff colors in expanded details and custom tools' own self-rendered content. The request changes tool-level status highlighting, not the meaning of code or diff colors.
2. Remove pending tool backgrounds as well as green/red completion backgrounds only while folded. Expanded tools retain Pi's native pending/success/error backgrounds.
3. Retain existing spacing; changing row density is outside this feedback.
4. Keep separately resolved result renderers usable without a call frame, because Pi's HTML exporter resolves the two slots independently. The shared frame is only needed for the interactive tool shell.

## Correction: all tools follow edit's folding behavior

- Use the same folded predicate for summary rendering and background suppression: mobile and not expanded.
- Preserve native expanded output for every tool, including backgrounds. Leave tools with their own shell, such as edit, delegated to that shell.
- Tests compare raw ANSI output against native Pi for successful and failed read/write/edit/bash calls, not just text without color. Pending expansion, refolding, generic tools, HTML export, and desktop handoff remain covered.

### Correction decision ledger

1. Keep pending backgrounds when expanded as well as success/error backgrounds: this follows the existing requirement to preserve native expanded views.
2. No new tool-specific rules or abstractions; the correction only narrows background suppression to the existing folded state.

## Mobile tool frames

- Draw a neutral, rounded border around each folded or expanded tool on iOS.
- Reuse the existing frame content and native expanded renderers. Replace the standard shell's vertical padding with border rows; preserve custom self-rendered content without trimming it.
- Forward mouse coordinates through the border so existing expansion and custom child controls keep working.
- Leave desktop rendering, tool execution, keyboard behavior, and saved messages unchanged. No grouping in this change.
- Validate native contents/backgrounds at the reduced inner width, narrow Unicode layouts, mouse propagation, resizing, and desktop handoff.

### Frame decision ledger

Least-confident first:

1. Preserve all expanded self-rendered content, including its own padding. Its outer frame adds two border rows; trimming it could remove real tool output. Standard shells replace their two blank padding rows instead, and all folded tools have the same three-row frame.
2. Below five terminal columns, show clipped original content without a border; there is not enough room for a useful padded frame. No width option was added.
3. Use rounded box-drawing characters in Pi's `dim` theme color. The border is neutral for pending, success, and error states; status remains on the icon and native expanded content.
4. Inline images remain outside the text frame, as Pi renders them separately. No global image setting, keyboard behavior, or custom child control was changed.

### Frame validation

- Native read/write/edit/bash success and error contents retain their ANSI styling at the reduced inner width. Desktop output still matches native Pi exactly.
- Tests cover folded height, Unicode widths, resize and tiny-width fallback, theme changes, expansion/refolding, custom child coordinates/focus, failures, and desktop handoff.
- A real read of `README.md` was executed and its actual result rendered folded and expanded at 48 columns. Both views stayed within the terminal width.
- No real-device frame-tap check has been performed yet. Rex's existing keyboard-on-tap issue is unchanged; the removed dismissal workaround was not reintroduced.

## Remaining manual validation

- Test on Rex iOS: open an existing Pi session, take block ownership, tap a completed tool to expand/collapse, and hand ownership back to desktop.
- No global Pi installation/settings changes, npm publication, or remote push were performed.
