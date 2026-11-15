# Third-party notices

ChenADE is MIT-licensed (see [LICENSE](LICENSE)). It bundles and links a few third-party
components whose licenses are reproduced below or in the referenced files.

## Bundled binaries / assets

| Component | Version | License | Where | License text |
| --- | --- | --- | --- | --- |
| tmux | 3.5a | ISC | `src-tauri/resources/bin/tmux` (macOS universal) | [`LICENSE-tmux`](src-tauri/resources/bin/LICENSE-tmux) |
| libevent (statically linked into tmux) | 2.1.12-stable | BSD-3-Clause | inside the tmux binary | [`LICENSE-libevent`](src-tauri/resources/bin/LICENSE-libevent) |
| Sarasa Mono SC | 1.0.30 | SIL OFL 1.1 | `public/fonts/SarasaMonoSC-Regular.woff2` | [`OFL.txt`](public/fonts/OFL.txt) |

The macOS bundle ships the tmux binary and both license files under
`ChenADE.app/Contents/Resources/bin/`. Other platforms fall back to a plain PTY and do not
bundle tmux.

## Runtime dependencies (npm / crates.io)

Installed from their respective registries at build time; each package carries its own
license. The main ones:

- [Tauri](https://tauri.app/) (MIT / Apache-2.0)
- [React](https://react.dev/) (MIT)
- [Vite](https://vite.dev/) (MIT)
- [xterm.js](https://xtermjs.org/) + `addon-unicode11`, `addon-search` (MIT)
- [portable-pty](https://github.com/wez/wezterm/tree/main/pty) (MIT)
- [rusqlite](https://github.com/rusqlite/rusqlite) (MIT)
- [Zustand](https://zustand.docs.pmnd.rs/) (MIT)
