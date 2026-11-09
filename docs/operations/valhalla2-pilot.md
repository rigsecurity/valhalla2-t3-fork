# Valhalla2 desktop pilot

The Apple Silicon pilot uses the T3 desktop packager. Valhalla2 keeps its settings, threads and
browser profile under `~/.valhalla2`. It registers its own `valhalla2://` links. Preview builds
receive updates by installing a new pilot build.

Follow [T3 development setup](development.md) for Vite+, Node and the macOS build prerequisites.
Use Rust 1.95 or newer for the bundled resource monitor. From the fork checkout, run:

```sh
vp install
T3CODE_DESKTOP_VERSION=0.1.6-preview.20261109.1 vp run dist:desktop:dmg:arm64
```

The DMG is written to `release/`. Local builds use ad hoc signing. For distribution to other
Macs, follow [T3's signing and notarization runbook](release.md#2-apple-signing--notarization-setup-macos)
with Rig's Developer ID and the `com.rigsecurity.valhalla2` bundle ID.

For contributors, start a development desktop with separate state:

```sh
vp run --filter @t3tools/desktop ensure:electron
vp run dev:desktop --no-seed --home-dir "$PWD/.t3"
```

In setup, select your local environment, check that Claude Code is ready, and add a project.
**Settings → Appearance** controls the color scheme. Connect the pilot users to the same
[Memorywell environment](../user/valhalla2-memorywell.md) to share repo knowledge. Follow the
[Valhalla2 guide](../user/valhalla2.md) for workflows, Results and Jira.
