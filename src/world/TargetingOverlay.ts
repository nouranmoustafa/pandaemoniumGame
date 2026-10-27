import * as THREE from 'three';
import { LANES } from '../config';
import type { Pavement } from './Pavement';

const SEGS = 48;

let softTex: THREE.Texture | null = null;
function softEdge(): THREE.Texture {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.82, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

/** A strip laid on the (moving) pavement surface between two X positions. */
class SurfaceStrip {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  private geo = new THREE.BufferGeometry();

  constructor(color: number, blending: THREE.Blending = THREE.AdditiveBlending) {
    const pos = new Float32Array((SEGS + 1) * 2 * 3);
    const uv = new Float32Array((SEGS + 1) * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i <= SEGS; i++) {
      uv.set([0, i / SEGS, 1, i / SEGS], i * 4);
      if (i < SEGS) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      color,
      map: softEdge(),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  set(pav: Pavement, x0: number, x1: number, zc: number, width: number, lift = 0.07): void {
    const a = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let i = 0; i <= SEGS; i++) {
      const x = x0 + ((x1 - x0) * i) / SEGS;
      const z0 = zc - width / 2;
      const z1 = zc + width / 2;
      arr.set([x, pav.heightAt(x, z0) + lift, z0, x, pav.heightAt(x, z1) + lift, z1], i * 6);
    }
    a.needsUpdate = true;
  }
}

/**
 * What the Demon player sees while aiming: the reachable stretch of each lane,
 * and the selected power's footprint under the cursor — pale when it can be
 * cast there, dull red when it can't.
 */
export class TargetingOverlay {
  readonly group = new THREE.Group();
  private lanes: SurfaceStrip[] = [];
  private footprint = new SurfaceStrip(0xf3d9a8, THREE.NormalBlending);
  private arrow: THREE.Mesh;
  private pulse: THREE.Mesh;
  private pulseT = -1;
  private time = 0;

  constructor() {
    for (let i = 0; i < 3; i++) {
      const s = new SurfaceStrip(0xb8a4d8);
      this.lanes.push(s);
      this.group.add(s.mesh);
    }
    this.group.add(this.footprint.mesh);
    // Chevron showing which way a gust will push.
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, -0.35);
    shape.lineTo(0, 0.35);
    shape.lineTo(0.5, -0.35);
    shape.lineTo(0.3, -0.35);
    shape.lineTo(0, 0.05);
    shape.lineTo(-0.3, -0.35);
    this.arrow = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0xf3d9a8, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.renderOrder = 6;
    this.group.add(this.arrow);
    // Activation pulse.
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xf3d9a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.pulse.rotation.x = -Math.PI / 2;
    this.group.add(this.pulse);
    this.group.visible = false;
  }

  /** Show reachable lanes between near and far X. */
  showRange(pav: Pavement, near: number, far: number): void {
    this.group.visible = true;
    this.lanes.forEach((s, i) => {
      s.mesh.visible = true;
      s.set(pav, near, far, LANES[i], 2.2, 0.05);
      s.mat.opacity = 0.42 + 0.08 * Math.sin(this.time * 3 + i);
    });
  }

  /** Footprint preview under the cursor. */
  showFootprint(pav: Pavement, x: number, lane: number, halfLength: number, valid: boolean, windDir: number | null): void {
    this.footprint.mesh.visible = true;
    this.footprint.set(pav, x - halfLength, x + halfLength, LANES[lane], 2.3, 0.09);
    this.footprint.mat.color.setHex(valid ? 0xffe6b0 : 0xa01828);
    this.footprint.mat.opacity = valid ? 0.75 + 0.2 * Math.sin(this.time * 8) : 0.7;
    this.arrow.visible = windDir !== null;
    if (windDir !== null) {
      this.arrow.position.set(x, pav.heightAt(x, LANES[lane]) + 0.12, LANES[lane] - windDir * 1.6);
      this.arrow.rotation.z = windDir > 0 ? Math.PI : 0;
      (this.arrow.material as THREE.MeshBasicMaterial).color.setHex(valid ? 0xf3d9a8 : 0x9a2030);
    }
  }

  hideFootprint(): void {
    this.footprint.mesh.visible = false;
    this.arrow.visible = false;
  }

  hide(): void {
    this.lanes.forEach((s) => (s.mesh.visible = false));
    this.hideFootprint();
    if (this.pulseT < 0) this.group.visible = false;
  }

  /** A ring that blooms where a power was just cast. */
  confirm(pav: Pavement, x: number, lane: number): void {
    this.group.visible = true;
    this.pulseT = 0;
    this.pulse.position.set(x, pav.heightAt(x, LANES[lane]) + 0.1, LANES[lane]);
  }

  update(dt: number): void {
    this.time += dt;
    const m = this.pulse.material as THREE.MeshBasicMaterial;
    if (this.pulseT >= 0) {
      this.pulseT += dt;
      const k = this.pulseT / 0.7;
      this.pulse.scale.setScalar(0.5 + k * 3);
      m.opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) this.pulseT = -1;
    } else {
      m.opacity = 0;
    }
  }
}
