#!/usr/bin/env bash
set -euo pipefail

# Idempotent: keep an already-imported identity as-is.
if icp identity list --quiet | grep -qx "local-minter"; then
  exit 0
fi

PEM=$(mktemp)
trap 'rm -f "$PEM"' EXIT

cat <<EOF >"$PEM"
-----BEGIN EC PRIVATE KEY-----
MHQCAQEEICJxApEbuZznKFpV+VKACRK30i6+7u5Z13/DOl18cIC+oAcGBSuBBAAK
oUQDQgAEPas6Iag4TUx+Uop+3NhE6s3FlayFtbwdhRVjvOar0kPTfE/N8N6btRnd
74ly5xXEBNSXiENyxhEuzOZrIWMCNQ==
-----END EC PRIVATE KEY-----
EOF

icp identity import local-minter --from-pem "$PEM" --storage plaintext
