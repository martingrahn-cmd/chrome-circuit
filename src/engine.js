// Renderer, isometric orthographic camera and lighting.
import * as THREE from 'three';

// Isometric-ish: 45 degrees around, ~44 degrees up. Steep enough that street
// furniture rarely hides the cars, shallow enough to still read as isometric.
export const ISO_DIR = new THREE.Vector3(1, 1.35 * Math.SQRT2, 1).normalize();

export class Engine {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fd0e8);
    this.scene.fog = new THREE.Fog(0x8fd0e8, 150, 320);

    this.viewSize = 37;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
    this.target = new THREE.Vector3();
    this.camShake = 0;

    this.hemi = new THREE.HemisphereLight(0xcfe9ff, 0x4a5a48, 1.35);
    this.scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.02;
    const s = sun.shadow.camera;
    s.near = 1; s.far = 260;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Per-track mood: hemisphere tint and sun strength. */
  setLighting(light = {}) {
    this.hemi.color.set(light.hemiSky ?? 0xcfe9ff);
    this.hemi.groundColor.set(light.hemiGround ?? 0x4a5a48);
    this.hemi.intensity = light.hemi ?? 1.35;
    this.sun.color.set(light.sun ?? 0xfff2d8);
    this.sun.intensity = light.sunPower ?? 1.9;
  }

  setSky(skyColor, fogNear = 150, fogFar = 320) {
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, fogNear, fogFar);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    // Re-read DPR: it changes when the window moves between displays or the
    // browser zooms, and both arrive here as a resize event.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.updateProjection();
  }

  updateProjection() {
    const c = this.camera, v = this.viewSize / 2, a = this.aspect;
    c.left = -v * a; c.right = v * a; c.top = v; c.bottom = -v;
    c.updateProjectionMatrix();
  }

  setZoom(viewSize) {
    if (Math.abs(viewSize - this.viewSize) < 0.01) return;
    this.viewSize = viewSize;
    this.updateProjection();
  }

  /** Point the camera at a world position (isometric offset stays fixed). */
  look(x, y, z) {
    this.target.set(x, y, z);
    const shake = this.camShake;
    const off = ISO_DIR.clone().multiplyScalar(220);
    this.camera.position.set(
      this.target.x + off.x + (Math.random() - 0.5) * shake,
      this.target.y + off.y,
      this.target.z + off.z + (Math.random() - 0.5) * shake,
    );
    this.camera.lookAt(this.target);

    const sunOff = new THREE.Vector3(58, 96, 44);
    this.sun.position.copy(this.target).add(sunOff);
    this.sun.target.position.copy(this.target);
    const r = this.viewSize * 0.95;
    const s = this.sun.shadow.camera;
    s.left = -r; s.right = r; s.top = r; s.bottom = -r;
    s.updateProjectionMatrix();
  }

  shake(amount) { this.camShake = Math.min(2.2, this.camShake + amount); }

  decayShake(dt) { this.camShake = Math.max(0, this.camShake - dt * 4); }

  render() { this.renderer.render(this.scene, this.camera); }
}
