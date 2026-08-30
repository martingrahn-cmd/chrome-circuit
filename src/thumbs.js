// One-off preview images for the menus: cars rendered in miniature, and the
// circuit shape traced from its centre line.
import * as THREE from 'three';
import { instance } from './assets.js';
import { Track } from './track.js';

/** Render each car spec into a transparent PNG data URL. */
export function carThumbnails(specs, width = 320, height = 200) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x39405a, 2.1));
  const key = new THREE.DirectionalLight(0xfff4e2, 2.0);
  key.position.set(4, 7, 5);
  scene.add(key);

  const view = 3.6;
  const aspect = width / height;
  const camera = new THREE.OrthographicCamera(-view * aspect / 2, view * aspect / 2, view / 2, -view / 2, 0.1, 100);
  camera.position.set(4.2, 3.1, 5.2);
  camera.lookAt(0, 0.35, 0);

  const out = new Map();
  for (const spec of specs) {
    const model = instance('cars', spec.model);
    model.rotation.y = -0.5;
    scene.add(model);
    renderer.render(scene, camera);
    out.set(spec.id, canvas.toDataURL('image/png'));
    scene.remove(model);
  }
  renderer.dispose();
  return out;
}

/** Trace a circuit outline onto a 2D canvas and return a data URL. */
export function trackThumbnail(def, width = 300, height = 170) {
  const track = new Track(def);
  const pts = track.line.pts;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  const pad = 16;
  const s = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxZ - minZ || 1));
  const ox = pad + (width - pad * 2 - (maxX - minX) * s) / 2 - minX * s;
  const oz = pad + (height - pad * 2 - (maxZ - minZ) * s) / 2 - minZ * s;

  g.beginPath();
  for (let i = 0; i <= pts.length; i++) {
    const p = pts[i % pts.length];
    const x = ox + p.x * s, y = oz + p.z * s;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.lineJoin = g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 11;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.62)';
  g.lineWidth = 2;
  g.setLineDash([5, 7]);
  g.stroke();
  g.setLineDash([]);

  const sp = pts[track.startIndex];
  g.fillStyle = '#ffcc32';
  g.beginPath();
  g.arc(ox + sp.x * s, oz + sp.z * s, 4.5, 0, Math.PI * 2);
  g.fill();

  return canvas.toDataURL('image/png');
}
