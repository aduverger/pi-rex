# Mobile thinking defaults

During authenticated Rex iOS block ownership, pi-rex requests Pi's native thinking collapse through `rex send-key`, targeting this Pi process's Rex session and block. Pi keeps its **Thinking...** label, native tap-to-expand behavior, model thinking level and saved message content.

Already-hidden thinking is left alone. A confirmed automatic collapse is reversed on desktop handoff, including ownership-query failure or event-stream exit. Users can expand thinking while mobile; the default is applied once per ownership transition, not continuously.

## Decisions — least confident first

1. **Use a zero-row widget to observe stock-editor focus.** This uses the public widget factory, concrete TUI classes and their public focus getter; it does not replace the editor, alter Pi's prototype or access private fields. Pi's stable TUI reference follows regular/fullscreen renderer changes. Pi already reserves the same above-editor separator with or without widgets. Also defer while Pi's process terminal has released raw input, such as while an external editor is running. The unasked choice was whether to automate custom editors too: defer rather than assume an unknown editor handles Ctrl+T like Pi's stock editor.
2. **Keep the literal Ctrl+T route conservative.** Skip and warn when thinking is remapped/disabled or another user-configured action also claims Ctrl+T. The unasked choice was whether to synthesize arbitrary replacement shortcuts; do not risk triggering another action. Recheck focus, desired state, settings and bindings when input arrives, not just before spawning Rex.
3. **Confirm, do not blindly retry.** Keep one command in flight and wait up to 2.5 seconds for input acknowledgement and Pi's effective `hideThinkingBlock` value. A CLI success alone is not confirmation. Errors or unconfirmed changes warn; another ownership transition can try again. A consumed key can be safely deferred until stock-editor focus returns. The unasked choice was retry policy: omit transport retries because this is a toggle, not an idempotent setter.
4. **Treat simultaneous Ctrl+T input as one automatic operation.** While a toggle is pending, ignore key releases and consume duplicate Ctrl+T presses. This prevents a manual press racing Rex delivery from toggling twice. The unasked choice was how to disambiguate identical manual/synthetic input: briefly coalesce it instead of inventing a custom terminal protocol. Normal manual toggles resume when the operation completes.
5. **Restore only a confirmed extension-owned change.** Do not write settings files or add persistent restoration metadata. Live reload/session replacement attempts restoration before removing the observer. Normal quit does not inject a restoration key: Pi stops reading input before its quit cleanup, and a key could reach the parent shell. The unasked choice was exit behavior: prefer leaving the saved preference hidden over typing into a different program. An unfocused or failed live restoration warns instead of claiming success.

## Limits

This deliberately uses Pi's existing persisted preference; it is not a mobile-only Pi setting. Quitting, crashing or losing delivery can leave thinking hidden. Restore it manually with Ctrl+T in Pi's editor. Custom editors are not automated. Project-level setting overrides or other terminal-input handlers can make an effective-setting confirmation unavailable; unconfirmed operations are reported, not retried or claimed successful.

Rex key delivery remains best effort: a key already accepted by Rex cannot be recalled, including if another program takes input after dispatch. No live Rex block, user settings, model request or phone configuration was changed during automated validation. Device handoff/routing, Linux and SDK versions beyond the exercised versions still need field testing.

## Validation

The Rex CLI fixture sends real input over a temporary Unix socket to Pi's actual TUI, stock editor, keybinding manager and assistant-message components, using an in-memory native settings manager. It rejects incorrect session/block/key arguments. Tests cover visible/hidden desktop preferences, regular/fullscreen operation through Pi's stable TUI reference, native label/streaming/tapping and unchanged messages, focus changes, released raw input, delayed keys, key releases, manual/synthetic races, manual expansion, transport failure/recovery, intercepted input, remapped/conflicting shortcuts, reload and quit.

Verified checks:

- `PI_TRUE_COLOR=0 make check`: strict types, all 46 tests and package verification pass on Node 24.15.0.
- The same gates pass on actual Node 22.19.0.
- All 46 tests and strict types pass against the installed Pi 1.5 SDK in an isolated project; repository development dependencies remain Pi 1.4.
- `FORCE_COLOR=3 PI_TRUE_COLOR=1 node --test test/*.test.ts`: all 46 tests pass.
- `PI_TRUE_COLOR=0 make pack-check`: prepack checks and the exact six-file package verification pass. No dependencies, settings, version or release artifacts were added.
- `git diff --check`: passes.

The keybinding-manager and stable-TUI-reference imports are pinned SDK integration fixtures, not production private-host dependencies. Production uses public exports and extension APIs only. The README remains the requested short feature description and developer commands.
