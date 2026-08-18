# World Viewer Preview 1

Default route: real compiled Nannestad Preview 1.

The viewer attempts the content-addressed manifest at the `preview-runtime` transport branch and fails closed if the snapshot is missing or invalid. Override only for controlled QA with:

`?previewManifest=<absolute-or-relative-manifest-url>`

The previous Forsøk 18 synthetic structural terrain harness remains available explicitly at:

`?lab=terrain`

Preview 1 does not allow raw Kartverket, NVDB, OSM or Overpass acquisition in the browser. All visible world data must arrive as RuntimeVerificationBundle + compiled artifact pairs and pass full provenance/byte verification before use.
