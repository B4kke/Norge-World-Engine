from __future__ import annotations

import hashlib
from typing import Any

import rfc8785

CANONICALIZATION_ID = "urn:ietf:rfc:8785"
HASH_ALGORITHM = "sha-256"


def canonical_bytes(value: Any) -> bytes:
    """Serialize a JSON-compatible value using RFC 8785 / JCS."""
    return rfc8785.dumps(value)


def canonical_sha256(value: Any) -> str:
    """Return SHA-256 over RFC 8785 canonical bytes."""
    return hashlib.sha256(canonical_bytes(value)).hexdigest()
