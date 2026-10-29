import * as THREE from 'three';
import { damp, easeInOutSine, mulberry32 } from '../core/math';
import { taperedTube } from './geometry';
import { glowTexture } from './Textures';

interface Lamp {
  root: THREE.Group;
  head: THREE.Group;
  pos: THREE.Vector3;
  glow: THREE.Sprite;
  pool: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  glass: THREE.MeshBasicMaterial;
  phase: number;
  dying: boolean;
  level: number;
  /** Current and target lean (radians about Z) for the "conferring" trick. */
  lean: number;
  leanTarget: number;
  leanT: number;
  /** Seconds of a forced stutter (a scripted flicker). */
  stutter: number;
}

const LAMP_COLOR = new THREE.Color(0xffc27a);
const WARM = new THREE.Color(0xffd9a0);
const DOWN = new THREE.Vector3(0, -1, 0);

/** Vertical falloff for the light shaft: bright under the lamp, gone by the ground. */
function beamTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgb(255,255,255)');
  grad.addColorStop(0.35, 'rgb(90,90,90)');
  grad.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Crooked Victorian streetlights — and they watch her.
 *
 * Each lamp head swivels on its crook. Lamps she has already passed turn
 * their faint beams to follow her; a lamp ahead of her (one she is "looking
 * at") is perfectly still. Pairs can lean together as if conferring.
 *
 * A small pool of real PointLights is assigned to the lamps nearest the
 * Visitor so lighting stays dynamic without hundreds of lights.
 */
export class Streetlights {
  readonly group = new THREE.Group();
  readonly lamps: Lamp[] = [];
  private lights: THREE.PointLight[] = [];
  private time = 0;
  private qTmp = new THREE.Quaternion();
  private dir = new THREE.Vector3();
  private headWorld = new THREE.Vector3();
  /** 0..1 extra instability when the Demon is anxious. */
  flickerBoost = 0;
  /** 0..1 calm, warm, steady light (the false shortcut). */
  warmth = 0;

  constructor(xs: Array<{ x: number; z: number }>) {
    const rand = mulberry32(31);
    const iron = new THREE.MeshStandardMaterial({ color: 0x0c0b10, roughness: 0.55, metalness: 0.6 });
    const glowTex = glowTexture('rgba(255,200,130,1)');
    const poolTex = glowTexture('rgba(255,190,120,0.6)');
    const beamGeo = new THREE.CylinderGeometry(0.08, 1.15, 3.6, 16, 1, true);
    const beamTex = beamTexture();
    beamGeo.translate(0, -1.8, 0);

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
      const root = new THREE.Group();
      root.position.set(x, 0, z);
      const post = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(pts), 18, 6, 0.11, 0.05), iron);
      post.castShadow = true;
      root.add(post);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.6, 6), iron);
      base.position.y = 0.3;
      root.add(base);

      // The head swivels from the tip of the crook.
      const head = new THREE.Group();
      head.position.set(lean * 1.1, h + 0.05, 1.35 * dirToPath);
      root.add(head);
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.55, 4, 1, true), iron);
      cage.position.y = -0.4;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.35, 4), iron);
      cap.position.y = 0.02;
      const glassMat = new THREE.MeshBasicMaterial({ color: LAMP_COLOR.clone().multiplyScalar(2.2) });
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.45, 8), glassMat);
      glass.position.y = -0.4;
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }),
      );
      glow.position.y = -0.4;
      glow.scale.setScalar(2.1);
      // A faint shaft of light — this is what follows her.
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffc890,
        map: beamTex,
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = -0.55;
      head.add(cage, cap, glass, glow, beam);

      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: poolTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(head.position.x, 0.06, head.position.z + dirToPath * 0.6);
      pool.scale.setScalar(7);
      root.add(pool);

      this.group.add(root);
      this.lamps.push({
        root,
        head,
        pos: new THREE.Vector3(x + head.position.x, head.position.y - 0.4, z + head.position.z),
        glow,
        pool,
        beamMat,
        glass: glassMat,
        phase: rand() * 100,
        dying: rand() < 0.3,
        level: 1,
        lean: 0,
        leanTarget: 0,
        leanT: -1,
        stutter: 0,
      });
    }

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffb36b, 0, 16, 1.6);
      this.lights.push(l);
      this.group.add(l);
    }
  }

  /** Weak GPUs: a smaller pool of real lights (each one is paid for on every lit pixel, even at zero). */
  trimPool(n: number): void {
    for (const l of this.lights.splice(n)) l.removeFromParent();
  }

  /**
   * Two neighbouring lamps ahead of her lean toward each other, as if
   * discussing her. Returns false if no suitable pair exists.
   */
  confer(fromX: number, toX: number): boolean {
    for (let i = 0; i < this.lamps.length - 1; i++) {
      const a = this.lamps[i];
      const b = this.lamps[i + 1];
      if (a.pos.x < fromX || a.pos.x > toX) continue;
      if (Math.abs(a.pos.z - b.pos.z) > 1 || b.pos.x - a.pos.x > 40) continue;
      a.leanTarget = -0.2; // top tips toward +X
      b.leanTarget = 0.2;
      a.leanT = b.leanT = 0;
      return true;
    }
    return false;
  }

  /** The lamp nearest x stutters, briefly. */
  stutter(x: number, seconds = 1.1): void {
    let best: Lamp | null = null;
    for (const l of this.lamps) if (!best || Math.abs(l.pos.x - x) < Math.abs(best.pos.x - x)) best = l;
    if (best) best.stutter = seconds;
  }

  reset(): void {
    for (const l of this.lamps) {
      l.stutter = 0;
      l.lean = l.leanTarget = 0;
      l.leanT = -1;
      l.root.rotation.set(0, 0, 0);
      l.head.quaternion.identity();
    }
    this.flickerBoost = this.warmth = 0;
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;
    const focusX = focus.x;
    for (const lamp of this.lamps) {
      const near = Math.abs(lamp.pos.x - focusX) < 90;
      lamp.root.visible = near;
      if (!near) continue;

      // --- Flicker ---
      let f: number;
      const unstable = lamp.dying || Math.sin(lamp.phase + t * 0.05) < -0.6 + this.flickerBoost * 0.9;
      if (unstable && this.warmth < 0.5) {
        const burst = Math.sin(t * 0.7 + lamp.phase) > 0.6 - this.flickerBoost * 0.5;
        f = burst ? (Math.sin(t * 43 + lamp.phase) > 0 ? 1 : 0.15) : 0.95;
      } else {
        f = 0.92 + 0.08 * Math.sin(t * 9 + lamp.phase) * (1 - this.warmth);
      }
      if (lamp.stutter > 0) {
        lamp.stutter -= dt;
        f = Math.sin(t * 31) > 0.2 || lamp.stutter < 0.15 ? 0.08 : 0.9;
      }
      lamp.level = f * (1 + this.warmth * 0.25);
      (lamp.glow.material as THREE.SpriteMaterial).opacity = 0.5 * lamp.level;
      (lamp.pool.material as THREE.MeshBasicMaterial).opacity = 0.35 * lamp.level;
      lamp.glass.color.copy(LAMP_COLOR).lerp(WARM, this.warmth).multiplyScalar(2.2 * f);

      // --- Watching ---
      // Ahead of her (where she's looking): frozen. Passed: the head turns to follow.
      const ahead = lamp.pos.x > focusX + 1.5;
      if (!ahead) {
        lamp.head.getWorldPosition(this.headWorld);
        this.dir.set(focus.x - this.headWorld.x, focus.y + 0.8 - this.headWorld.y, focus.z - this.headWorld.z).normalize();
        // Only part of the way: a tilt, not a searchlight.
        this.dir.lerp(DOWN, 0.45).normalize();
        this.qTmp.setFromUnitVectors(DOWN, this.dir);
        lamp.head.quaternion.slerp(this.qTmp, 1 - Math.exp(-dt * 1.4));
      }
      lamp.beamMat.opacity = (ahead ? 0.05 : 0.11) * lamp.level;

      // --- Conferring lean ---
      if (lamp.leanT >= 0) {
        // Freeze the moment she's close enough to look at them.
        const watched = lamp.pos.x > focusX && lamp.pos.x - focusX < 12;
        if (lamp.pos.x < focusX - 6) {
          // Once she's gone by, they straighten — slowly, as if nothing happened.
          lamp.leanTarget = 0;
          lamp.lean = damp(lamp.lean, 0, 0.6, dt);
          if (Math.abs(lamp.lean) < 0.002) lamp.leanT = -1;
        } else {
          if (!watched) lamp.leanT += dt;
          lamp.lean = lamp.leanTarget * easeInOutSine(Math.min(1, lamp.leanT / 2.4));
        }
      }
      lamp.root.rotation.z = lamp.lean;
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
      lamp.head.getWorldPosition(light.position);
      light.position.y -= 0.4;
      light.intensity = 26 * lamp.level;
    });
  }
}
