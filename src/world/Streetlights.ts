import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { taperedTube } from './geometry';
import { glowTexture } from './Textures';

interface Lamp {
  pos: THREE.Vector3;
  glow: THREE.Sprite;
  pool: THREE.Mesh;
  glass: THREE.MeshBasicMaterial;
  phase: number;
  dying: boolean;
  level: number;
}

const LAMP_COLOR = new THREE.Color(0xffc27a);

/**
 * Crooked Victorian streetlights. Each lamp has a cheap glow sprite and a light
 * pool on the ground; a small pool of real PointLights is assigned to the lamps
 * nearest the Visitor so lighting stays dynamic without hundreds of lights.
 */
export class Streetlights {
  readonly group = new THREE.Group();
  private lamps: Lamp[] = [];
  private lights: THREE.PointLight[] = [];
  private time = 0;

  constructor(xs: Array<{ x: number; z: number }>) {
    const rand = mulberry32(31);
    const iron = new THREE.MeshStandardMaterial({ color: 0x0c0b10, roughness: 0.55, metalness: 0.6 });
    const glowTex = glowTexture('rgba(255,200,130,1)');
    const poolTex = glowTexture('rgba(255,190,120,0.6)');

    for (const { x, z } of xs) {
      const lean = (rand() - 0.5) * 0.35;
      const dirToPath = z < 0 ? 1 : -1;
      const h = 4.4 + rand() * 1.2;
      // A bent shepherd's-crook post that leans toward the path.
      const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(lean * 0.4, h * 0.45, 0.1 * dirToPath),
        new THREE.Vector3(lean, h * 0.9, 0.25 * dirToPath),
        new THREE.Vector3(lean * 1.1, h + 0.35, 0.8 * dirToPath),
        new THREE.Vector3(lean * 1.1, h + 0.1, 1.35 * dirToPath),
      ];
      const post = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(pts), 18, 6, 0.11, 0.05), iron);
      post.castShadow = true;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.add(post);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.6, 6), iron);
      base.position.y = 0.3;
      g.add(base);

      const head = new THREE.Vector3(lean * 1.1, h - 0.35, 1.35 * dirToPath);
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.55, 4, 1, true), iron);
      cage.position.copy(head);
      g.add(cage);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.35, 4), iron);
      cap.position.copy(head).add(new THREE.Vector3(0, 0.42, 0));
      g.add(cap);
      const glassMat = new THREE.MeshBasicMaterial({ color: LAMP_COLOR.clone().multiplyScalar(2.2) });
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.45, 8), glassMat);
      glass.position.copy(head);
      g.add(glass);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }),
      );
      glow.position.copy(head);
      glow.scale.setScalar(2.1);
      g.add(glow);

      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: poolTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(head.x, 0.06, head.z + dirToPath * 0.6);
      pool.scale.setScalar(7);
      g.add(pool);

      this.group.add(g);
      this.lamps.push({
        pos: new THREE.Vector3(x + head.x, head.y, z + head.z),
        glow,
        pool,
        glass: glassMat,
        phase: rand() * 100,
        dying: rand() < 0.3,
        level: 1,
      });
    }

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb36b, 0, 16, 1.6);
      this.lights.push(l);
      this.group.add(l);
    }
  }

  update(dt: number, focusX: number): void {
    this.time += dt;
    const t = this.time;
    for (const lamp of this.lamps) {
      let f = 1;
      if (lamp.dying) {
        // Dying bulbs stutter in bursts.
        const burst = Math.sin(t * 0.7 + lamp.phase) > 0.6;
        f = burst ? (Math.sin(t * 43 + lamp.phase) > 0 ? 1 : 0.15) : 0.95;
      } else {
        f = 0.92 + 0.08 * Math.sin(t * 9 + lamp.phase);
      }
      lamp.level = f;
      (lamp.glow.material as THREE.SpriteMaterial).opacity = 0.5 * f;
      (lamp.pool.material as THREE.MeshBasicMaterial).opacity = 0.35 * f;
      lamp.glass.color.copy(LAMP_COLOR).multiplyScalar(2.2 * f);
    }
    // Assign real lights to the nearest lamps ahead of / around the Visitor.
    const sorted = this.lamps
      .filter((l) => l.pos.x > focusX - 25 && l.pos.x < focusX + 45)
      .sort((a, b) => Math.abs(a.pos.x - focusX - 6) - Math.abs(b.pos.x - focusX - 6));
    this.lights.forEach((light, i) => {
      const lamp = sorted[i];
      if (!lamp) {
        light.intensity = 0;
        return;
      }
      light.position.copy(lamp.pos);
      light.intensity = 26 * lamp.level;
    });
  }
}
