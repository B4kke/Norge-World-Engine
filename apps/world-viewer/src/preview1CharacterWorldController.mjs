import { sampleHeightGrid } from '../../../engine/streaming/terrain_mesh_buffers.mjs';
import {
  createRenderOrigin,
  createWorldFrame,
  createWorldPosition,
} from '../../../engine/world/world_contract.mjs';
import {
  createCharacterWorldTransform,
  deriveCharacterRenderTransform,
  moveCharacterPlanar,
  setCharacterHeading,
  setCharacterWorldHeight,
} from '../../../engine/world/character_transform_contract.mjs';

export const PREVIEW1_CHARACTER_WORLD_FRAME = createWorldFrame({
  id: 'nwe.preview1.epsg25832-nn2000/0.1',
  horizontalCrs: 'EPSG:25832',
  verticalDatum: 'NN2000',
});

function assertTerrainPayload(payload) {
  const header = payload?.artifact?.header;
  const origin = payload?.mesh?.metadata?.origin;
  if (!header || !Array.isArray(header.bounds) || header.bounds.length !== 4) {
    throw new TypeError('PREVIEW1_CHARACTER_TERRAIN_HEADER_REQUIRED');
  }
  if (!payload?.elevations || !Array.isArray(origin) || origin.length !== 3) {
    throw new TypeError('PREVIEW1_CHARACTER_TERRAIN_GRID_REQUIRED');
  }
  return { header, origin };
}

function terrainHeight(payload, easting, northing) {
  const { header } = assertTerrainPayload(payload);
  const height = sampleHeightGrid(payload.elevations, {
    width: header.width,
    height: header.height,
    bounds: header.bounds,
    pixelSizeMeters: header.pixel_size_m,
    nodata: header.nodata,
    easting,
    northing,
  });
  if (!Number.isFinite(height)) throw new Error(`PREVIEW1_CHARACTER_GROUNDING_FAILED: ${easting},${northing}`);
  return height;
}

function positiveZero(value) {
  return value === 0 ? 0 : value;
}

export function atlasRenderTransformToThreePose(renderTransform) {
  if (!(renderTransform?.position instanceof Float32Array) || renderTransform.position.length !== 3) {
    throw new TypeError('ATLAS_RENDER_TRANSFORM_POSITION_REQUIRED');
  }
  const [east, north, up] = renderTransform.position;
  return Object.freeze({
    entityId: renderTransform.entityId,
    worldFrameId: renderTransform.worldFrameId,
    originSeriesId: renderTransform.originSeriesId,
    originEpoch: renderTransform.originEpoch,
    position: new Float32Array([
      positiveZero(east),
      positiveZero(up),
      positiveZero(-north),
    ]),
    headingRadians: renderTransform.headingRadians,
    coordinateAdapter: 'atlas-east-north-up -> three-east-up-minus-north',
  });
}

export function createPreview1CharacterWorldController({
  terrainPayload,
  entityId = 'player-1',
  headingRadians = 0,
  worldFrame = PREVIEW1_CHARACTER_WORLD_FRAME,
  renderOriginSeriesId = 'preview1-character-origin',
} = {}) {
  const { header, origin } = assertTerrainPayload(terrainPayload);
  const centerEasting = (header.bounds[0] + header.bounds[2]) / 2;
  const centerNorthing = (header.bounds[1] + header.bounds[3]) / 2;
  const initialHeight = terrainHeight(terrainPayload, centerEasting, centerNorthing);
  const renderOriginAnchor = createWorldPosition(worldFrame, {
    easting: Number(origin[0]),
    northing: Number(origin[1]),
    height: Number(origin[2]),
  });
  let renderOrigin = createRenderOrigin({
    worldFrame,
    originSeriesId: renderOriginSeriesId,
    epoch: 0,
    anchorWorld: renderOriginAnchor,
  });
  let transform = createCharacterWorldTransform({
    entityId,
    worldFrame,
    position: createWorldPosition(worldFrame, {
      easting: centerEasting,
      northing: centerNorthing,
      height: initialHeight,
    }),
    headingRadians,
  });

  function snapshot() {
    const renderTransform = deriveCharacterRenderTransform(worldFrame, transform, renderOrigin);
    return Object.freeze({
      schema: 'nwe.preview1-character-world-controller/0.1',
      worldFrame,
      worldTransform: transform,
      renderOrigin,
      threePose: atlasRenderTransformToThreePose(renderTransform),
      grounding: Object.freeze({ source: 'accepted-dtm-grid', verticalDatum: worldFrame.verticalDatum }),
    });
  }

  function groundCurrentTransform(nextTransform) {
    const groundedHeight = terrainHeight(
      terrainPayload,
      nextTransform.position.easting,
      nextTransform.position.northing,
    );
    return setCharacterWorldHeight(worldFrame, nextTransform, groundedHeight);
  }

  return {
    worldFrame,
    snapshot,
    setHeading(nextHeadingRadians) {
      transform = setCharacterHeading(worldFrame, transform, nextHeadingRadians);
      return snapshot();
    },
    move({ forwardMeters = 0, rightMeters = 0 } = {}) {
      const moved = moveCharacterPlanar(worldFrame, transform, { forwardMeters, rightMeters });
      transform = groundCurrentTransform(moved);
      return snapshot();
    },
    setRenderOrigin(nextRenderOrigin) {
      const previousTransform = transform;
      renderOrigin = nextRenderOrigin;
      const next = snapshot();
      if (transform !== previousTransform) throw new Error('PREVIEW1_CHARACTER_ORIGIN_MUTATED_WORLD_STATE');
      return next;
    },
    getWorldTransform() {
      return transform;
    },
    getRenderOrigin() {
      return renderOrigin;
    },
  };
}
