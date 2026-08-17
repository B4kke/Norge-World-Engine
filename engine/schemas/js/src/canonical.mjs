import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

export const CANONICALIZATION_ID = "urn:ietf:rfc:8785";
export const HASH_ALGORITHM = "sha-256";

export function canonicalText(value) {
  const text = canonicalize(value);
  if (text === undefined) {
    throw new TypeError("value cannot be serialized by RFC 8785/JCS");
  }
  return text;
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalText(value), "utf8");
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}
