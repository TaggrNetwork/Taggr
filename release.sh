#!/bin/sh

mkdir -p ~/.config/dfx
cat <<EOF >~/.config/dfx/networks.json
{
  "local": {
    "bind": "127.0.0.1:8080",
    "type": "ephemeral",
    "replica": {
      "subnet_type": "system"
    }
  }
}
EOF
dfx start --clean --background
dfx nns install
dfx stop

make build
make start
dfx deploy
npm run test:e2e
OUTPUT=$(dfx canister call taggr prod_release)
if [ "$OUTPUT" != "(true)" ]; then
  echo "Error: dev feature is enabled!"
  exit 1
fi
dfx stop
