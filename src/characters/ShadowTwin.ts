import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GeneratedCharacter } from './GeneratedCharacter';

interface Snapshot {
  t: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  bones: Float32Array;
  morph: Float32Array;
}

/**
 * An invisible copy of a character that only casts her shadow. Normally it
 * mirrors her exactly; with `lag` > 0 it replays her pose from that many
 * seconds ago, so her shadow moves a fraction of a second after she does.
 */
export class ShadowTwin {
  readonly object: THREE.Object3D;
  lag = 0;
  private bones: THREE.Bone[] = [];
  private headMesh: THREE.Mesh | null = null;
  private history: Snapshot[] = [];
  private time = 0;
  private active = false;

  constructor(private source: GeneratedCharacter) {
    this.object = cloneSkinned(source.object);
    const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const byName = new Map<string, THREE.Bone>();
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = hidden;
        m.castShadow = true;
        m.receiveShadow = false;
        m.frustumCulled = false;
        if (m.morphTargetInfluences) this.headMesh = m;
      }
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });
    this.bones = source.rig.list.map((b) => byName.get(b.name)!);
    for (let i = 0; i < 90; i++) this.history.push({ t: -1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), bones: new Float32Array(this.bones.length * 7), morph: new Float32Array(8) });
    this.setActive(false);
  }

  /** While active, the twin casts her shadow instead of her. */
  setActive(v: boolean): void {
    this.active = v;
    this.object.visible = v;
    this.source.setCastShadow(!v);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    // Record this frame (ring buffer).
    const snap = this.history.pop()!;
    snap.t = this.time;
    snap.pos.copy(this.source.object.position);
    snap.quat.copy(this.source.object.quaternion);
    const src = this.source.rig.list;
    for (let i = 0; i < src.length; i++) {
      const b = src[i];
      b.position.toArray(snap.bones, i * 7);
      b.quaternion.toArray(snap.bones, i * 7 + 3);
    }
    const mi = this.source.head.head.morphTargetInfluences!;
    for (let i = 0; i < mi.length; i++) snap.morph[i] = mi[i];
    this.history.unshift(snap);
    // Replay the frame closest to `lag` seconds ago.
    const want = this.time - this.lag;
    let pick = this.history[0];
    for (const s of this.history) {
      if (s.t < 0) break;
      pick = s;
      if (s.t <= want) break;
    }
    this.object.position.copy(pick.pos);
    this.object.quaternion.copy(pick.quat);
    this.object.scale.copy(this.source.object.scale);
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.fromArray(pick.bones, i * 7);
      this.bones[i].quaternion.fromArray(pick.bones, i * 7 + 3);
    }
    if (this.headMesh?.morphTargetInfluences) for (let i = 0; i < this.headMesh.morphTargetInfluences.length; i++) this.headMesh.morphTargetInfluences[i] = pick.morph[i];
  }
}
