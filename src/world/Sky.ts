import * as THREE from 'three';
import { COLORS } from '../config';
import { mulberry32 } from '../core/math';
import { glowTexture, moonTexture } from './Textures';

/**
 * Gradient sky dome, stars, drifting cloud wisps and an unnaturally large moon.
 * Everything here is camera-anchored so it reads as infinitely far away.
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly moonDir = new THREE.Vector3(0.93, 0.14, -0.35).normalize();
  private clouds: THREE.Mesh[] = [];
  private moon: THREE.Mesh;
  private time = 0;

  constructor() {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(COLORS.skyTop) },
        horizon: { value: new THREE.Color(COLORS.skyHorizon) },
        glow: { value: new THREE.Color(0x6b5a9a) },
        moonDir: { value: this.moonDir },
        fogColor: { value: new THREE.Color(COLORS.fog) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 moonDir; uniform vec3 fogColor;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
          float m = max(dot(normalize(vDir), moonDir), 0.0);
          c += glow * pow(m, 18.0) * 0.9 + glow * pow(m, 4.0) * 0.18;
          // Faint sickly band just above the horizon.
          c += vec3(0.08, 0.04, 0.12) * exp(-abs(h - 0.06) * 9.0);
          // Melt into the fog at the horizon so the ground has no hard edge.
          c = mix(fogColor, c, smoothstep(-0.01, 0.1, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // Stars.
    const rand = mulberry32(99);
    const starPos: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * r * 850, y * 850, Math.sin(a) * r * 850);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xbfc4ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    stars.frustumCulled = false;
    this.group.add(stars);

    // The moon: wrong-sized, slightly too close.
    const moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, fog: false, depthWrite: false, color: 0xb8b0a2 });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonMat);
    this.moon.scale.setScalar(175);
    this.moon.position.copy(this.moonDir).multiplyScalar(700);
    this.moon.renderOrder = -9;
    this.group.add(this.moon);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('rgba(190,180,255,0.3)'), fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true }),
    );
    halo.scale.setScalar(480);
    halo.position.copy(this.moon.position);
    halo.renderOrder = -9;
    this.group.add(halo);

    // Thin cloud wisps that drift across the moon.
    const cloudTex = this.cloudTexture();
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.35 + rand() * 0.3, fog: false, depthWrite: false, color: 0x2c2448 }),
      );
      const yaw = Math.atan2(this.moonDir.z, this.moonDir.x) + (rand() - 0.5) * 1.4;
      const pitch = 0.12 + rand() * 0.35;
      m.position.set(Math.cos(yaw) * Math.cos(pitch) * 600, Math.sin(pitch) * 600, Math.sin(yaw) * Math.cos(pitch) * 600);
      m.scale.set(380 + rand() * 300, 50 + rand() * 50, 1);
      m.userData.speed = (rand() * 0.5 + 0.2) * 0.012;
      m.userData.yaw = yaw;
      m.userData.pitch = pitch;
      m.renderOrder = -8;
      this.clouds.push(m);
      this.group.add(m);
    }
  }

  private cloudTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    const rand = mulberry32(5);
    for (let i = 0; i < 70; i++) {
      const x = 60 + rand() * 392;
      const y = 40 + rand() * 48;
      const r = 20 + rand() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.group.position.copy(camera.position);
    this.moon.lookAt(camera.position);
    for (const cl of this.clouds) {
      cl.userData.yaw += cl.userData.speed * dt;
      const { yaw, pitch } = cl.userData as { yaw: number; pitch: number };
      cl.position.set(Math.cos(yaw) * Math.cos(pitch) * 600, Math.sin(pitch) * 600, Math.sin(yaw) * Math.cos(pitch) * 600);
      cl.lookAt(0, 0, 0);
    }
  }
}
