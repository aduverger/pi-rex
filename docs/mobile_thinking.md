# Mobile thinking defaults

## Workspace intent

- **User goal:** default thinking blocks to collapsed while the Rex iOS app owns this Pi terminal, preserving Pi's native **Thinking...** label and ability to expand them.
- **Accepted approach:** target this Rex session/block with Ctrl+T; do not invert an already-hidden preference; restore confirmed extension-owned changes on desktop handoff. The user rejected modifying Pi and explicitly rejected replacing its default label.
- **Constraints:** keep execution, model thinking level, saved messages, existing compact-tool rendering and ownership detection unchanged. No Pi patches/prototype replacement, reconstructed thinking output, separate viewer, new dependencies/settings or persisted restoration metadata. Keep the short README intact. Do not automatically reload a live session or release the package.
- **Tradeoff:** this invokes Pi's existing persisted global visibility toggle, not a mobile-only setting. A crash or failed delivery can leave the preference hidden; accepted input cannot be recalled. Device routing remains unverified.
- **Agent mechanisms, not extra user requirements:** the zero-row focus observer, stock-editor/raw-input checks, conservative shortcut-conflict policy, single in-flight toggle, acknowledgement timeout, duplicate-key coalescing and live teardown restoration.

During authenticated Rex iOS block ownership, pi-rex requests Pi's native thinking collapse through `rex send-key`, targeting this Pi process's Rex session and block. Pi keeps its **Thinking...** label, native tap-to-expand behavior, model thinking level and saved message content.

Already-hidden thinking is left alone. A confirmed automatic collapse is reversed on desktop handoff, including ownership-query failure or event-stream exit. Users can expand thinking while mobile; the default is applied once per ownership transition, not continuously.

## Decisions — least confident first

1. **Use a zero-row widget to observe stock-editor focus.** This uses the public widget factory, concrete TUI classes and their public focus getter; it does not replace the editor, alter Pi's prototype or access private fields. Pi's stable TUI reference follows regular/fullscreen renderer changes. Pi already reserves the same above-editor separator with or without widgets. Also defer while Pi's process terminal has released raw input, such as while an external editor is running. The unasked choice was whether to automate custom editors too: defer rather than assume an unknown editor handles Ctrl+T like Pi's stock editor.
2. **Keep the literal Ctrl+T route conservative.** Skip and warn when thinking is remapped/disabled or another user-configured action also claims Ctrl+T. The unasked choice was whether to synthesize arbitrary replacement shortcuts; do not risk triggering another action. Recheck focus, desired state, settings and bindings when input arrives, not just before spawning Rex.
3. **Confirm, do not blindly retry.** Keep one command in flight and wait up to 2.5 seconds for input acknowledgement and Pi's effective `hideThinkingBlock` value. A CLI success alone is not confirmation. Errors or unconfirmed changes warn; another ownership transition can try again. A consumed key can be safely deferred until stock-editor focus returns. The unasked choice was retry policy: omit transport retries because this is a toggle, not an idempotent setter.
4. **Treat simultaneous Ctrl+T input as one automatic operation.** While a toggle is pending, ignore key releases and consume duplicate Ctrl+T presses. This prevents a manual press racing Rex delivery from toggling twice. The unasked choice was how to disambiguate identical manual/synthetic input: briefly coalesce it instead of inventing a custom terminal protocol. Normal manual toggles resume when the operation completes.
5. **Restore only a confirmed extension-owned change.** Do not write settings files or add persistent restoration metadata. Live reload/session replacement attempts restoration before removing the observer. Normal quit does not inject a restoration key: Pi stops reading input before its quit cleanup, and a key could reach the parent shell. The unasked choice was exit behavior: prefer leaving the saved preference hidden over typing into a different program. An unfocused or failed live restoration warns instead of claiming success.

## Review disposition needed

Preserve these existing branch behaviors for review rather than treating them as explicit user requirements or deleting them during simplification:

