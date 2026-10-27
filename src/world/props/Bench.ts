import * as THREE from 'three';
import type { Pavement } from '../Pavement';
import { inscriptionTexture, revealMaterial } from '../Inscriptions';

/**
 * The bench. Always the same bench: the cracked third slat, the brass plaque,
 * the single red rose someone left on the seat. She will pass it more often
 * than is physically possible. Its plaque changes a little each time.
 */
export class Bench {
  readonly group = new THREE.Group();
  encounter = 0;
  private plaqueHolder = new THREE.Group();
  private plaqueMat: THREE.ShaderMaterial | null = null;
  private plaqueAge = 0;

  constructor(
    public x: number,
    readonly z: number,
  ) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.85 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x0b0a0e, roughness: 0.45, metalness: 0.6 });
    // Seat and back slats (facing the path, +Z).
    for (let i = 0; i < 4; i++) {
      const cracked = i === 2;
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.11), wood);
      slat.position.set(0, 0.48, -0.18 + i * 0.13);
      if (cracked) {
        slat.rotation.z = 0.04;
        slat.position.y -= 0.015;
      }
      slat.castShadow = slat.receiveShadow = true;
      this.group.add(slat);
    }
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.11, 0.04), wood);
      slat.position.set(0, 0.68 + i * 0.15, -0.3 - i * 0.03);
      slat.rotation.x = -0.18;
      slat.castShadow = true;
      this.group.add(slat);
    }
    // Wrought-iron ends.
    for (const sx of [-0.88, 0.88]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.48, 0.06), iron);
      leg.position.set(sx, 0.24, 0.14);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), iron);
      back.position.set(sx, 0.5, -0.3);
      back.rotation.x = -0.18;
      const arm = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 12, Math.PI), iron);
      arm.position.set(sx, 0.62, -0.06);
      arm.rotation.y = Math.PI / 2;
      this.group.add(leg, back, arm);
    }
    // The rose: dark stem, a single blood-red bloom.
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4), new THREE.MeshStandardMaterial({ color: 0x1a2a14 }));
    stem.rotation.z = Math.PI / 2 - 0.2;
    stem.position.set(0.25, 0.52, 0.02);
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6a0812, roughness: 0.5, emissive: 0x1a0003 }));
    bloom.scale.set(1, 0.8, 1);
    bloom.position.set(0.46, 0.55, 0.06);
    this.group.add(stem, bloom);
    // Plaque on the backrest.
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.1), new THREE.MeshStandardMaterial({ color: 0x5a4628, roughness: 0.35, metalness: 0.75 }));
    plaque.position.set(0, 0.84, -0.335);
    plaque.rotation.x = -0.18;
    plaque.add(this.plaqueHolder);
    this.plaqueHolder.position.z = 0.003;
    this.group.add(plaque);
    this.group.position.set(x, 0, z);
    this.group.scale.setScalar(1.2);
  }

  engrave(text: string): void {
    this.plaqueMat?.dispose();
    this.plaqueMat = revealMaterial(inscriptionTexture(text, 'brass', 1600, 220));
    this.plaqueHolder.clear();
    this.plaqueHolder.add(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.085), this.plaqueMat));
    this.plaqueAge = 0;
  }

  moveTo(x: number): void {
    this.x = x;
    this.group.position.x = x;
  }

  update(dt: number, pav: Pavement): void {
    this.group.position.y = Math.max(0, pav.heightAt(this.x, this.z));
    if (this.plaqueMat) {
      this.plaqueAge += dt;
      this.plaqueMat.uniforms.uReveal.value = Math.min(1.05, this.plaqueAge / 1.8);
      this.plaqueMat.uniforms.uTime.value = this.plaqueAge;
    }
  }
}
