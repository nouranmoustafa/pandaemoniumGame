import * as THREE from 'three';
import { CAST, OUTFITS } from '../characters/cast';
import type { CharacterId } from '../characters/design';
import { type ExpressionName, mixExpression } from '../characters/Expression';
import { GeneratedCharacter } from '../characters/GeneratedCharacter';
import { GltfAvatar } from '../characters/gltf/GltfAvatar';
import { PIPELINE_TEST } from '../characters/gltf/manifest';
import { WeddingDress } from '../characters/WeddingDress';
import { Pose } from '../visitor/Pose';

/**
 * Development view (?lab): the cast under neutral studio light, for
 * checking rigs, faces and outfits. Driven from automated screenshots via
 * window.__lab.
 */
export class CharacterLab {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 100);
  readonly chars = new Map<CharacterId, GeneratedCharacter>();
  readonly poses = new Map<CharacterId, Pose>();
  frames = 0;
  /** The imported GLB (?lab&glb), for validating the asset pipeline. */
  glb: GltfAvatar | null = null;
  glbSpeed = 0;
  /** The house's gown on the Visitor (built on first use). */
  wedding: WeddingDress | null = null;
  private clock = new THREE.Timer();
  private expr: ExpressionName = 'neutral';
  private blink = 0;

  constructor(container: HTMLElement) {
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    this.scene.background = new THREE.Color(0x2a2630);
    this.scene.add(new THREE.HemisphereLight(0xb8b0d0, 0x302020, 1.2));
    const key = new THREE.DirectionalLight(0xffe2c8, 2.6);
    key.position.set(3, 5, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9aa8ff, 2.2);
    rim.position.set(-4, 3, -5);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x3a3540 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ids: CharacterId[] = ['odette', 'visitor', 'juno', 'wren'];
    ids.forEach((id, i) => {
      const c = new GeneratedCharacter(CAST[id], OUTFITS[id]);
      c.object.position.set((i - 1.5) * 0.9, 0, 0);
      this.scene.add(c.object);
      this.chars.set(id, c);
      this.poses.set(id, new Pose());
    });
    this.view('all');
    if (new URLSearchParams(location.search).has('glb')) {
      void GltfAvatar.load(PIPELINE_TEST, 1.66 * 1.14, import.meta.env.BASE_URL).then((a) => {
        a.object.position.set(2.6, 0, 0);
        this.scene.add(a.object);
        this.glb = a;
      });
    }
    r.setAnimationLoop(() => this.loop());
    (window as unknown as { __lab: CharacterLab }).__lab = this;
  }

  /** Camera presets. */
  view(which: 'all' | CharacterId | `${CharacterId}-face` | `${CharacterId}-hand` | `${CharacterId}-side` | `${CharacterId}-back`): void {
    if (which === 'all') {
      this.camera.position.set(0, 1.2, 7.4);
      this.camera.lookAt(0, 1.0, 0);
      return;
    }
    const [id, part] = which.split('-') as [CharacterId, string | undefined];
    const c = this.chars.get(id)!;
    c.object.updateMatrixWorld(true);
    const eyes = c.getEyesWorld(new THREE.Vector3());
    const base = c.object.position;
    if (part === 'face') {
      this.camera.position.set(eyes.x + 0.12, eyes.y + 0.02, eyes.z + 0.75);
      this.camera.lookAt(eyes.x, eyes.y - 0.04, eyes.z);
    } else if (part === 'hand') {
      const h = c.getBoneWorld('wristL', new THREE.Vector3());
      this.camera.position.set(h.x + 0.5, h.y, h.z + 0.3);
      this.camera.lookAt(h.x, h.y - 0.08, h.z);
    } else if (part === 'side') {
      this.camera.position.set(base.x + 3.2, 1.1, base.z);
      this.camera.lookAt(base.x, 1.0, base.z);
    } else if (part === 'back') {
      this.camera.position.set(base.x + 0.6, 1.5, base.z - 2.8);
      this.camera.lookAt(base.x, 1.2, base.z);
    } else {
      this.camera.position.set(base.x + 0.3, 1.25, base.z + 3.2);
      this.camera.lookAt(base.x, 1.0, base.z);
    }
  }

  /** Wedding gown on the Visitor: reveal 0..1, veil 0..1 (descent). */
  dress(reveal: number, veil = 0): void {
    const v = this.chars.get('visitor')!;
    this.wedding ??= new WeddingDress(v, this.scene);
    this.wedding.reveal = reveal;
    this.wedding.veilDrop = veil;
  }

  setExpression(e: ExpressionName): void {
    this.expr = e;
  }

  showHair(v: boolean): void {
    for (const c of this.chars.values()) c.object.traverse((o) => o.name === 'hair' && (o.visible = v));
  }

  setBlink(b: number): void {
    this.blink = b;
  }

  /** Apply a test pose to everyone: 'rest' | 'walk' | 'run' | 'wave' | 'phone'. */
  pose(kind: string): void {
    for (const [id, p] of this.poses) {
      p.clear();
      p.set('shoulderL', 0, 0, 0.1).set('shoulderR', 0, 0, -0.1);
      if (kind === 'run') {
        p.set('thighL', -0.9).set('kneeL', 1.4).set('thighR', 0.6).set('kneeR', 0.3);
        p.set('shoulderL', 0.7, 0, 0.15).set('elbowL', -1.5).set('shoulderR', -0.8, 0, -0.15).set('elbowR', -1.4);
        p.set('spine', 0.25);
      } else if (kind === 'wave') {
        p.set('shoulderL', -2.6, 0, 0.4).set('elbowL', -0.9).setHand('L', 0.05, 0.5, 0, 0);
      } else if (kind === 'phone') {
        p.set('shoulderR', -0.55, 0.1, -0.1).set('elbowR', -1.85, 0.5, 0).set('wristR', -0.2, -0.6, 0).setHand('R', 0.65, 0.05, 0.5, 0);
        p.set('neck', 0.2).set('head', 0.35);
        this.chars.get(id)!.phone.visible = true;
      } else if (kind === 'fist') {
        p.set('elbowL', -1.3).setHand('L', 1, 0, 1, 0);
      }
      this.chars.get(id)!.applyPose(p);
    }
  }

  private loop(): void {
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const face = mixExpression({ [this.expr]: 1 });
    if (this.glb) {
      this.glb.setFace(face, this.blink);
      this.glb.drive(dt, { speed: this.glbSpeed, stumbleTime: -1, stumbleDuration: 1, slide: 0, laneVel: 0, windLean: 0, slope: 0, arriving: false });
    }
    for (const c of this.chars.values()) c.updateFace(1 / 60, face, this.blink);
    this.wedding?.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }
}
