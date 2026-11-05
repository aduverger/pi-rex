# @aduverger/pi-rex

<img width="200" height="200" alt="pi-rex" src="https://github.com/aduverger/pi-rex/blob/main/assets/pirex_icon.png" />

Compact tool calls in [Pi](https://pi.dev) when using the Rex iOS app.

## Development

### Setup and checks

```sh
npm ci
make check
make pack-check
```

### Try locally

```sh
pi -e ./src/index.ts
```

### Install from a local checkout

```sh
pi install /absolute/path/to/pi-rex
```

Run `/reload` in an existing Pi session, or start a new one.
