import * as THREE from 'three';
import { LANES, type LaneIndex, POWERS } from '../config';
import { clamp, easeInCubic, easeOutCubic, mulberry32, smoothstep } from '../core/math';
import { Obstacle, type ObstacleContext } from './Obstacle';

const FLAMES = 13;
const ASH = 90;
const EMBERS = 40;
const LENGTH = POWERS.fire.footprint * 2;
const BURN = 2.3;

let flameGeo: THREE.BufferGeometry | null = null;
let scorchTex: THREE.Texture | null = null;

const flameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const flameFragment = /* glsl */ `
  uniform float uTime; uniform float uSeed; uniform float uIntensity;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec2 uv = vUv;
    float n = fbm(vec2(uv.x * 3.0 + uSeed, uv.y * 2.4 - uTime * 2.6));
    float n2 = fbm(vec2(uv.x * 6.0 - uSeed, uv.y * 4.0 - uTime * 4.1));
    // A tongue of flame: narrow at the top, licking sideways with the noise.
    float x = uv.x - 0.5 + (n - 0.5) * 0.35 * uv.y;
    float width = mix(0.48, 0.06, pow(uv.y, 0.7));
    float body = smoothstep(width, width * 0.2, abs(x));
    float h = uv.y + (n2 - 0.5) * 0.35;
    body *= smoothstep(1.0, 0.25, h) * smoothstep(0.0, 0.08, uv.y);
    float core = body * smoothstep(0.4, 0.0, uv.y) * smoothstep(width * 0.4, 0.0, abs(x)) * 0.7;
    // Cold: bone-white core, pale teal body, violet-black edges.
    vec3 col = mix(vec3(0.12, 0.08, 0.22), vec3(0.24, 0.48, 0.58), smoothstep(0.0, 0.6, body));
    col = mix(col, vec3(0.7, 0.86, 0.94), core);
    float a = body * uIntensity;
    gl_FragColor = vec4(col * a, a * 0.85);
  }`;

/**
 * Cold, ghostly fire. Pale embers and a frost-blue scorch line warn first;
 * then a wall of slow, licking flames rises across one lane, burns, sinks,
 * and leaves black ash drifting on the wind.
 */
export class FireLine extends Obstacle {
  readonly kind = 'fire' as const;
  readonly windup: number;
  readonly strikeLead = 0;

  private flames: THREE.Mesh[] = [];
  private flameMats: THREE.ShaderMaterial[] = [];
  private scorch: THREE.Mesh;
  private scorchPivot = new THREE.Group();
  /** Where and how strongly a pooled light should glow for this fire (owned by the ability system). */
  readonly lightPos = new THREE.Vector3();
  lightIntensity = 0;
  private ash: THREE.Points;
  private ashPos: Float32Array;
  private ashVel: Float32Array;
  private embers: THREE.Points;
  private emberPos: Float32Array;
  private height = 0;
  private time = 0;
  private laneZ: number;
  private rand: () => number;
  private ashAge = -1;
  private camPos = new THREE.Vector3();

