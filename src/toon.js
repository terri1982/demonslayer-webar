import * as THREE from 'three';
import { MToonMaterial } from '@pixiv/three-vrm-materials-mtoon';

// Preserve original textures, UVs, skinning, and morph targets in MToon pass (Three.js r165).
export function createToonVariants(root) {
  const cache = new Map();
  const meshes = [];
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const original = mesh.material;
    const convert = source => {
      if (cache.has(source)) return cache.get(source);
      const material = new MToonMaterial({
        name: `${source.name} · MToon`,
        color: source.color?.clone() ?? new THREE.Color(1, 1, 1),
        map: source.map ?? null,
        normalMap: source.normalMap ?? null,
        normalScale: source.normalScale?.clone() ?? new THREE.Vector2(1, 1),
        emissive: source.emissive?.clone() ?? new THREE.Color(0, 0, 0),
        emissiveMap: source.emissiveMap ?? null,
        emissiveIntensity: (source.emissiveIntensity ?? 1) * 0.3,
        shadeColorFactor: new THREE.Color(0.64, 0.64, 0.64),
        shadeMultiplyTexture: source.map ?? null,
        shadingToonyFactor: 0.9,
        shadingShiftFactor: 0,
        giEqualizationFactor: 0.8,
        outlineWidthMode: 'none',
        side: source.side,
        transparent: source.transparent,
        opacity: source.opacity,
        alphaTest: source.alphaTest,
        depthWrite: source.depthWrite,
        depthTest: source.depthTest,
        visible: source.visible,
        vertexColors: source.vertexColors,
        ignoreVertexColor: !source.vertexColors,
        fog: true,
      });
      material.userData.sourceMaterial = source.name;
      patchRGBA(material);
      cache.set(source, material);
      return material;
    };
    meshes.push({
      mesh,
      toon: Array.isArray(original) ? original.map(convert) : convert(original),
    });
  });

  let outlines = true;
  for (const item of meshes) {
    const sourceMaterials = Array.isArray(item.toon) ? item.toon : [item.toon];
    const materials = sourceMaterials.map(source => {
      const material = source.clone();
      material.name = `${source.name} · outline`;
      material.isOutline = true;
      material.side = THREE.BackSide;
      material.outlineWidthMode = 'worldCoordinates';
      material.outlineWidthFactor = 0.002;
      material.outlineColorFactor.setRGB(0.025, 0.018, 0.035);
      material.outlineLightingMixFactor = 0;
      patchRGBA(material);
      return material;
    });
    const outline = item.mesh.clone(false);
    outline.name = `${item.mesh.name} · outline`;
    outline.material = Array.isArray(item.toon) ? materials : materials[0];
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.visible = false;
    outline.morphTargetInfluences = item.mesh.morphTargetInfluences;
    item.mesh.parent.add(outline);
    item.outline = outline;
  }

  return {
    materials: [...cache.values()],
    setOutlines(value) {
      outlines = value;
    },
    apply() {
      for (const item of meshes) {
        item.mesh.material = item.toon;
        item.mesh.castShadow = false;
        item.mesh.receiveShadow = false;
        item.outline.visible = outlines;
      }
    },
    update(delta) {
      for (const material of cache.values()) material.update(delta);
    },
  };
}

function patchRGBA(material) {
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replaceAll('*= vColor;', '*= vColor.rgb;');
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)},rgba-r165`;
}
