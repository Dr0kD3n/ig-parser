#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

case "$(uname -m)" in
    arm64) executable="ig-bot-macos-arm64" ;;
    x86_64) executable="ig-bot-macos-x64" ;;
    *)
        echo "Unsupported macOS architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

chmod +x "$executable"
codesign --force --sign - "$executable"
exec "./$executable"
