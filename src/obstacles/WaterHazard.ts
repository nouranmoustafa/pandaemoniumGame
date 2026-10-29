import * as THREE from 'three';
import { ahead, LANES, type LaneIndex, POWERS } from '../config';
import { clamp, easeOutBack, easeOutCubic, mulberry32, smoothstep } from '../core/math';
import { nightEnvironment, omenFigures } from '../world/Textures';
import { Obstacle, type ObstacleContext } from './Obstacle';

const DROPS = 70;
const BUBBLES = 12;
const PUDDLE_RX = 2.0;
const PUDDLE_RZ = 1.2;
const SLICK_TIME = 6;

let puddleGeo: THREE.BufferGeometry | null = null;
let columnGeo: THREE.BufferGeometry | null = null;
let dropGeo: THREE.BufferGeometry | null = null;
let ringGeo: THREE.BufferGeometry | null = null;

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
}

/**
 * Water: a puddle spreads across a lane (bubbling, rippling), erupts into a
 * brief fountain that blocks the lane as she approaches, then lingers as slick
 * stone that steals her footing. Rarely, the reflection shows three figures
 * standing where no one is standing.
 */
export class WaterHazard extends Obstacle {
  readonly kind = 'water' as const;
  readonly windup = POWERS.water.windup;
  readonly strikeLead = 0.38;

