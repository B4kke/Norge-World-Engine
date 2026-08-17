from nwe_compiler.canonical import canonical_bytes, canonical_sha256

VECTOR = {"z": "Norway", "a": [3, 2, 1], "nested": {"b": None, "a": True}}
EXPECTED = b'{"a":[3,2,1],"nested":{"a":true,"b":null},"z":"Norway"}'
EXPECTED_SHA256 = "c07d22a67375e5c21919a32cf4f0bdead461e135dbd18bf60139dd79ba57e96d"


def test_rfc8785_vector():
    assert canonical_bytes(VECTOR) == EXPECTED
    assert canonical_sha256(VECTOR) == EXPECTED_SHA256
