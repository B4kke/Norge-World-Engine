# apps/world-viewer

Minimal browser/runtime consumer boundary for Norge World Engine.

Prototype 0 viewer code must consume **compiled artifacts**, never NVDB/OSM/Kartverket source APIs during normal runtime. `artifact_consumer.mjs` implements the first dependency-free browser gate for JSON runtime artifacts:

- fetch the runtime bundle;
- reject raw-source transport references before a second network request;
- fetch the compiled artifact only;
- verify byte size and SHA-256 with Web Crypto;
- parse the artifact after verification.

```js
import { loadCompiledJsonArtifact } from "./artifact_consumer.mjs";

const roads = await loadCompiledJsonArtifact({
  bundleUrl: "/runtime/nannestad/roads.bundle.json",
  expectedRole: "road-network",
});
```

The browser gate does not replace `engine/streaming/runtime_verifier.mjs`, which reconstructs the complete RFC 8785 provenance chain. Packaging/deployment should expose only a previously validated bundle + compiled artifact set. Renderer selection remains open; this consumer boundary is intentionally renderer-independent.

Regression:

```bash
node apps/world-viewer/test_artifact_consumer.mjs
```

The regression proves the happy path performs only bundle + compiled-artifact requests and that an NVDB/raw-source transport is rejected before any raw-source fetch occurs.