  private pivot = new THREE.Group();
  private puddleMat: THREE.MeshPhongMaterial;
  private puddle: THREE.Mesh;
  private rim: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private column: THREE.Mesh;
  private columnMat: THREE.ShaderMaterial;
  private drops: THREE.InstancedMesh;
  private dropData: Drop[] = [];
  private bubbles: THREE.InstancedMesh;
  private omen: THREE.Mesh | null = null;
  private omenMat: THREE.ShaderMaterial | null = null;
  private uniforms = { uTime: { value: 0 }, uRipple: { value: 0.3 } };
  private time = 0;
  private size = 0;
  private colHeight = 0;
  private rand: () => number;
  private laneZ: number;
  private m4 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(x: number, lane: LaneIndex, seed: number, withOmen: boolean) {
    super(x, [lane], new THREE.Group());
    this.dynamic = true;
    this.halfLength = POWERS.water.footprint;
    this.rand = mulberry32(seed);
    this.laneZ = LANES[lane];

    puddleGeo ??= new THREE.RingGeometry(0.001, 1, 48, 10);
    if (!columnGeo) {
      columnGeo = new THREE.CylinderGeometry(0.26, 0.55, 1, 20, 10, true);
      columnGeo.translate(0, 0.5, 0);
    }
    dropGeo ??= new THREE.SphereGeometry(0.032, 6, 4);
    ringGeo ??= new THREE.RingGeometry(0.9, 1, 40);

    this.pivot.position.set(x, 0, this.laneZ);
    this.group.add(this.pivot);

    // Wet stone halo around the puddle.
    this.rim = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.rim.rotation.x = -Math.PI / 2;
    this.rim.position.y = 0.025;
    this.pivot.add(this.rim);

    // The puddle: a mirror of the night with travelling ripples.
    // Phong samples the equirect panorama directly — no PMREM prefilter pass.
    this.puddleMat = new THREE.MeshPhongMaterial({
      color: 0x0d0f18,
      specular: 0x8890b0,
      shininess: 90,
      envMap: nightEnvironment(),
      reflectivity: 0.85,
      combine: THREE.MixOperation,
      transparent: true,
      opacity: 0.94,
    });
    const u = this.uniforms;
    this.puddleMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uRipple;')
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3(normal);
           float rr = length(position.xy);
           float dh = cos(rr * 16.0 - uTime * 5.0) * 16.0 * 0.01 * uRipple;
           objectNormal.xy -= normalize(position.xy + 1e-4) * dh;
           objectNormal = normalize(objectNormal);
           #ifdef USE_TANGENT
             vec3 objectTangent = vec3(tangent.xyz);
           #endif`,
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(length(position.xy) * 16.0 - uTime * 5.0) * 0.01 * uRipple;');
    };
    this.puddleMat.customProgramCacheKey = () => 'puddle';
    this.puddle = new THREE.Mesh(puddleGeo, this.puddleMat);
    this.puddle.rotation.x = -Math.PI / 2;
    this.puddle.position.y = 0.04;
    this.puddle.receiveShadow = true;
    this.pivot.add(this.puddle);

    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xaab8e8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      r.rotation.x = -Math.PI / 2;
      r.position.y = 0.06;
      r.userData.phase = i / 3;
      this.rings.push(r);
      this.pivot.add(r);
    }

    // Bubbles rising through it during the warning.
    const dropMat = new THREE.MeshPhongMaterial({ color: 0x6a7690, specular: 0x9aa4c8, shininess: 60, envMap: nightEnvironment(), reflectivity: 0.5, combine: THREE.MixOperation, transparent: true, opacity: 0.7 });
    this.bubbles = new THREE.InstancedMesh(dropGeo, dropMat, BUBBLES);
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);

    // Fountain column + spray.
    this.columnMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: u.uTime, uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv; varying float vH;
        void main() {
          vUv = uv; vH = position.y;
          vec3 p = position;
          float wob = sin(uTime * 14.0 + position.y * 9.0) * 0.05 + sin(uTime * 7.0 + position.y * 4.0) * 0.06;
          p.xz *= 1.0 + wob + position.y * 0.35;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uAlpha; varying vec2 vUv; varying float vH;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main() {
          vec2 g = vec2(vUv.x * 24.0, vUv.y * 6.0 - uTime * 9.0);
          float streak = smoothstep(0.55, 1.0, hash(floor(g)) * (0.7 + 0.3 * sin(g.y)));
          float body = 0.13 + streak * 0.4;
          float top = smoothstep(1.0, 0.75, vUv.y);
          float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
          vec3 col = mix(vec3(0.3, 0.36, 0.5), vec3(0.78, 0.84, 0.94), streak);
          gl_FragColor = vec4(col, body * top * uAlpha * (0.6 + 0.4 * edge));
        }`,
    });
    this.column = new THREE.Mesh(columnGeo, this.columnMat);
    this.column.visible = false;
    this.pivot.add(this.column);

    this.drops = new THREE.InstancedMesh(dropGeo, dropMat, DROPS);
    this.drops.frustumCulled = false;
    this.group.add(this.drops);
    for (let i = 0; i < DROPS; i++) this.dropData.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 });

    if (withOmen) this.buildOmen();
  }

  /**
   * The omen: three figures seen only in the water. Drawn as an anamorphic
   * decal on the puddle surface — stretched along the view direction so the
   * camera's foreshortening cancels out and they read upright on screen,
   * inverted like a reflection, and clipped to the puddle's edge.
   */
  private buildOmen(): void {
    this.omenMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: omenFigures() },
        uTime: this.uniforms.uTime,
        uAlpha: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uRad: { value: new THREE.Vector2(PUDDLE_RX, PUDDLE_RZ) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uTime; uniform float uAlpha;
        uniform vec3 uCenter; uniform vec2 uRad;
        varying vec2 vUv; varying vec3 vWorld;
        void main() {
          vec2 e = (vWorld.xz - uCenter.xz) / uRad;
          float inside = smoothstep(1.0, 0.78, length(e));
          if (inside <= 0.0) discard;
          vec2 uv = vUv;
          uv.x += sin(uv.y * 30.0 + uTime * 3.0) * 0.01 + sin(uv.y * 9.0 - uTime * 1.3) * 0.008;
          vec4 tex = texture2D(uMap, uv);
          // A faint moonlit sheen behind them so the silhouettes read.
          vec3 col = mix(vec3(0.46, 0.42, 0.64), vec3(0.0), tex.a);
          gl_FragColor = vec4(col, inside * uAlpha * (0.25 + 0.7 * tex.a));
        }`,
    });
    // Narrow across, long along the view direction (the anamorphic stretch).
    this.omen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.6), this.omenMat);
    this.omen.renderOrder = 7;
    this.omen.frustumCulled = false;
    this.group.add(this.omen);
  }

  override get threatening(): boolean {
    return this.state === 'warning' || this.state === 'striking' || this.state === 'holding';
  }

  update(dt: number, ctx: ObstacleContext): void {
    this.time += dt;
    this.stateTime += dt;
    this.uniforms.uTime.value = this.time;
    const v = ctx.visitor;
    const c = v.controller;
    const pav = ctx.pavement;

    let slick = false;
    switch (this.state) {
      case 'warning':
        this.size = easeOutCubic(clamp(this.stateTime / 0.7, 0, 1));
        slick = this.stateTime > 0.5;
        this.uniforms.uRipple.value = 0.4 + 0.6 * smoothstep(0, this.windup, this.stateTime);
        if (ahead(this.x, c.x) > this.halfLength) this.setState('retracting');
        break;
      case 'striking':
        this.colHeight = easeOutBack(clamp(this.stateTime / 0.24, 0, 1)) * 3.3;
        slick = true;
        this.uniforms.uRipple.value = 1.6;
        if (this.stateTime >= 0.24) this.setState('holding');
        break;
      case 'holding':
        this.colHeight = 3.3 + Math.sin(this.time * 11) * 0.15;
        slick = true;
        if (this.stateTime > 1.05 || ahead(this.x, c.x) > 3) this.setState('retracting');
        break;
      case 'retracting': {
        this.colHeight = Math.max(0, this.colHeight - dt * 7);
        slick = this.stateTime < SLICK_TIME;
        this.uniforms.uRipple.value = 0.3 + Math.max(0, 1 - this.stateTime) * 0.8;
        if (this.stateTime > SLICK_TIME) this.size = Math.max(0, 1 - (this.stateTime - SLICK_TIME) / 1.2);
        if (this.stateTime > SLICK_TIME + 1.2) {
          this.setState('spent');
          ctx.bus.emit('obstacle:end', { kind: 'water', x: this.x });
        }
        break;
      }
    }

    // --- Gameplay ---
    const dx = (c.x - this.x) / PUDDLE_RX;
    const dz = (c.z - this.laneZ) / PUDDLE_RZ;
    if (slick && this.size > 0.3 && dx * dx + dz * dz < this.size * this.size) c.applyTraction(0.22);
    const fountainUp = (this.state === 'striking' && this.stateTime > 0.08) || (this.state === 'holding' && this.stateTime < 0.95);
    if (fountainUp && !this.landed && this.overlapsVisitor(v, 1.3, 1.0)) {
      if (c.catch('water', Math.random() < 0.5 ? 'L' : 'R')) this.landed = true;
    }

    // --- Visuals ---
    const near = Math.abs(this.x - c.x) < 90;
    this.group.visible = near && this.state !== 'spent';
    if (!this.group.visible) return;
    this.pivot.position.y = pav.heightAt(this.x, this.laneZ);
    this.pivot.rotation.z = Math.atan(pav.slopeAt(this.x, this.laneZ));
    this.puddle.scale.set(PUDDLE_RX * this.size, PUDDLE_RZ * this.size, 1);
    this.rim.scale.set(PUDDLE_RX * 1.25 * this.size, PUDDLE_RZ * 1.35 * this.size, 1);
    (this.rim.material as THREE.MeshBasicMaterial).opacity = 0.45 * this.size;
    for (const r of this.rings) {
      const k = (this.time * 0.8 + r.userData.phase) % 1;
      r.scale.set(PUDDLE_RX * this.size * k, PUDDLE_RZ * this.size * k, 1);
      (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.22 * this.uniforms.uRipple.value * this.size;
    }

    // Bubbles while it gathers.
    const bubbling = this.state === 'warning' ? smoothstep(0.2, 1, this.stateTime / this.windup) : 0;
    const base = this.pivot.position;
    for (let i = 0; i < BUBBLES; i++) {
      const ph = (this.time * (1.2 + (i % 4) * 0.3) + i * 0.37) % 1;
      const a = i * 2.4;
      const r = 0.2 + ((i * 0.618) % 1) * 1.1;
      this.v.set(base.x + Math.cos(a) * r * this.size, base.y + 0.04 + ph * 0.08, base.z + Math.sin(a) * r * 0.6 * this.size);
      this.s.setScalar(bubbling * (0.6 + ph) * (ph < 0.92 ? 1 : 0));
      this.bubbles.setMatrixAt(i, this.m4.compose(this.v, this.q.identity(), this.s));
    }
    this.bubbles.instanceMatrix.needsUpdate = true;

    // Fountain.
    this.column.visible = this.colHeight > 0.02;
    this.column.scale.set(1, Math.max(0.01, this.colHeight), 1);
    this.columnMat.uniforms.uAlpha.value = clamp(this.colHeight / 1.5, 0, 1);
    const spraying = this.state === 'striking' || this.state === 'holding';
    for (let i = 0; i < DROPS; i++) {
      const d = this.dropData[i];
      d.life -= dt;
      if (d.life <= 0 && spraying) {
        const a = this.rand() * Math.PI * 2;
        const sp = 1.5 + this.rand() * 2.5;
        d.p.set(base.x + Math.cos(a) * 0.3, base.y + this.colHeight * (0.7 + this.rand() * 0.3), base.z + Math.sin(a) * 0.3);
        d.v.set(Math.cos(a) * sp, 1 + this.rand() * 3, Math.sin(a) * sp);
        d.life = 0.6 + this.rand() * 0.6;
      }
      if (d.life > 0) {
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        if (d.p.y < base.y) d.life = 0;
      }
      this.s.setScalar(d.life > 0 ? 1 : 0);
      this.drops.setMatrixAt(i, this.m4.compose(d.p, this.q.identity(), this.s));
    }
    this.drops.instanceMatrix.needsUpdate = true;

    // The omen: visible only while she is far enough not to look closely.
    if (this.omenMat && this.omen) {
      const dist = ahead(c.x, this.x);
      const show = this.state === 'warning' ? smoothstep(0.3, 0.9, this.stateTime / this.windup) * smoothstep(6, 11, dist) : 0;
      const cur = this.omenMat.uniforms.uAlpha.value as number;
      this.omenMat.uniforms.uAlpha.value = cur + (show * 0.9 - cur) * Math.min(1, dt * 4);
      // Lie flat on the water; the texture's 'up' points away from the camera,
      // so the figures' feet sit at the far edge and their heads hang toward her.
      ctx.camera.getWorldPosition(this.v);
      const ax = this.x - this.v.x;
      const az = this.laneZ - this.v.z;
      this.omen.position.set(this.x, base.y + 0.07, this.laneZ);
      this.omen.rotation.set(-Math.PI / 2, Math.atan2(-ax, -az), 0, 'YXZ');
      const u = this.omenMat.uniforms;
      (u.uCenter.value as THREE.Vector3).set(this.x, base.y + 0.04, this.laneZ);
      (u.uRad.value as THREE.Vector2).set(PUDDLE_RX * this.size * 0.95, PUDDLE_RZ * this.size * 0.95);
      this.omen.visible = (u.uAlpha.value as number) > 0.01;
    }
  }
}
