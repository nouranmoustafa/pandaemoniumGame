import * as THREE from 'three';
import { COLORS, COURSE } from '../config';
import type { EventBus } from '../core/Events';
import { mulberry32, smoothstep } from '../core/math';
import { GrassField } from './GrassField';
import { House } from './House';
import { ENTRANCE, ParkEntrance } from './ParkEntrance';
import { Particles } from './Particles';
import { Pavement } from './Pavement';
import { Sky } from './Sky';
import { Streetlights } from './Streetlights';
import { bark, groundGrass } from './Textures';
import { buildTreeGeometry } from './TreeBuilder';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Builds and animates the whole park: sky, fog, lights, the deformable
 * pavement, grass, trees, lamps, particles and the house.
 */
export class Environment {
  readonly group = new THREE.Group();
  readonly pavement: Pavement;
  readonly house: House;
  readonly sky: Sky;
  readonly particles: Particles;
  readonly moonLight: THREE.DirectionalLight;
  readonly barkMaterial: THREE.MeshStandardMaterial;
  readonly lamps: Streetlights;
  /** The town edge and gate, where the prologue plays. */
  readonly entrance: ParkEntrance;
  private grass: GrassField;
  private hemi: THREE.HemisphereLight;
  private amber: THREE.DirectionalLight;
  /** The last of the sunset, low behind the town. */
  private afterglow: THREE.DirectionalLight;
  /** 0..1 — the ordinary evening (1) giving way to the park's night (0). */
  warmth = 0;
  private warmFog = new THREE.Color(0x4a3448);
  private nightHemiSky = new THREE.Color(COLORS.hemiSky);
  private warmHemiSky = new THREE.Color(0x7a6a8a);
  private nightHemiGround = new THREE.Color(COLORS.hemiGround);
  private warmHemiGround = new THREE.Color(0x3a2418);
  private fill: THREE.PointLight;
  private time = 0;
  private gust = 0;
  private gustTarget = 0;
  private peace = 0;
  private peaceTarget = 0;
  private anxiety = 0;
  private anxiousFog = new THREE.Color(0x2c1424);
  private treeUniforms = { uTime: { value: 0 }, uWind: { value: 0 } };

  constructor(
    private scene: THREE.Scene,
    bus: EventBus,
    keepClear: number[],
  ) {
    scene.fog = new THREE.FogExp2(COLORS.fog, 0.0125);
    scene.background = new THREE.Color(COLORS.fog);

    this.sky = new Sky();
    scene.add(this.sky.group);

    // Lighting.
    const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.1);
    this.hemi = hemi;
    this.group.add(hemi);
    this.moonLight = new THREE.DirectionalLight(COLORS.moonLight, 2.4);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    const sc = this.moonLight.shadow.camera;
    sc.left = -28;
    sc.right = 28;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 140;
    this.moonLight.shadow.bias = -0.0006;
    this.moonLight.shadow.normalBias = 0.03;
    this.group.add(this.moonLight, this.moonLight.target);
    const amber = new THREE.DirectionalLight(COLORS.amber, 0.5);
    amber.position.set(1, 0.25, 0.05);
    this.amber = amber;
    this.group.add(amber);
    this.afterglow = new THREE.DirectionalLight(0xff9a62, 0);
    this.afterglow.position.set(-1, 0.22, 0.35);
    this.group.add(this.afterglow);
    this.fill = new THREE.PointLight(0x9a9cff, 16, 9, 1.3);
    this.group.add(this.fill);