- Normal quit leaves a confirmed automatic collapse persisted, not only crashes. This was disclosed before implementation but not separately approved; no restoration key is sent after Pi stops reading input.
- Custom editors and remapped/conflicting shortcuts are not automated. This narrows the general mobile-default goal in favor of avoiding unintended actions.
- Pending operations briefly consume duplicate manual Ctrl+T presses. This is an agent-chosen race policy; ordinary manual expansion resumes afterward.
- Live reload/session replacement attempts restoration, and failed restoration warns. This extends the explicitly discussed desktop-handoff behavior.

## Limits

This deliberately uses Pi's existing persisted preference; it is not a mobile-only Pi setting. Quitting, crashing or losing delivery can leave thinking hidden. Restore it manually with Ctrl+T in Pi's editor. Custom editors are not automated. Project-level setting overrides or other terminal-input handlers can make an effective-setting confirmation unavailable; unconfirmed operations are reported, not retried or claimed successful.

Rex key delivery remains best effort: a key already accepted by Rex cannot be recalled, including if another program takes input after dispatch. No live Rex block, user settings, model request or phone configuration was changed during automated validation. Device handoff/routing, Linux and SDK versions beyond the exercised versions still need field testing.

## Validation

The Rex CLI fixture sends real input over a temporary Unix socket to Pi's actual TUI, stock editor, keybinding manager and assistant-message components, using an in-memory native settings manager. It rejects incorrect session/block/key arguments. Tests cover visible/hidden desktop preferences, regular/fullscreen operation through Pi's stable TUI reference, native label/streaming/tapping and unchanged messages, focus changes, released raw input, delayed keys, key releases, manual/synthetic races, manual expansion, transport failure/recovery, intercepted input, remapped/conflicting shortcuts, reload and quit.

Verified checks:

- `PI_TRUE_COLOR=0 make check`: strict types, all 46 tests and package verification pass on Node 24.15.0.
- The same gates pass on actual Node 22.19.0.
- All 46 tests and strict types pass against the installed Pi 1.5 SDK in an isolated project; repository development dependencies remain Pi 1.4.
- `PI_TRUE_COLOR=0 node --test test/rex.test.ts`: all 21 ownership/thinking integration cases pass, including focus changes, transport failure/recovery and teardown.
- `FORCE_COLOR=3 PI_TRUE_COLOR=1 node --test test/rex.test.ts`: the same 21 cases pass with forced color.
- `PI_TRUE_COLOR=0 make pack-check`: prepack checks and the exact six-file package verification pass. No dependencies, settings, version or release artifacts were added.
- `git diff --check`: passes.

The keybinding-manager and stable-TUI-reference imports are pinned SDK integration fixtures, not production private-host dependencies. Production uses public exports and extension APIs only. The README remains the requested short feature description and developer commands.

## Simplification decisions — least confident first

1. Replace three overlapping teardown flags with one lifecycle value: active, restoring, stopping or disposed. These are the states the existing control flow actually reaches. Repeated disposal after completion is a no-op; restoration still drains the previous command before attempting the current desired state. The unasked choice was representation: keep the same behavior with fewer independent flags rather than redesign the handoff controller.
2. Keep the focus observer and acknowledgement handshake. Pi exposes neither a session-only thinking setter nor direct shortcut invocation. Removing these mechanisms would reintroduce wrong-focus delivery, stale handoff toggles or treating Rex acceptance as Pi confirmation. Do not substitute editor replacement, Pi monkey-patching, arbitrary remapped keys or a retry worker.
3. Flatten shortcut validation into a direct loop, name the desired preference explicitly, and evaluate focus once per received event. The unasked choice was code organization: preserve the existing predicates and caller-specific policy in the Pi extension rather than move it into shared Rex command infrastructure.

No public API, test contract, configuration or out-of-scope file changed. Test curation remains separate.
