import * as THREE from 'three';
import { damp, easeInOutSine } from '../../core/math';
import type { Pavement } from '../Pavement';
import { inscriptionTexture, revealMaterial } from '../Inscriptions';

function boardTexture(text: string, arrowRight: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  // Weathered painted wood.
  g.fillStyle = '#2a2018';
  g.fillRect(0, 0, 512, 160);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.2})`;
    g.fillRect(0, Math.random() * 160, 512, 1 + Math.random() * 2);
  }
  g.strokeStyle = 'rgba(210,190,150,0.5)';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 140);
  g.fillStyle = '#d9cba8';
  g.font = '600 78px "IM Fell English SC", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, arrowRight ? 220 : 292, 84);
  // Arrow.
  g.beginPath();
  if (arrowRight) {
    g.moveTo(400, 50);
    g.lineTo(470, 80);
    g.lineTo(400, 110);
  } else {
    g.moveTo(112, 50);
    g.lineTo(42, 80);
    g.lineTo(112, 110);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The lying signpost. Its arrow says EXIT and points back the way she came —
 * until she's far enough away not to notice, when it slowly, deliberately
 * turns to point at the house. If she gets close, it turns back. Silently.
 * A small plaque beneath can carry the Demon's opinion.
 */
export class Signpost {
  readonly group = new THREE.Group();
  /** Board heading: 0 = points back toward the exit (-X), 1 = points at the house (+X). */
  heading = 0;
  private target = 0;
  private board = new THREE.Group();
  private plaqueMat: THREE.ShaderMaterial | null = null;
  private plaque: THREE.Mesh;
  private turnT = -1;
  private turnFrom = 0;
  private plaqueAge = 0;

  constructor(
    public x: number,
    readonly z: number,
    label = 'EXIT',
    /** If true it starts pointing at the house (honest-looking lure). */
    startToHouse = false,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x2a1f18, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x0c0b10, roughness: 0.5, metalness: 0.6 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), wood);
    post.position.y = 1.3;
    post.rotation.z = 0.04;
    post.castShadow = true;
    this.group.add(post);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 6), iron);
    cap.position.y = 2.68;
    this.group.add(cap);

    // The board: two faces back to back so it reads correctly after turning.
    this.board.position.y = 2.25;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.36), new THREE.MeshStandardMaterial({ map: boardTexture(label, false), roughness: 0.85 }));
    front.position.set(-0.45, 0, 0.035);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.36), new THREE.MeshStandardMaterial({ map: boardTexture(label, true), roughness: 0.85 }));
    back.position.set(-0.45, 0, -0.035);
    back.rotation.y = Math.PI;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.39, 0.06), wood);
    edge.position.set(-0.45, 0, 0);
    edge.castShadow = true;
    this.board.add(edge, front, back);
    this.group.add(this.board);

    // Plaque below the board, angled toward the path.
    this.plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.4, metalness: 0.7 }),
    );
    this.plaque.position.set(0, 1.45, 0.1);
    this.group.add(this.plaque);

    this.group.position.set(x, 0, z);
    this.group.scale.setScalar(1.45);
    if (startToHouse) this.heading = this.target = 1;
    this.applyHeading();
  }

  /** Engrave a line on the plaque (revealed letter by letter). */
  engrave(text: string): void {
    const map = inscriptionTexture(text, 'brass', 2048, 200);
    this.plaqueMat?.dispose();
    this.plaqueMat = revealMaterial(map);
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.15), this.plaqueMat);
    overlay.position.z = 0.003;
    this.plaque.clear();
    this.plaque.add(overlay);
    this.plaqueAge = 0;
  }

  /** Turn deliberately: hold, twitch, glide. */
  turnTo(toHouse: boolean): void {
    const t = toHouse ? 1 : 0;
    if (t === this.target) return;
    this.target = t;
    this.turnFrom = this.heading;
    this.turnT = 0;
  }

  moveTo(x: number): void {
    this.x = x;
    this.group.position.x = x;
  }

  reset(x: number, toHouse = false): void {
    this.moveTo(x);
    this.heading = this.target = toHouse ? 1 : 0;
    this.turnT = -1;
    this.plaque.clear();
    this.plaqueMat?.dispose();
    this.plaqueMat = null;
    this.applyHeading();
  }

  update(dt: number, pav: Pavement): void {
    this.group.position.y = Math.max(0, pav.heightAt(this.x, this.z));
    if (this.turnT >= 0) {
      this.turnT += dt;
      const dur = 2.6;
      const k = Math.min(1, this.turnT / dur);
      // Unnatural timing: a still beat, a small tick, then a slow glide.
      let e: number;
      if (k < 0.25) e = 0;
      else if (k < 0.32) e = 0.06 * Math.sin(((k - 0.25) / 0.07) * Math.PI);
      else e = easeInOutSine((k - 0.32) / 0.68);
      this.heading = this.turnFrom + (this.target - this.turnFrom) * e;
      if (k >= 1) {
        this.heading = this.target;
        this.turnT = -1;
      }
      this.applyHeading();
    }
    if (this.plaqueMat) {
      this.plaqueAge += dt;
      this.plaqueMat.uniforms.uReveal.value = Math.min(1.05, this.plaqueAge / 2.4);
      this.plaqueMat.uniforms.uTime.value = this.plaqueAge;
    }
  }

  /** Quick return to innocence when she gets close. */
  snapBack(dt: number): void {
    if (this.heading <= 0.001) return;
    this.turnT = -1;
    this.target = 0;
    this.heading = damp(this.heading, 0, 5, dt);
    this.applyHeading();
  }

  private applyHeading(): void {
    // Board hangs off the post toward -X; rotating π swings it to point +X.
    this.board.rotation.y = this.heading * Math.PI;
  }
}
