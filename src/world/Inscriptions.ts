import * as THREE from 'three';
import type { Pavement } from './Pavement';

export type InscriptionStyle = 'ember' | 'brass';

/** Paint a line of text onto a canvas texture (engraved look). */
export function inscriptionTexture(text: string, style: InscriptionStyle, w = 2048, h = 160): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const size = Math.floor(h * 0.62);
  g.font = `italic 500 ${size}px "Cormorant Garamond", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let fs = size;
  while (g.measureText(text).width > w * 0.94 && fs > 20) {
    fs -= 4;
    g.font = `italic 500 ${fs}px "Cormorant Garamond", Georgia, serif`;
  }
  if (style === 'ember') {
    // Burned into the stone: a dull ember glow around dark, cut letters.
    g.shadowColor = 'rgba(190,50,30,0.95)';
    g.shadowBlur = h * 0.14;
    g.fillStyle = 'rgba(210,90,60,0.95)';
    g.fillText(text, w / 2, h / 2);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,196,150,0.9)';
    g.fillText(text, w / 2, h / 2);
  } else {
    // Engraved brass: highlight below, dark cut above.
    g.fillStyle = 'rgba(255,220,160,0.55)';
    g.fillText(text, w / 2, h / 2 + 2);
    g.fillStyle = 'rgba(30,18,8,0.95)';
    g.fillText(text, w / 2, h / 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Text that writes itself left to right, then fades. */
export function revealMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: map }, uReveal: { value: 0 }, uAlpha: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uReveal; uniform float uAlpha; uniform float uTime; varying vec2 vUv;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float edge = smoothstep(uReveal, uReveal - 0.04, vUv.x);
        float flick = 0.88 + 0.12 * sin(uTime * 6.0 + vUv.x * 30.0);
        gl_FragColor = vec4(t.rgb * flick, t.a * edge * uAlpha);
      }`,
  });
}

interface Inscription {
  root: THREE.Group;
  mat: THREE.ShaderMaterial;
  x: number;
  z: number;
  age: number;
  fade: number;
}

let stoneMat: THREE.MeshStandardMaterial | null = null;
let stoneGeo: THREE.BufferGeometry | null = null;

/**
 * The Demon's remarks, written into the world rather than floated over it:
 * an old memorial stone rises out of the verge beside the path, the words
 * burning onto its face as she approaches, and sinks again once she has
 * passed. (Signs and the bench carry their own plaques — see Signpost/Bench.)
 */
export class Inscriptions {
  readonly group = new THREE.Group();
  private items: Inscription[] = [];

  constructor(private pavement: Pavement) {}

  /** Raise a stone bearing `text` at x, on the far verge of the path. */
  write(text: string, x: number, z = -4.9): void {
    stoneMat ??= new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 0.95 });
    if (!stoneGeo) {
      stoneGeo = new THREE.BoxGeometry(3.6, 0.95, 0.22);
      stoneGeo.translate(0, 0.475, 0);
    }
    const root = new THREE.Group();
    const stone = new THREE.Mesh(stoneGeo, stoneMat);
    stone.castShadow = stone.receiveShadow = true;
    root.add(stone);
    const mat = revealMaterial(inscriptionTexture(text, 'ember', 2048, 200));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.33), mat);
    face.position.set(0, 0.5, 0.112);
    root.add(face);
    // Turned toward the approaching camera so it reads as she nears it.
    root.rotation.set(-0.06, -0.5, 0.03);
    root.position.set(x, -1.2, z);
    this.group.add(root);
    this.items.push({ root, mat, x, z, age: 0, fade: -1 });
  }

  update(dt: number, visitorX: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      it.mat.uniforms.uTime.value = it.age;
      // Rises first, then the words burn in.
      const rise = Math.min(1, it.age / 0.8);
      it.mat.uniforms.uReveal.value = Math.min(1.05, Math.max(0, it.age - 0.5) / 1.5);
      if (it.fade < 0 && visitorX > it.x + 5) it.fade = 0;
      let sink = 0;
      if (it.fade >= 0) {
        it.fade += dt;
        sink = Math.min(1, it.fade / 1.6);
        it.mat.uniforms.uAlpha.value = Math.max(0, 1 - it.fade / 0.8);
        if (it.fade > 1.7) {
          this.remove(i);
          continue;
        }
      }
      const ground = this.pavement.heightAt(it.x, it.z);
      const ease = 1 - Math.pow(1 - rise, 3);
      it.root.position.y = ground - 1.2 + 1.2 * ease - 1.2 * sink * sink;
    }
  }

  private remove(i: number): void {
    const it = this.items[i];
    it.root.removeFromParent();
    (it.mat.uniforms.uMap.value as THREE.Texture).dispose();
    it.mat.dispose();
    this.items.splice(i, 1);
  }

  clear(): void {
    for (let i = this.items.length - 1; i >= 0; i--) this.remove(i);
  }
}
