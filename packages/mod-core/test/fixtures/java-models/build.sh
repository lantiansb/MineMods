#!/bin/sh
# Rebuilds the compiled fixtures from src/. The .class files are committed so tests need no JDK.
set -e
cd "$(dirname "$0")"
rm -rf classes && mkdir -p classes
build() { out=classes/$1; shift; mkdir -p "$out"; cp=$1; shift; javac -nowarn -g:none --release 17 -d "$out" ${cp:+-cp "$cp"} $(find "$@" -name '*.java'); }
build game-mojmap "" src/mojmap
build game-vanilla classes/game-mojmap src/vanilla-mojmap
build mod-mojmap classes/game-mojmap:classes/game-vanilla src/mod-mojmap
build game-intermediary "" src/intermediary
build mod-fabric classes/game-intermediary src/mod-fabric
build game-legacy "" src/legacy
build mod-legacy classes/game-legacy src/mod-legacy
