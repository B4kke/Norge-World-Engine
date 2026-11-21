import base64
import struct
import unittest

from generate_trellis_asset import (
    SCHEMA,
    build_manifest,
    decode_first_artifact,
    is_loopback_endpoint,
    validate_glb,
)


def glb_fixture(payload=b""):
    total = 12 + len(payload)
    return struct.pack("<4sII", b"glTF", 2, total) + payload


class TrellisAssetContractTests(unittest.TestCase):
    def test_glb_header_and_manifest_truth_guard(self):
        glb = glb_fixture(b"fixture")
        info = validate_glb(glb)
        self.assertEqual(info["glb_version"], 2)
        manifest = build_manifest(
            glb=glb,
            output_name="asset.glb",
            prompt="generic Norwegian roadside cabinet",
            seed=7,
            role="roadside-prop",
            endpoint="http://127.0.0.1:8000/v1/infer",
        )
        self.assertEqual(manifest["schema"], SCHEMA)
        self.assertFalse(manifest["truth"]["geographic_source_truth"])
        self.assertFalse(manifest["admission"]["runtime_ready"])
        self.assertEqual(manifest["generator"]["model"], "microsoft/trellis")

    def test_response_decode(self):
        glb = glb_fixture()
        decoded = decode_first_artifact({"artifacts": [{"base64": base64.b64encode(glb).decode()}]})
        self.assertEqual(decoded, glb)

    def test_rejects_malformed_glb(self):
        with self.assertRaisesRegex(ValueError, "MAGIC"):
            validate_glb(struct.pack("<4sII", b"NOPE", 2, 12))
        with self.assertRaisesRegex(ValueError, "LENGTH"):
            validate_glb(struct.pack("<4sII", b"glTF", 2, 99))

    def test_endpoint_is_loopback_only(self):
        self.assertTrue(is_loopback_endpoint("http://127.0.0.1:8000/v1/infer"))
        self.assertTrue(is_loopback_endpoint("http://localhost:8000/v1/infer"))
        self.assertFalse(is_loopback_endpoint("https://integrate.api.nvidia.com/v1/infer"))


if __name__ == "__main__":
    unittest.main()