    // Ground.
    const groundTex = groundGrass();
    groundTex.repeat.set(1800 / 7, 400 / 7);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 400),
      new THREE.MeshStandardMaterial({ map: groundTex, color: 0x6a7a80, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(300, -0.02, -120);
    ground.receiveShadow = true;
    this.group.add(ground);

    this.pavement = new Pavement(bus);
    this.group.add(this.pavement.mesh);

    this.grass = new GrassField();
    this.group.add(this.grass.mesh);

    // Trees.
    const barkTex = bark();
    barkTex.repeat.set(2, 1);
    this.barkMaterial = new THREE.MeshStandardMaterial({ map: barkTex, color: 0x5a5068, roughness: 0.95 });
    // Trees bend with height when the wind rises (world-space, so every tree leans the same way).
    const tu = this.treeUniforms;
    this.barkMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, tu);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace(
          '#include <project_vertex>',
          `vec4 mvPosition = vec4(transformed, 1.0);
           #ifdef USE_BATCHING
             mvPosition = batchingMatrix * mvPosition;
           #endif
           #ifdef USE_INSTANCING
             mvPosition = instanceMatrix * mvPosition;
           #endif
           vec4 wpos = modelMatrix * mvPosition;
           float hk = max(wpos.y, 0.0);
           hk = hk * hk * 0.0045;
           float idle = sin(uTime * 0.8 + wpos.x * 0.21) * 0.1 + sin(uTime * 1.9 + wpos.z * 0.4) * 0.04;
           wpos.x -= (uWind * 1.4 + idle) * hk;
           wpos.z += sin(uTime * 0.6 + wpos.x * 0.13) * 0.06 * hk;
           mvPosition = viewMatrix * wpos;
           gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    this.barkMaterial.customProgramCacheKey = () => 'tree-sway';
    // Detailed variants line the path; lighter ones fill the depths of the park.
    const nearVariants: THREE.BufferGeometry[] = [];
    const farVariants: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) nearVariants.push(buildTreeGeometry({ seed: 100 + i, height: 10 + (i % 4) * 2.5, depth: 3 }));
    for (let i = 0; i < 6; i++) farVariants.push(buildTreeGeometry({ seed: 200 + i, height: 11 + (i % 3) * 3, depth: 2 }));
    const rand = mulberry32(2024);
    const placements: Array<{ near: boolean; geo: number; m: THREE.Matrix4 }> = [];
    const placeTree = (x: number, z: number, scale: number) => {
      if (x > COURSE.houseX - 70 && z > -50 && z < 30) return;
      // The crooked trees only begin inside the gate, thinly at first.
      if (x < ENTRANCE.gateX + 4) return;
      if (x < ENTRANCE.gateX + 16 && rand() > (x - ENTRANCE.gateX - 4) / 12) return;
      if (keepClear.some((k) => Math.abs(k - x) < 5) && z > -13 && z < 13) return;
      const near = z > -15 && z < 15;
      const pool = near ? nearVariants : farVariants;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
        new THREE.Vector3(scale, scale, scale),
      );
      placements.push({ near, geo: Math.floor(rand() * pool.length), m });
    };
    for (let x = -60; x < 660; x += 4 + rand() * 5) placeTree(x, -(8.5 + rand() * 5), 0.85 + rand() * 0.4);
    for (let x = -60; x < 660; x += 6 + rand() * 6) placeTree(x, -(16 + rand() * 30), 1 + rand() * 0.6);
    for (let x = -60; x < 660; x += 10 + rand() * 10) placeTree(x, 14 + rand() * 10, 0.9 + rand() * 0.4);
    // Batched: one multi-draw per group, with per-tree frustum culling.
    // Only trees by the path throw shadows across it.
    for (const near of [true, false]) {
      const pool = near ? nearVariants : farVariants;
      const items = placements.filter((p) => p.near === near);
      const verts = pool.reduce((s, g) => s + g.getAttribute('position').count, 0);
      const idx = pool.reduce((s, g) => s + g.index!.count, 0);
      const batch = new THREE.BatchedMesh(items.length, verts, idx, this.barkMaterial);
      const ids = pool.map((g) => batch.addGeometry(g));
      for (const p of items) batch.setMatrixAt(batch.addInstance(ids[p.geo]), p.m);
      batch.castShadow = near;
      batch.receiveShadow = near;
      this.group.add(batch);
    }

    // Low foreground: a crooked iron fence (frames the shot without hiding her). Instanced: one draw call.
    const iron = new THREE.MeshStandardMaterial({ color: 0x09080c, roughness: 0.5, metalness: 0.5 });
    const postGeo = new THREE.BoxGeometry(0.08, 1.15, 0.08);
    postGeo.translate(0, 0.55, 0);
    const spike = new THREE.ConeGeometry(0.08, 0.22, 4);
    spike.translate(0, 1.2, 0);
    const fenceGeo = mergeGeometries([postGeo.toNonIndexed(), spike.toNonIndexed()])!;
    const fencePosts: THREE.Matrix4[] = [];
    const euler = new THREE.Euler();
    for (let x = ENTRANCE.gateX + 0.6; x < COURSE.houseX - 40; x += 0.55) {
      if (rand() < 0.04) x += 3;
      const z = 6.6 + Math.sin(x * 0.05) * 0.3;
      euler.set((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25);
      fencePosts.push(new THREE.Matrix4().makeRotationFromEuler(euler).setPosition(x, 0, z));
    }
    const fence = new THREE.InstancedMesh(fenceGeo, iron, fencePosts.length);
    fencePosts.forEach((m, i) => fence.setMatrixAt(i, m));
    fence.castShadow = true;
    this.group.add(fence);

    // Lamps along the far edge (never on the near side: they would sweep through the camera).
    const lampSpots: Array<{ x: number; z: number }> = [];
    for (let x = -10; x < COURSE.houseX - 40; x += 24) {
      const lx = x + rand() * 6;
      if (!keepClear.some((k) => Math.abs(k - lx) < 6)) lampSpots.push({ x: lx, z: -5.9 });
    }
    this.lamps = new Streetlights(lampSpots);
    this.group.add(this.lamps.group);

    this.house = new House();
    this.house.group.position.set(COURSE.houseX, 0, COURSE.houseZ);
    this.group.add(this.house.group);

    this.entrance = new ParkEntrance();
    this.group.add(this.entrance.group);

    this.particles = new Particles();
    this.group.add(this.particles.group);

    scene.add(this.group);
  }

  /** A wave through the grass that has nothing to do with the wind. */
  rippleGrass(x: number, amp: number): void {
    this.grass.ripple(x, amp);
  }

  /** The Demon can whip up the wind. */
  setGust(strength: number): void {
    this.gustTarget = strength;
  }

  /** 0..1 — the false shortcut's calm: thinner fog, warm steady lamps. */
  setPeace(p: number): void {
    this.peaceTarget = p;
  }

  /** 0..1 — the Demon's anxiety: the night tightens around her. */
  setAnxiety(a: number): void {
    this.anxiety = a;
  }

  /** The house flares, briefly much brighter — it is closer than she thought. */
  flareHouse(): void {
    this.house.flare = 1;
  }

  /**
   * Stage 4: inside the house the park is gone — no sky, no moon, no
   * grass — and the night closes in to a dark, close haze. Outdoors again,
   * update() restores the fog and background on its next frame.
   */
  setIndoors(on: boolean): void {
    this.group.visible = !on;
    this.sky.group.visible = !on;
    if (on) {
      const fog = this.scene.fog as THREE.FogExp2;
      fog.color.setHex(0x0a0608);
      fog.density = 0.03;
      (this.scene.background as THREE.Color).setHex(0x050304);
    }
  }

  reset(): void {
    this.entrance.reset();
    this.gust = this.gustTarget = 0;
    this.peace = this.peaceTarget = 0;
    this.anxiety = 0;
    this.house.flare = 0;
    this.lamps.reset();
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    this.time += dt;
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 2.5);
    this.peace += (this.peaceTarget - this.peace) * Math.min(1, dt * 0.8);
    const ambientGust = 0.12 * Math.max(0, Math.sin(this.time * 0.37) * Math.sin(this.time * 0.13)) * (1 - this.peace);
    const gust = this.gust + ambientGust;
    this.pavement.update(dt);
    this.sky.update(dt, camera);
    this.grass.update(dt, focus.x + 30, gust);
    this.lamps.flickerBoost = this.anxiety;
    this.lamps.warmth = this.peace;
    this.lamps.update(dt, focus);
    this.house.glow = 1 + this.anxiety * 0.6 + this.peace * 0.3;
    this.house.update(dt);
    this.particles.gust = gust;
    this.particles.update(dt, focus.x);
    this.treeUniforms.uTime.value = this.time;
    this.treeUniforms.uWind.value = gust;

    // Mood: the shortcut clears the air; anxiety thickens and reddens it.
    // The prologue's warm evening (warmth) lifts it all toward dusk.
    const w = this.warmth;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = 0.0125 * (1 - this.peace * 0.45) * (1 + this.anxiety * 0.18) * (1 - w * 0.45);
    fog.color.setHex(COLORS.fog).lerp(this.anxiousFog, this.anxiety * 0.45).lerp(this.warmFog, w);
    this.hemi.color.copy(this.nightHemiSky).lerp(this.warmHemiSky, w);
    this.hemi.groundColor.copy(this.nightHemiGround).lerp(this.warmHemiGround, w);
    this.hemi.intensity = 1.1 + w * 0.25;
    this.moonLight.intensity = 2.4 - w * 1.5;
    this.amber.intensity = 0.5 + w * 0.2;
    this.afterglow.intensity = w * 1.5;
    this.sky.warmth = w;
    this.sky.setFog(fog.color);
    this.entrance.update(dt, smoothstep(16, 2, focus.x - ENTRANCE.gateX));
    (this.scene.background as THREE.Color).copy(fog.color);

    // Moon shadow follows the Visitor so shadows stay crisp where it matters.
    this.moonLight.target.position.set(focus.x + 6, focus.y, focus.z);
    this.moonLight.position.copy(this.moonLight.target.position).addScaledVector(this.sky.moonDir, 70);
    this.moonLight.position.y = Math.max(this.moonLight.position.y, focus.y + 30);
    this.fill.position.set(focus.x - 2.2, focus.y + 2.6, focus.z + 2.6);
  }
}
