import { Cesium3DTileset, Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";

const params = new URLSearchParams(location.search);
const tilesetUrl = params.get("tileset");
const metricsNode = document.querySelector("#metrics");

const state = {
  startedAt: performance.now(),
  tilesLoaded: 0,
  tilesUnloaded: 0,
  pendingRequests: 0,
  processingTiles: 0,
  initialTilesLoadedMs: null,
  lastFailure: null,
};

function renderMetrics() {
  metricsNode.textContent = JSON.stringify(
    {
      tilesetUrl,
      ...state,
      elapsedMs: Math.round((performance.now() - state.startedAt) * 10) / 10,
    },
    null,
    2,
  );
}

const viewer = new Viewer("cesiumContainer", {
  baseLayerPicker: false,
  baseLayer: false,
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
});
viewer.scene.globe.show = false;

if (!tilesetUrl) {
  renderMetrics();
} else {
  const tileset = await Cesium3DTileset.fromUrl(tilesetUrl, {
    maximumScreenSpaceError: 16,
  });
  viewer.scene.primitives.add(tileset);

  tileset.loadProgress.addEventListener((pending, processing) => {
    state.pendingRequests = pending;
    state.processingTiles = processing;
    renderMetrics();
  });
  tileset.tileLoad.addEventListener(() => {
    state.tilesLoaded += 1;
    renderMetrics();
  });
  tileset.tileUnload.addEventListener(() => {
    state.tilesUnloaded += 1;
    renderMetrics();
  });
  tileset.tileFailed.addEventListener(({ url, message }) => {
    state.lastFailure = { url, message };
    renderMetrics();
  });
  tileset.initialTilesLoaded.addEventListener(() => {
    state.initialTilesLoadedMs = Math.round((performance.now() - state.startedAt) * 10) / 10;
    renderMetrics();
  });

  await viewer.zoomTo(tileset);
  renderMetrics();
}
