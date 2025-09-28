#!/bin/bash

POCKET_IC_VERSION="10.0.0"

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  PLATFORM=linux
elif [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM=darwin
else
  echo "Unsupported platform $OSTYPE"
  echo "Install PocketIC manually"
  exit 1
fi

# Detect architecture
ARCH=$(uname -m)
if [[ "$ARCH" == "aarch64" ]] || [[ "$ARCH" == "arm64" ]]; then
  ARCH="arm64"
elif [[ "$ARCH" == "x86_64" ]]; then
  ARCH="x86_64"
else
  echo "Unsupported architecture $ARCH"
  echo "Install PocketIC manually"
  exit 1
fi

curl -Ls https://github.com/dfinity/pocketic/releases/download/${POCKET_IC_VERSION}/pocket-ic-${ARCH}-${PLATFORM}.gz -o pocket-ic.gz || exit 1

gunzip -f pocket-ic.gz
chmod +x pocket-ic

if [[ "$OSTYPE" == "darwin"* ]]; then
  xattr -dr com.apple.quarantine pocket-ic
fi

export POCKET_IC_BIN=$(pwd)/pocket-ic
