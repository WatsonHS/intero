#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tls_dir="${INTERO_SPICEDB_TLS_DIR:-$repo_root/.intero-production}"
ca_key="$tls_dir/spicedb-ca.key"
ca_cert="$tls_dir/spicedb-ca.crt"
server_key="$tls_dir/spicedb-server.key"
server_cert="$tls_dir/spicedb-server.crt"

for target in "$ca_key" "$ca_cert" "$server_key" "$server_cert"; do
  if [[ -e "$target" ]]; then
    echo "Refusing to overwrite existing SpiceDB TLS material: $target" >&2
    exit 1
  fi
done

command -v openssl >/dev/null 2>&1 || {
  echo "OpenSSL is required to generate SpiceDB TLS material." >&2
  exit 1
}

mkdir -p "$tls_dir"
chmod 700 "$tls_dir"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/intero-spicedb-tls.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

openssl req \
  -x509 \
  -newkey rsa:3072 \
  -sha256 \
  -days 825 \
  -nodes \
  -keyout "$work_dir/ca.key" \
  -out "$work_dir/ca.crt" \
  -subj "/CN=Intero SpiceDB Internal CA"

openssl req \
  -newkey rsa:3072 \
  -sha256 \
  -nodes \
  -keyout "$work_dir/server.key" \
  -out "$work_dir/server.csr" \
  -subj "/CN=spicedb"

printf '%s\n' \
  "[server_cert]" \
  "basicConstraints=critical,CA:FALSE" \
  "keyUsage=critical,digitalSignature,keyEncipherment" \
  "extendedKeyUsage=serverAuth" \
  "subjectAltName=DNS:spicedb" \
  >"$work_dir/server.ext"

openssl x509 \
  -req \
  -sha256 \
  -days 397 \
  -in "$work_dir/server.csr" \
  -CA "$work_dir/ca.crt" \
  -CAkey "$work_dir/ca.key" \
  -CAcreateserial \
  -extfile "$work_dir/server.ext" \
  -extensions server_cert \
  -out "$work_dir/server.crt"

openssl verify -CAfile "$work_dir/ca.crt" "$work_dir/server.crt"
openssl x509 -in "$work_dir/server.crt" -checkend 2592000 -noout

install -m 600 "$work_dir/ca.key" "$ca_key"
install -m 644 "$work_dir/ca.crt" "$ca_cert"
install -m 600 "$work_dir/server.key" "$server_key"
install -m 644 "$work_dir/server.crt" "$server_cert"

echo "Generated SpiceDB TLS material in $tls_dir"
echo "Back up spicedb-ca.key securely; containers mount only the CA certificate and server keypair."
