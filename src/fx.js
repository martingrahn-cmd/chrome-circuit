// Particles and skid marks. Everything is pooled: one Points cloud and one
// InstancedMesh, so the whole effects layer costs two draw calls.
import * as THREE from 'three';

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const MAX = 700;

const VERT = `
attribute float size;
attribute float alpha;
varying vec3 vColour;
varying float vAlpha;
uniform float pxPerUnit;
void main() {
  vColour = color;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, size * pxPerUnit);
}`;

const FRAG = `
uniform sampler2D map;
varying vec3 vColour;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  if (t.a < 0.01 || vAlpha <= 0.0) discard;
  gl_FragColor = vec4(vColour, t.a * vAlpha);
}`;

/** One pooled point cloud. Two of these (soft + additive) cover every effect. */
class Cloud {
  constructor(scene, texture, additive) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.siz = new Float32Array(MAX);
    this.alp = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.rise = new Float32Array(MAX);
    this.base = new Float32Array(MAX);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.siz, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alp, 1));
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, pxPerUnit: { value: 20 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  emit(x, y, z, o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    const v = o.velocity || [0, 0, 0];
    this.vel[i3] = v[0]; this.vel[i3 + 1] = v[1]; this.vel[i3 + 2] = v[2];
    const c = o.colour || [1, 1, 1];
    this.col[i3] = c[0]; this.col[i3 + 1] = c[1]; this.col[i3 + 2] = c[2];
    this.siz[i] = o.size ?? 1;
    this.base[i] = o.opacity ?? 0.85;
    this.alp[i] = this.base[i];
    this.life[i] = this.maxLife[i] = o.life ?? 0.7;
    this.drag[i] = o.drag ?? 1.8;
    this.grow[i] = o.grow ?? 1.4;
    this.rise[i] = o.rise ?? 1.2;
  }

  update(dt) {
    const { pos, vel, life, maxLife, siz, alp, base, drag, grow, rise } = this;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) { alp[i] = 0; continue; }
      life[i] -= dt;
      const i3 = i * 3;
      const d = Math.exp(-drag[i] * dt);
      vel[i3] *= d; vel[i3 + 2] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d + rise[i] * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = Math.max(0, life[i] / maxLife[i]);
      siz[i] *= 1 + grow[i] * dt;
      alp[i] = base[i] * t * t;
      if (life[i] <= 0) alp[i] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene) {
    const tex = softDot();
    this.soft = new Cloud(scene, tex, false);
    this.glow = new Cloud(scene, tex, true);
  }

  /** Orthographic cameras need an explicit world-units-to-pixels factor. */
  setScale(pixelHeight, viewSize) {
    const k = pixelHeight / viewSize;
    this.soft.mat.uniforms.pxPerUnit.value = k;
    this.glow.mat.uniforms.pxPerUnit.value = k;
  }

  emit(x, y, z, o = {}) { (o.glow ? this.glow : this.soft).emit(x, y, z, o); }

  burst(x, y, z, n, o = {}) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (o.spread ?? 6) * (0.35 + Math.random());
      this.emit(x, y, z, {
        ...o,
        velocity: [Math.cos(a) * s, (o.up ?? 3) * Math.random(), Math.sin(a) * s],
        size: (o.size ?? 1) * (0.6 + Math.random() * 0.8),
        life: (o.life ?? 0.7) * (0.6 + Math.random() * 0.7),
      });
    }
  }

  update(dt) { this.soft.update(dt); this.glow.update(dt); }
}

const SKIDS = 700;

export class SkidMarks {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(0.28, 0.9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1f, transparent: true, opacity: 0.42, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, SKIDS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.dummy = new THREE.Object3D();
    this.cursor = 0;
    this.age = new Float32Array(SKIDS).fill(999);
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SKIDS; i++) this.mesh.setMatrixAt(i, this.hidden);
    scene.add(this.mesh);
  }

  add(x, z, heading, width = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SKIDS;
    this.dummy.position.set(x, 0.185, z);
    this.dummy.rotation.set(0, heading, 0);
    this.dummy.scale.set(width, 1, 1);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.age[i] = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < SKIDS; i++) {
      if (this.age[i] > 9) continue;
      this.age[i] += dt;
      if (this.age[i] > 9) { this.mesh.setMatrixAt(i, this.hidden); dirty = true; }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export const DUST = {
  road: [0.72, 0.72, 0.76],
  kerb: [0.70, 0.70, 0.73],
  dirt: [0.66, 0.55, 0.38],
};
