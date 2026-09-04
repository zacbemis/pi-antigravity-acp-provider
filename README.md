# pi-gemini-acp-provider

A first-class [Pi](https://github.com/earendil-works/pi) provider for **Google Antigravity** through its official ACP server.

> **Important:** this package no longer uses `@google/gemini-cli`. The Gemini CLI individual Code Assist login path was retired and is not a supported authentication route. Antigravity/`agy` is the target runtime.

## Features

- Registers `gemini-acp/*` models backed by Google Antigravity.
- Uses ACP protocol v1 and the official TypeScript SDK.
- Discovers the authenticated Antigravity model catalog and switches models per session.
- Supports Pi streaming, warm sessions, cancellation, usage metadata, and lifecycle cleanup.
- Routes compatible Pi tools through an authenticated loopback MCP bridge.
- Presents ACP permission requests through Pi and defaults to denial; it never chooses an allow option automatically.
- Advertises no ACP filesystem or terminal client capabilities.
- Uses a self-service ACP registry installer based on the reviewed `@estebanforge/pi-antigravity-bridge` setup when the official server is absent.

## Install

```bash
pi install npm:pi-gemini-acp-provider
```

For local development:

```bash
pi --no-extensions -e ./extensions/index.ts
```

Then use `/login`, choose **Google Antigravity (ACP)**, and select a `gemini-acp` model with `/model`.

The provider first looks at `AGY_ACP_BIN`, `~/.local/bin/agy_acp_server.par`, the bridge-managed `~/.local/opt/agy-acp/current/` location, and `PATH`. If absent, it installs the platform build published in the ACP registry. Google's ACP server is a large download (the Linux build observed during development expands to about 1.8 GB).

Antigravity owns OAuth tokens under `~/.gemini/antigravity-acp/`; Pi stores only a non-secret configured marker. Existing `agy` CLI credentials and Gemini CLI credentials should not be assumed to authenticate this separate ACP server.

## Commands

```text
/gemini-acp doctor
/gemini-acp doctor --verbose
```

## Development

```bash
npm run check
npm run test:real-acp  # initializes the installed Antigravity ACP server
npm run test:live      # sends a real authenticated prompt
npm run test:packed
npm audit --audit-level=high
```

## Security boundary

This launches a full coding agent with the user's OS privileges. Disabling ACP filesystem/terminal **client callbacks is not a sandbox** for Antigravity-native tools. Pi hooks govern tools routed through the `pi_` MCP namespace; Antigravity-native tools remain governed by Antigravity policy and ACP permission requests.

## Compatibility

The implementation is pinned to Pi 0.85.0, ACP SDK 0.16.1, the reviewed `@estebanforge/pi-antigravity-bridge` 1.4.1 setup behavior, and ACP protocol 1. The live development environment reported `antigravity-acp` build `agy_acp_server_1.1.1`.

Earlier repository documents analyzing `@google/gemini-cli@0.58.0` describe the superseded implementation and are retained only as historical research. See [`docs/ANTIGRAVITY-MIGRATION.md`](docs/ANTIGRAVITY-MIGRATION.md).

## License

MIT