  constructor(x: number, lane: LaneIndex, seed: number, windup: number = POWERS.fire.windup) {
    super(x, [lane], new THREE.Group());
    this.dynamic = true;
    this.selfTimed = true;
    this.windup = windup;
    this.halfLength = LENGTH / 2;
    this.laneZ = LANES[lane];
    this.rand = mulberry32(seed);

    if (!flameGeo) {
      flameGeo = new THREE.PlaneGeometry(1, 1);
      flameGeo.translate(0, 0.5, 0);
    }
    scorchTex ??= FireLine.makeScorchTexture();

    // Scorch line: frost-blue edge while it gathers, black char afterwards.
    this.scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(LENGTH + 0.8, 1.7),
      new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0, depthWrite: false, color: 0x9fdcff }),
    );
    this.scorch.rotation.x = -Math.PI / 2;
    this.scorchPivot.add(this.scorch);
    this.scorchPivot.position.set(x, 0, this.laneZ);
    this.group.add(this.scorchPivot);

    for (let i = 0; i < FLAMES; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: this.rand() * 10 }, uIntensity: { value: 0 } },
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(flameGeo, mat);
      m.userData.offset = new THREE.Vector3(-LENGTH / 2 + (i + 0.5) * (LENGTH / FLAMES), 0, (this.rand() - 0.5) * 0.7);
      m.userData.scale = 0.75 + this.rand() * 0.55;
      m.userData.phase = this.rand() * 10;
      this.flames.push(m);
      this.flameMats.push(mat);
      this.group.add(m);
    }

    this.lightPos.set(x, 1.2, this.laneZ);

    // Embers during the warning.
    this.emberPos = new Float32Array(EMBERS * 3);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    this.embers = new THREE.Points(
      eg,
      new THREE.PointsMaterial({ color: 0xbfeaff, size: 0.06, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.embers.frustumCulled = false;
    this.group.add(this.embers);

    // Ash after it collapses.
    this.ashPos = new Float32Array(ASH * 3);
    this.ashVel = new Float32Array(ASH * 3);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(this.ashPos, 3));
    this.ash = new THREE.Points(ag, new THREE.PointsMaterial({ color: 0x141016, size: 0.07, transparent: true, opacity: 0, depthWrite: false }));
    this.ash.frustumCulled = false;
    this.group.add(this.ash);
  }

  private static makeScorchTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    const rand = mulberry32(9);
    for (let i = 0; i < 160; i++) {
      const x = 20 + rand() * 472;
      const y = 64 + (rand() - 0.5) * 50;
      const r = 6 + rand() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  override get threatening(): boolean {
    return this.state === 'warning' || this.state === 'striking' || this.state === 'holding';
  }

  update(dt: number, ctx: ObstacleContext): void {
    this.time += dt;
    this.stateTime += dt;
    const v = ctx.visitor;
    const pav = ctx.pavement;
    const ground = pav.heightAt(this.x, this.laneZ);

    let warn = 0;
    switch (this.state) {
      case 'warning':
        warn = smoothstep(0, this.windup, this.stateTime);
        this.height = 0.12 * warn * (0.6 + 0.4 * Math.sin(this.time * 9));
        if (this.stateTime >= this.windup) this.strike(ctx);
        break;
      case 'striking':
        this.height = easeOutCubic(clamp(this.stateTime / 0.35, 0, 1));
        if (this.stateTime >= 0.35) this.setState('holding');
        break;
      case 'holding':
        this.height = 1 + Math.sin(this.time * 3) * 0.06;
        if (this.stateTime >= BURN) {
          this.setState('retracting');
          this.spawnAsh(ground);
          ctx.bus.emit('obstacle:end', { kind: 'fire', x: this.x });
        }
        break;
      case 'retracting':
        this.height = 1 - easeInCubic(clamp(this.stateTime / 1.0, 0, 1));
        if (this.stateTime > 5) this.setState('spent');
        break;
    }

    // --- Collision: only once the flames are genuinely up. ---
    const burning = (this.state === 'striking' && this.height > 0.45) || this.state === 'holding' || (this.state === 'retracting' && this.height > 0.5);
    if (burning && !this.landed && this.overlapsVisitor(v, this.halfLength, 1.0)) {
      if (v.controller.catch('fire', Math.random() < 0.5 ? 'L' : 'R')) this.landed = true;
    }

    const near = Math.abs(this.x - v.controller.x) < 90;
    this.group.visible = near && this.state !== 'spent';
    if (!this.group.visible) {
      this.lightIntensity = 0;
      return;
    }

    // Flames: yaw-billboarded so they always face the camera.
    ctx.camera.getWorldPosition(this.camPos);
    for (let i = 0; i < FLAMES; i++) {
      const f = this.flames[i];
      const o = f.userData.offset as THREE.Vector3;
      const sc = f.userData.scale as number;
      const ph = f.userData.phase as number;
      const fx = this.x + o.x;
      const fz = this.laneZ + o.z;
      f.position.set(fx, pav.heightAt(fx, fz) - 0.05, fz);
      const lick = 1 + Math.sin(this.time * 5 + ph) * 0.12 + Math.sin(this.time * 11 + ph * 2) * 0.06;
      const h = Math.max(0.001, this.height * 1.75 * sc * lick);
      f.scale.set(1.25 * sc * (0.6 + 0.4 * Math.min(1, this.height * 2)), h, 1);
      f.rotation.set(0, Math.atan2(this.camPos.x - fx, this.camPos.z - fz), 0);
      const mat = this.flameMats[i];
      mat.uniforms.uTime.value = this.time;
      mat.uniforms.uIntensity.value = clamp(this.height * 1.4, 0, 1) * 0.6;
    }
    this.lightPos.y = ground + 1.1;
    this.lightIntensity = (this.height * 16 + warn * 2) * (0.85 + 0.15 * Math.sin(this.time * 17));

    // Scorch decal.
    this.scorchPivot.position.y = ground + 0.05;
    this.scorchPivot.rotation.z = Math.atan(pav.slopeAt(this.x, this.laneZ));
    const sm = this.scorch.material as THREE.MeshBasicMaterial;
    if (this.state === 'warning' || this.state === 'striking' || this.state === 'holding') {
      sm.color.setHex(0x9fdcff);
      sm.blending = THREE.AdditiveBlending;
      sm.opacity = 0.2 + warn * 0.5 * (0.8 + 0.2 * Math.sin(this.time * 12));
    } else {
      sm.color.setHex(0x050407);
      sm.blending = THREE.NormalBlending;
      sm.opacity = 0.75 * (1 - smoothstep(2.5, 5, this.stateTime));
    }

    // Embers rising while it gathers.
    const em = this.embers.material as THREE.PointsMaterial;
    em.opacity = this.state === 'warning' ? warn * 0.9 : Math.max(0, em.opacity - dt * 2);
    for (let i = 0; i < EMBERS; i++) {
      const k = (this.time * (0.5 + (i % 5) * 0.12) + i * 0.173) % 1;
      const ex = this.x - LENGTH / 2 + ((i * 0.618) % 1) * LENGTH;
      this.emberPos[i * 3] = ex + Math.sin(this.time * 2 + i) * 0.15;
      this.emberPos[i * 3 + 1] = ground + k * 1.6;
      this.emberPos[i * 3 + 2] = this.laneZ + Math.cos(this.time * 1.7 + i) * 0.4;
    }
    (this.embers.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // Ash drifting away.
    if (this.ashAge >= 0) {
      this.ashAge += dt;
      const am = this.ash.material as THREE.PointsMaterial;
      am.opacity = 0.9 * (1 - smoothstep(2.5, 4.8, this.ashAge));
      for (let i = 0; i < ASH; i++) {
        this.ashVel[i * 3] -= dt * 0.6; // carried back along the path
        this.ashVel[i * 3 + 1] -= dt * 0.25;
        this.ashPos[i * 3] += this.ashVel[i * 3] * dt;
        this.ashPos[i * 3 + 1] = Math.max(ground + 0.03, this.ashPos[i * 3 + 1] + this.ashVel[i * 3 + 1] * dt);
        this.ashPos[i * 3 + 2] += (this.ashVel[i * 3 + 2] + Math.sin(this.time * 2 + i) * 0.3) * dt;
      }
      (this.ash.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private spawnAsh(ground: number): void {
    this.ashAge = 0;
    for (let i = 0; i < ASH; i++) {
      this.ashPos[i * 3] = this.x - LENGTH / 2 + this.rand() * LENGTH;
      this.ashPos[i * 3 + 1] = ground + 0.2 + this.rand() * 1.4;
      this.ashPos[i * 3 + 2] = this.laneZ + (this.rand() - 0.5) * 0.8;
      this.ashVel[i * 3] = (this.rand() - 0.5) * 0.6;
      this.ashVel[i * 3 + 1] = 0.4 + this.rand() * 0.8;
      this.ashVel[i * 3 + 2] = (this.rand() - 0.5) * 0.5;
    }
  }

  override dispose(): void {
    super.dispose();
    this.embers.geometry.dispose();
    this.ash.geometry.dispose();
    (this.scorch.geometry as THREE.BufferGeometry).dispose();
  }
}
