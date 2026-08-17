#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <raster>" >&2
  exit 64
fi

raster="$1"

if [[ ! -f "$raster" ]]; then
  echo "error: file not found: $raster" >&2
  exit 66
fi

if ! command -v gdalinfo >/dev/null 2>&1; then
  echo "error: gdalinfo is required" >&2
  exit 69
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$raster"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$raster"
else
  echo "warning: no sha256sum/shasum available" >&2
fi

printf '\n--- gdalinfo json ---\n'
gdalinfo -json "$raster"
