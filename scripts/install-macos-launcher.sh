#!/bin/sh
# Build the two native products in an isolated scratch directory, then run the installer.
set -eu
umask 077

usage='Usage: scripts/install-macos-launcher.sh [--app-name BASENAME.app] [--node ABS_PATH]
       [--data-dir ABS_PATH] [--port N] [--require-api-key] [--disable-ollama]
       [--codex-binary ABS_PATH] [--claude-binary ABS_PATH]
       scripts/install-macos-launcher.sh --help'

if [ "$#" -eq 1 ] && [ "$1" = "--help" ]; then
    printf '%s\n' "$usage"
    exit 0
fi

refuse() {
    printf '%s\n' "$1" >&2
    exit 1
}

if [ "$(/usr/bin/uname -s)" != Darwin ] || [ "$(/usr/bin/uname -m)" != arm64 ]; then
    refuse "This installer requires macOS 15 or later on Apple Silicon."
fi
version=$(/usr/bin/sw_vers -productVersion)
major=${version%%.*}
if [ "$major" -lt 15 ]; then
    refuse "This installer requires macOS 15 or later on Apple Silicon."
fi
default_node=$(command -v node 2>/dev/null || :)
case "$default_node" in /*) ;; *) default_node='' ;; esac

script=$(/bin/realpath "$0" 2>/dev/null) ||
    refuse "The launcher installer could not locate its checkout."
checkout=${script%/scripts/install-macos-launcher.sh}
if [ "$checkout" = "$script" ] || [ ! -f "$checkout/apps/macos-launcher/Package.swift" ]; then
    refuse "The launcher installer could not locate its checkout."
fi

private_tmp=$(/usr/bin/getconf DARWIN_USER_TEMP_DIR 2>/dev/null) ||
    refuse "A private launcher build directory is unavailable."
private_tmp=$(/bin/realpath "$private_tmp" 2>/dev/null) ||
    refuse "A private launcher build directory is unavailable."
scratch=$(/usr/bin/mktemp -d "$private_tmp/graphgoblin-launcher.XXXXXXXX" 2>/dev/null) ||
    refuse "A private launcher build directory is unavailable."
case "$scratch" in
    "$private_tmp"/graphgoblin-launcher.*) ;;
    *) refuse "A private launcher build directory is unavailable." ;;
esac
cleanup() {
    if [ -d "$scratch" ] && [ ! -L "$scratch" ]; then
        /bin/rm -rf -- "$scratch"
    fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

/bin/mkdir "$scratch/home" "$scratch/config" "$scratch/cache" "$scratch/tmp" "$scratch/modules" ||
    refuse "A private launcher build directory is unavailable."

swift_build() {
    /usr/bin/env -i \
        HOME="$scratch/home" CFFIXED_USER_HOME="$scratch/home" TMPDIR="$scratch/tmp" \
        PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 \
        XDG_CACHE_HOME="$scratch/cache" XDG_CONFIG_HOME="$scratch/config" \
        SWIFTPM_MODULECACHE_OVERRIDE="$scratch/modules" CLANG_MODULE_CACHE_PATH="$scratch/modules" \
        /usr/bin/xcrun --sdk macosx swift build --arch arm64 --configuration release \
        --package-path "$checkout/apps/macos-launcher" --scratch-path "$scratch/build" \
        --cache-path "$scratch/cache" --config-path "$scratch/config" \
        -Xswiftc -module-cache-path -Xswiftc "$scratch/modules" "$@"
}

for product in GraphGoblin GraphGoblinLauncherInstaller; do
    swift_build --product "$product" >"$scratch/compiler.stdout" 2>"$scratch/compiler.stderr" ||
        refuse "The native launcher could not be compiled. Check the installed macOS developer tools."
done
bin_dir=$(swift_build --show-bin-path 2>"$scratch/compiler.stderr") ||
    refuse "The compiled launcher location could not be verified."
bin_dir=$(/bin/realpath "$bin_dir" 2>/dev/null) ||
    refuse "The compiled launcher location could not be verified."
case "$bin_dir" in "$scratch"/*) ;; *) refuse "The compiled launcher location could not be verified." ;; esac
if [ ! -x "$bin_dir/GraphGoblin" ] || [ -L "$bin_dir/GraphGoblin" ] ||
   [ ! -x "$bin_dir/GraphGoblinLauncherInstaller" ] || [ -L "$bin_dir/GraphGoblinLauncherInstaller" ]; then
    refuse "The compiled launcher files could not be verified."
fi

"$bin_dir/GraphGoblinLauncherInstaller" "$checkout" "$bin_dir/GraphGoblin" "$default_node" -- "$@"
