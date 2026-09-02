// Asset loading: Kenney GLB kits, one shared colormap texture per kit.
import * as THREE from 'three';
import { GLTFLoader } from 'three/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

const modelCache = new Map();   // "kit/name" -> THREE.Object3D prototype
const kitMaterial = new Map();  // kit -> { scenery, shiny }
const pending = new Map();

const BASE = new URL('../assets/', import.meta.url).href;

// Every asset URL the loaders have fetched, so the service worker can be told
// what to keep for offline play (see pwa.js).
const fetched = new Set();

export function assetUrls() {
  return [...fetched];
}

function kitTexture(kit) {
  const url = `${BASE}${kit}/Textures/colormap.png`;
  fetched.add(url);
  const tex = texLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
  return tex;
}

export function materialsFor(kit) {
  if (!kitMaterial.has(kit)) {
    const map = kitTexture(kit);
    kitMaterial.set(kit, {
      scenery: new THREE.MeshLambertMaterial({ map }),
      shiny: new THREE.MeshPhongMaterial({ map, shininess: 26, specular: 0x30363f }),
    });
  }
  return kitMaterial.get(kit);
}

/** Load a GLB and return the cached prototype (do not mutate — use instance()). */
export function loadModel(kit, name) {
  const key = `${kit}/${name}`;
  if (modelCache.has(key)) return Promise.resolve(modelCache.get(key));
  if (pending.has(key)) return pending.get(key);

  const p = new Promise((resolve, reject) => {
    const url = `${BASE}${kit}/${name}.glb`;
    fetched.add(url);
    gltfLoader.load(url, (gltf) => {
      const root = gltf.scene;
      root.userData.kit = kit;
      root.userData.name = name;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        // Kenney kits ship one atlas material; swap it for our shared one.
        o.material = materialsFor(kit).scenery;
      });
      modelCache.set(key, root);
      pending.delete(key);
      resolve(root);
    }, undefined, (err) => { pending.delete(key); reject(err); });
  });
  pending.set(key, p);
  return p;
}

/** A fresh, mutable copy of a loaded model. A model whose file failed to
 *  load yields an empty stand-in — preload already warned about it, and a
 *  missing prop must not hang the whole game on the loading screen. */
export function instance(kit, name) {
  const proto = modelCache.get(`${kit}/${name}`);
  if (!proto) {
    console.warn(`model not loaded: ${kit}/${name}`);
    const stub = new THREE.Group();
    stub.userData.kit = kit;
    stub.userData.name = name;
    return stub;
  }
  return proto.clone(true);
}
