import assert from "node:assert/strict";
import { canonicalSha256, canonicalText } from "../src/canonical.mjs";

const input = { z: "Norway", a: [3, 2, 1], nested: { b: null, a: true } };
const expected = '{"a":[3,2,1],"nested":{"a":true,"b":null},"z":"Norway"}';
const expectedSha = "c07d22a67375e5c21919a32cf4f0bdead461e135dbd18bf60139dd79ba57e96d";

assert.equal(canonicalText(input), expected);
assert.equal(canonicalSha256(input), expectedSha);
console.log(JSON.stringify({ status: "PASS", expectedSha }));
