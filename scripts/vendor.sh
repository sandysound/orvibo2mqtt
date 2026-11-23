#!/bin/sh
# Refresh the vendored copy of orvibo-b25-server from a sibling checkout.
set -e
SRC="${1:-../orvibo-b25-server}"
DEST="$(dirname "$0")/../vendor/orvibo-b25-server"
for f in index.js Orvibo.js OrviboPacket.js OrviboSettings.js PacketBuilder.js Utils.js LICENSE package.json; do
  cp "$SRC/$f" "$DEST/$f"
done
echo "Vendored orvibo-b25-server $(node -p "require('$SRC/package.json').version") from $SRC"
