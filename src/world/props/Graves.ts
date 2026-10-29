import * as THREE from 'three';
import { mulberry32 } from '../../core/math';

/** Who lies here: her three friends — and one stone still waiting for its name. */
const STONES: Array<{ name: string; shape: 'round' | 'cross' | 'pointed' | 'slab' }> = [
  { name: 'ODETTE', shape: 'round' },
  { name: 'JUNO', shape: 'cross' },
  { name: 'WREN', shape: 'pointed' },
  { name: '', shape: 'slab' },
];

let stoneMat: THREE.MeshStandardMaterial | null = null;
let earthMat: THREE.MeshStandardMaterial | null = null;
const faces = new Map<string, THREE.MeshStandardMaterial>();

/** Worn lettering, dark in the stone: legible only up close. */
function faceMaterial(name: string): THREE.MeshStandardMaterial {
  let m = faces.get(name);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(14, 12, 18, 0.78)';
  g.textAlign = 'center';
  if (name) {
    g.font = '600 44px Georgia, serif';
    g.fillText(name, 128, 104);
    g.font = '400 22px Georgia, serif';
    g.fillText('BELOVED FRIEND', 128, 146);
    g.fillRect(78, 168, 100, 3);
  } else {
    // The fourth stone is blank: freshly cut, waiting.
    g.fillRect(96, 120, 64, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  faces.set(name, m);
  return m;
}

function stoneGeometry(shape: (typeof STONES)[number]['shape']): THREE.BufferGeometry {
  if (shape === 'cross') {
    const post = new THREE.BoxGeometry(0.16, 1.05, 0.14).translate(0, 0.52, 0);
    const bar = new THREE.BoxGeometry(0.56, 0.15, 0.14).translate(0, 0.74, 0);
    const base = new THREE.BoxGeometry(0.5, 0.18, 0.34).translate(0, 0.09, 0);
    return mergeAll([post, bar, base]);
  }
  if (shape === 'pointed') {
    const s = new THREE.Shape();
    s.moveTo(-0.27, 0);
    s.lineTo(0.27, 0);
    s.lineTo(0.27, 0.72);
    s.lineTo(0, 0.98);
    s.lineTo(-0.27, 0.72);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.13, bevelEnabled: false }).translate(0, 0, -0.065);
  }
  const s = new THREE.Shape();
  const w = shape === 'slab' ? 0.3 : 0.29;
  const h = shape === 'slab' ? 0.62 : 0.66;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, h);
  if (shape === 'round') s.absarc(0, h, w, 0, Math.PI, false);
  else s.lineTo(-w, h);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: shape === 'slab' ? 0.16 : 0.12, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -0.06);
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small and few: concatenate by hand rather than pull in BufferGeometryUtils here.
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of geos) {
    const ng = g.toNonIndexed();
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    nor.push(...(ng.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/**
 * Four headstones in the long grass: her friends' three names, and a blank one.
 * Set back in the dark where nobody looks — there to be noticed, not shown.
 */
export class Graves {
  readonly group = new THREE.Group();

  /** `facing` is the yaw that turns the stones' faces toward where the camera usually is. */
  constructor(x: number, z: number, facing: number, seed = 1, groundAt: (x: number, z: number) => number = () => 0, scale = 1) {
    stoneMat ??= new THREE.MeshStandardMaterial({ color: 0x4b4852, roughness: 0.96, metalness: 0 });
    earthMat ??= new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1 });
    const rand = mulberry32(seed);
    STONES.forEach((st, i) => {
      const root = new THREE.Group();
      const lx = ((i - 1.5) * 1.15 + (rand() - 0.5) * 0.25) * scale;
      const lz = (rand() - 0.5) * 0.5;
      const wx = x + Math.cos(facing) * lx + Math.sin(facing) * lz;
      const wz = z - Math.sin(facing) * lx + Math.cos(facing) * lz;
      root.position.set(wx, groundAt(wx, wz) - 0.04, wz);
      root.rotation.y = facing + (rand() - 0.5) * 0.25;
      root.scale.setScalar(scale);
      // Old stones lean; the blank one stands straight.
      const stone = new THREE.Mesh(stoneGeometry(st.shape), stoneMat!);
      stone.rotation.z = st.name ? (rand() - 0.5) * 0.16 : 0;
      stone.rotation.x = st.name ? -rand() * 0.1 : 0;
      stone.castShadow = stone.receiveShadow = true;
      root.add(stone);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), faceMaterial(st.name));
      face.position.set(0, st.shape === 'cross' ? 0.42 : 0.4, st.shape === 'slab' ? 0.085 : 0.066);
      stone.add(face);
      // The grave itself: a low mound before the stone (the blank one freshly turned).
      const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), earthMat!);
      mound.scale.set(0.42, st.name ? 0.12 : 0.2, 0.95);
      mound.position.set(0, 0, 1.0);
      mound.receiveShadow = true;
      root.add(mound);
      this.group.add(root);
    });
  }
}
