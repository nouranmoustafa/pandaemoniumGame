import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { glowTexture, leafTexture } from './Textures';

interface Leaf {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  scale: number;
}

/**
 * Tumbling dead leaves and drifting pale motes. Both recycle around a focus
 * point so the volume of particles stays constant.
 */
export class Particles {
  readonly group = new THREE.Group();
  private leaves: Leaf[] = [];
  private leafMesh: THREE.InstancedMesh;
  private motes: THREE.Points;
  private motePhase: Float32Array;
  private rand = mulberry32(8);
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  /** Extra wind push, raised by the Demon for gusts. */
  gust = 0;

  constructor(count = 180) {
    const mat = new THREE.MeshStandardMaterial({
      map: leafTexture(),
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    this.leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.22), mat, count);
    this.leafMesh.frustumCulled = false;
    this.leafMesh.castShadow = true;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.leaves.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(this.rand() * 6, this.rand() * 6, this.rand() * 6),
        spin: new THREE.Vector3(this.rand() * 4 - 2, this.rand() * 4 - 2, this.rand() * 4 - 2),
        scale: 0.6 + this.rand() * 0.8,
      });
      this.respawn(this.leaves[i], 0, true);
      c.setHSL(0.03 + this.rand() * 0.07, 0.5, 0.18 + this.rand() * 0.15);
      this.leafMesh.setColorAt(i, c);
    }
    this.group.add(this.leafMesh);

    const moteCount = 260;
    const pos = new Float32Array(moteCount * 3);
    this.motePhase = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      pos[i * 3] = this.rand() * 90 - 30;
      pos[i * 3 + 1] = this.rand() * 7;
      pos[i * 3 + 2] = this.rand() * 30 - 22;
      this.motePhase[i] = this.rand() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.14,
        map: glowTexture('rgba(210,220,255,1)'),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xc8d0ff,
      }),
    );
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  private respawn(l: Leaf, focusX: number, initial: boolean): void {
    const r = this.rand;
    l.pos.set(focusX + (initial ? r() * 80 - 25 : 30 + r() * 30), initial ? r() * 9 : 4 + r() * 8, r() * 26 - 18);
    l.vel.set(-1.5 - r() * 2, -0.5 - r() * 0.6, r() * 0.6 - 0.3);
  }

  update(dt: number, focusX: number): void {
    const t = performance.now() * 0.001;
    this.leaves.forEach((l, i) => {
      const flutter = Math.sin(t * 3 + i) * 0.8;
      l.vel.x += (-2.2 - this.gust * 6 - l.vel.x) * dt * 0.8;
      l.vel.y += (-0.7 + flutter * 0.6 - l.vel.y) * dt * 1.5;
      l.pos.addScaledVector(l.vel, dt);
      l.pos.z += Math.cos(t * 1.7 + i) * dt * 0.5;
      l.rot.x += l.spin.x * dt;
      l.rot.y += l.spin.y * dt;
      l.rot.z += l.spin.z * dt;
      if (l.pos.y < 0.03) {
        // Rest on the ground briefly, then lift again.
        l.pos.y = 0.03;
        l.vel.y = 0;
      }
      if (l.pos.x < focusX - 30 || l.pos.x > focusX + 70) this.respawn(l, focusX, false);
      this.q.setFromEuler(l.rot);
      this.s.setScalar(l.scale);
      this.tmp.compose(l.pos, this.q, this.s);
      this.leafMesh.setMatrixAt(i, this.tmp);
    });
    this.leafMesh.instanceMatrix.needsUpdate = true;

    const attr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    for (let i = 0; i < this.motePhase.length; i++) {
      const ph = this.motePhase[i];
      a[i * 3] += (Math.sin(t * 0.4 + ph) * 0.3 - 0.25 - this.gust * 3) * dt;
      a[i * 3 + 1] += Math.cos(t * 0.6 + ph) * 0.15 * dt;
      if (a[i * 3] < focusX - 30) a[i * 3] += 95;
      if (a[i * 3] > focusX + 65) a[i * 3] -= 95;
    }
    attr.needsUpdate = true;
  }
}
