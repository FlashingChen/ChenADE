# Bundled tmux

`tmux` here is a **self-contained macOS universal binary** (`arm64` + `x86_64`, ad-hoc signed)
that ChenADE ships so terminal sessions survive app restarts.

- Version: tmux 3.5a, built from the upstream release tarball
- Static libevent 2.1.12-stable (no Homebrew dylibs); only system libs are linked:
  `libncurses.5.4`, `libSystem`, `libresolv`
- Configure flags: `--disable-utf8proc` (avoids an extra shared dependency; tmux keeps its
  built-in width tables). libevent: `--enable-static --disable-shared --disable-openssl
  --disable-samples --disable-libevent-regress`
- Strip: `strip -x`; codesign: `codesign --force --sign -`
- Size: ~2.0 MB
- Building the `x86_64` slice on Apple Silicon needs Rosetta 2
  (`softwareupdate --install-rosetta --agree-to-license`), otherwise configure fails with
  "cannot run C compiled programs"

Rebuild recipe (macOS, Xcode command line tools):

```bash
# 1) libevent, per arch
curl -L -O https://github.com/libevent/libevent/releases/download/release-2.1.12-stable/libevent-2.1.12-stable.tar.gz
./configure --prefix=/tmp/tmux-build/prefix-arm64 --enable-static --disable-shared \
  --disable-openssl --disable-samples --disable-libevent-regress \
  CFLAGS="-arch arm64 -O2" LDFLAGS="-arch arm64"
make -j && make install

# 2) tmux, per arch
PKG_CONFIG_PATH=/tmp/tmux-build/prefix-arm64/lib/pkgconfig \
CPPFLAGS="-I/tmp/tmux-build/prefix-arm64/include" \
LDFLAGS="-arch arm64 -L/tmp/tmux-build/prefix-arm64/lib -Wl,-search_paths_first" \
./configure --disable-utf8proc
make -j

# repeat for x86_64, then:
lipo -create -output tmux tmux-arm64 tmux-x86_64
strip -x tmux && codesign --force --sign - tmux
```

If the binary is missing at runtime (unsupported platform / stripped bundle), ChenADE falls
back to a plain PTY and the settings page says so.

License texts ship next to the binary (`LICENSE-tmux`, `LICENSE-libevent`) and are copied
into `ChenADE.app/Contents/Resources/bin/` by `src-tauri/tauri.macos.conf.json`.
