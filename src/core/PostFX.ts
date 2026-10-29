import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uHurt: { value: 0 },
    uGrain: { value: 0.06 },
    uWarm: { value: 0 },
    uTunnel: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uHurt; uniform float uGrain; uniform float uWarm; uniform float uTunnel;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r = length(d);
      // Chromatic fringe at the edges, stronger when hurt.
      float ca = (0.0012 + uHurt * 0.006) * r;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + d * ca * 2.0).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - d * ca * 2.0).b;
      // Cool shadows, warm highlights.
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c * vec3(0.92, 0.95, 1.08), c * vec3(1.06, 1.0, 0.92), smoothstep(0.25, 0.9, l));
      // Dusk: warm, slightly lifted shadows; the park takes it away.
      c = mix(c, c * vec3(1.08, 0.98, 0.86) + vec3(0.012, 0.006, 0.0), uWarm);
      // Vignette.
      float v = smoothstep(0.85, 0.25, r * (uVignette + uTunnel * 2.2));
      c *= mix(0.35 - uTunnel * 0.35, 1.0, v);
      // Passing out: the colour drains and the dark closes in from the edges.
      c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))) * 0.7, uTunnel * 0.75);
      c = mix(c, c * vec3(1.4, 0.4, 0.45), uHurt * smoothstep(0.2, 0.8, r));
      // Film grain.
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0) - 0.5;
      c += g * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  private grade: ShaderPass;
  private bloom: UnrealBloomPass;
  private hurt = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.75, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  /** 0..1 — the warm evening grade. */
  setWarmth(w: number): void {
    this.grade.uniforms.uWarm.value = w;
    // The plaza's lamps sit close to the lens in the prologue: gentler, tighter bloom there.
    this.bloom.strength = 0.75 - w * 0.33;
    this.bloom.threshold = 0.82 + w * 0.08;
  }

  /** 0..1 — she is losing consciousness: tunnel vision, colour draining. */
  setTunnel(k: number): void {
    this.grade.uniforms.uTunnel.value = k;
  }

  pulseHurt(): void {
    this.hurt = 1;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.grade.uniforms.uTime.value += dt;
    this.grade.uniforms.uHurt.value = this.hurt;
    this.composer.render(dt);
  }
}
