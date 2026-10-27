import * as THREE from 'three';
import { damp, mulberry32, smoothstep } from '../core/math';
import { glowTexture } from './Textures';

/** Where the prologue happens (world X; the chase course starts at 0). */
export const ENTRANCE = {
  gateX: -22,
  /** The friends' spot on the plaza, just outside the gate. */
  group: new THREE.Vector3(-29, 0, 0.6),
  /** Where the Visitor takes control and the chase begins. */
  handoffX: -1.5,
  plazaEnd: -22.3,
};

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function flagstones(): THREE.CanvasTexture {
  const rand = mulberry32(41);
  const t = canvasTex(512, 512, (g) => {
    g.fillStyle = '#5a5250';
    g.fillRect(0, 0, 512, 512);
    // Irregular rows of worn slabs with dark joints.
    let y = 0;
    while (y < 512) {
      const h = 60 + rand() * 50;
      let x = -rand() * 80;
      while (x < 512) {
        const w = 70 + rand() * 90;
        const l = 70 + rand() * 30;
        g.fillStyle = `rgb(${l + 18},${l + 10},${l + 6})`;
        g.fillRect(x + 3, y + 3, w - 6, h - 6);
        for (let i = 0; i < 30; i++) {
          g.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
          g.fillRect(x + rand() * w, y + rand() * h, 3 + rand() * 12, 2 + rand() * 8);
        }
        x += w;
      }
      y += h;
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A narrow townhouse facade: dark brick, warm windows, someone's curtains. */
function facade(seed: number, floors: number, cols: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const rand = mulberry32(seed);
  const W = 256;
  const H = 128 * floors;
  const lit: Array<[number, number, number, number, string]> = [];
  const map = canvasTex(W, H, (g) => {
    g.fillStyle = ['#3a2a28', '#2e2a30', '#3c3230', '#2a2228'][seed % 4];
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.15})`;
      g.fillRect(rand() * W, rand() * H, 10, 4);
    }
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const ww = (W / cols) * 0.46;
        const wh = 128 * 0.52;
        const x = (W / cols) * (c + 0.5) - ww / 2;
        const y = f * 128 + 30;
        g.fillStyle = '#0c0a0c';
        g.fillRect(x - 4, y - 4, ww + 8, wh + 8);
        g.fillStyle = '#151218';
        g.fillRect(x, y, ww, wh);
        if (f < floors - 0 && rand() < 0.45) lit.push([x, y, ww, wh, rand() < 0.3 ? '#ffd9a0' : '#ffb466']);
      }
    }
  });
  const emissive = canvasTex(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    for (const [x, y, ww, wh, col] of lit) {
      const gr = g.createLinearGradient(x, y, x, y + wh);
      gr.addColorStop(0, col);
      gr.addColorStop(1, '#7a4a20');
      g.fillStyle = gr;
      g.fillRect(x, y, ww, wh);
      // Curtains and mullions.
      g.fillStyle = 'rgba(40,10,10,0.55)';
      g.fillRect(x, y, ww * 0.22, wh);
      g.fillRect(x + ww * 0.78, y, ww * 0.22, wh);
      g.fillStyle = '#0c0a0c';
      g.fillRect(x + ww / 2 - 2, y, 4, wh);
      g.fillRect(x, y + wh * 0.45, ww, 3);
    }
  });
  return { map, emissive };
}

/**
 * The edge of town and the gate into the park — the warm, ordinary place
 * the prologue starts. Past the gate everything slowly goes wrong.
 */
export class ParkEntrance {
  readonly group = new THREE.Group();
  readonly keyLight: THREE.SpotLight;
  readonly fill: THREE.PointLight;
  private swing = new THREE.Group();
  private swingAngle = 0;
  private swingVel = 0;
  private branch = new THREE.Group();
  private branchT = -1;
  private time = 0;

  constructor() {
    const rand = mulberry32(808);
    const iron = new THREE.MeshStandardMaterial({ color: 0x0d0c10, roughness: 0.5, metalness: 0.6 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x5a5254, roughness: 0.9 });
    const glow = glowTexture('rgba(255,196,120,1)');

    // --- Plaza ---
    const plazaTex = flagstones();
    plazaTex.repeat.set(10, 9);
    const plaza = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 40),
      new THREE.MeshStandardMaterial({ map: plazaTex, color: 0xb0a49a, roughness: 0.78, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(-22.3 - 18, 0.025, 0);
    plaza.receiveShadow = true;
    this.group.add(plaza);
    // Road and kerbs along the far side of the plaza.
    const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 120), new THREE.MeshStandardMaterial({ color: 0x1a181c, roughness: 0.35, metalness: 0.2 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(-47, 0.03, 0);
    road.receiveShadow = true;
    this.group.add(road);
    for (const x of [-43, -51]) {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.16, 120), stone);
      kerb.position.set(x, 0.08, 0);
      kerb.receiveShadow = true;
      this.group.add(kerb);
    }
    const lines = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 120), new THREE.MeshBasicMaterial({ color: 0x8a8070 }));
    lines.rotation.x = -Math.PI / 2;
    lines.position.set(-47, 0.035, 0);
    this.group.add(lines);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(14, 140), new THREE.MeshStandardMaterial({ map: plazaTex, color: 0x8a8078, roughness: 0.85 }));
    far.rotation.x = -Math.PI / 2;
    far.position.set(-58, 0.025, 0);
    this.group.add(far);

    // --- Townhouses across the road, leaning slightly into one another ---
    let z = -60;
    let seed = 1;
    while (z < 60) {
      const width = 5 + rand() * 3;
      const floors = 3 + Math.floor(rand() * 3);
      const h = floors * 3.1;
      const { map, emissive } = facade(seed++, floors, width > 6.5 ? 3 : 2);
      const mat = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: emissive, emissiveIntensity: 1.4, roughness: 0.9 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a1518, roughness: 0.95 });
      const g = new THREE.BoxGeometry(6, h, width);
      // Expressionist lean: the tops drift a little.
      const lean = (rand() - 0.5) * 0.06;
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, p.getZ(i) + lean * h);
      g.computeVertexNormals();
      const house = new THREE.Mesh(g, [mat, dark, dark, dark, dark, dark]);
      house.position.set(-62, h / 2, z + width / 2);
      house.castShadow = false;
      house.receiveShadow = true;
      this.group.add(house);
      // Gable roof.
      const roof = new THREE.Mesh(new THREE.ConeGeometry(width * 0.75, 2.2 + rand() * 1.5, 4, 1), new THREE.MeshStandardMaterial({ color: 0x141018, roughness: 0.8 }));
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(6 / (width * 1.06), 1, 1);
      roof.position.set(-62, h + 1, z + width / 2 + lean * h);
      this.group.add(roof);
      if (rand() < 0.6) {
        const ch = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), dark);
        ch.position.set(-62 + (rand() - 0.5) * 3, h + 1.6, z + width * rand() + lean * h);
        this.group.add(ch);
      }
      z += width + 0.05;
    }

    // --- Lamp posts: straight, warm, civic — the last honest lights ---
    const lampSpots: Array<[number, number]> = [
      [-26, -4.4],
      [-31.5, 8.2],
      [-41, -5.2],
      [-41, 9],
      [-41, -18],
    ];
    for (const [x, lz] of lampSpots) this.group.add(this.lampPost(x, lz, iron, glow));
    this.keyLight = new THREE.SpotLight(0xffb070, 70, 22, 0.75, 0.6, 1.4);
    this.keyLight.position.set(-26, 4.4, -4.1);
    this.keyLight.target.position.copy(ENTRANCE.group);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 24;
    this.group.add(this.keyLight, this.keyLight.target);
    this.fill = new THREE.PointLight(0xffa860, 26, 16, 1.4);
    this.fill.position.set(-34, 3.6, 4.4);
    this.group.add(this.fill);

    // --- The gate ---
    this.group.add(this.gate(stone, iron, glow));

    // --- Ordinary trees: round, leafy, cared for ---
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2c24, roughness: 0.95 });
    const leafMats = [0x3e4a2a, 0x5a4a22, 0x4a3a22, 0x34402c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
    const treeSpots: Array<[number, number, number]> = [];
    for (let x = -40; x < -12; x += 4 + rand() * 3) {
      treeSpots.push([x, -(8 + rand() * 6), 0.9 + rand() * 0.4]);
      if (x > -24) treeSpots.push([x + rand() * 2, 9 + rand() * 6, 0.9 + rand() * 0.4]);
    }
    treeSpots.push([-36, -12, 1.2], [-30, 12, 1.1], [-26, 14, 1.0]);
    for (const [x, tz, s] of treeSpots) {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 3.6, 7), trunkMat);
      trunk.position.y = 1.8;
      trunk.castShadow = true;
      t.add(trunk);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + rand() * 0.6, 1), leafMats[Math.floor(rand() * leafMats.length)]);
        leaf.position.set((rand() - 0.5) * 2, 3.8 + rand() * 1.6, (rand() - 0.5) * 2);
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        t.add(leaf);
      }
      t.position.set(x, 0, tz);
      t.scale.setScalar(s);
      t.rotation.y = rand() * 6;
      this.group.add(t);
    }

    // --- Furniture: a bench and a bin on the plaza ---
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.8 });
    const bench = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.12), wood);
      slat.position.set(0, 0.46, -0.16 + i * 0.16);
      bench.add(slat);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.05), wood);
    back.position.set(0, 0.75, -0.25);
    back.rotation.x = -0.15;
    bench.add(back);
    for (const bx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.5), iron);
      leg.position.set(bx, 0.23, -0.05);
      bench.add(leg);
    }
    bench.position.set(-35, 0.02, -6.5);
    bench.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(bench);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.9, 10), iron);
    bin.position.set(-27.5, 0.47, -5.4);
    bin.castShadow = true;
    this.group.add(bin);

    // --- Inside the gate: the first wrong things ---
    this.group.add(this.crookedSign(iron));
    this.group.add(this.swingSet(iron, wood));
    this.group.add(this.twitchTree());
  }

  private lampPost(x: number, z: number, iron: THREE.Material, glow: THREE.Texture): THREE.Group {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 4.2, 8), iron);
    post.position.y = 2.1;
    post.castShadow = true;
    g.add(post);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.5, 8), iron);
    base.position.y = 0.25;
    g.add(base);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.5, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc488).multiplyScalar(1.5) }));
    lantern.position.y = 4.45;
    g.add(lantern);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.3, 6), iron);
    cap.position.y = 4.85;
    g.add(cap);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    halo.position.y = 4.45;
    halo.scale.setScalar(1.5);
    g.add(halo);
    // A warm pool on the stones (cheaper than a real light per lamp).
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,170,90,0.5)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.04;
    g.add(pool);
    g.position.set(x, 0, z);
    return g;
  }

  private gate(stone: THREE.Material, iron: THREE.Material, glow: THREE.Texture): THREE.Group {
    const g = new THREE.Group();
    const x = ENTRANCE.gateX;
    for (const z of [-5.3, 5.3]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.4, 0.8), stone);
      pillar.position.set(x, 1.7, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      g.add(pillar);
      const capStone = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 1.0), stone);
      capStone.position.set(x, 3.5, z);
      g.add(capStone);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc080).multiplyScalar(1.3) }));
      lamp.position.set(x, 3.9, z);
      g.add(lamp);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
      halo.scale.setScalar(1.1);
      halo.position.copy(lamp.position);
      g.add(halo);
      // Railings running away from the gate.
      for (let i = 0; i < 26; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 0.05), iron);
        bar.position.set(x, 0.8, z + Math.sign(z) * (0.6 + i * 0.32));
        g.add(bar);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 8.4), iron);
      rail.position.set(x, 1.45, z + Math.sign(z) * 4.6);
      g.add(rail);
    }
    // The arch and its name.
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.06, 6, 40, Math.PI), iron);
    arch.rotation.y = Math.PI / 2;
    arch.scale.set(1, 0.32, 1);
    arch.position.set(x, 3.6, 0);
    g.add(arch);
    const sign = canvasTex(1024, 192, (c) => {
      c.fillStyle = '#0c0b0e';
      c.fillRect(0, 0, 1024, 192);
      c.strokeStyle = '#6a5a44';
      c.lineWidth = 6;
      c.strokeRect(12, 12, 1000, 168);
      c.fillStyle = '#c8b48a';
      c.font = 'italic 92px "IM Fell English SC", "Cormorant Garamond", serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('Ashgrove Gardens', 512, 100);
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.68), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6, metalness: 0.3, emissive: 0x3a2a18, emissiveMap: sign, emissiveIntensity: 0.5 }));
    plate.rotation.y = -Math.PI / 2;
    plate.position.set(x - 0.05, 4.65, 0);
    g.add(plate);
    const back = plate.clone();
    back.rotation.y = Math.PI / 2;
    back.position.x = x + 0.05;
    g.add(back);
    return g;
  }

  /** A notice that leans a little too far. */
  private crookedSign(iron: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), iron);
    post.position.y = 0.8;
    g.add(post);
    const tex = canvasTex(512, 256, (c) => {
      c.fillStyle = '#d8ccb0';
      c.fillRect(0, 0, 512, 256);
      c.fillStyle = '#2a1a12';
      c.font = 'bold 46px "Cormorant Garamond", serif';
      c.textAlign = 'center';
      c.fillText('THE GARDENS', 256, 90);
      c.fillText('CLOSE AT DUSK', 256, 150);
      c.font = 'italic 26px "Cormorant Garamond", serif';
      c.fillText('— the Keeper', 256, 210);
      for (let i = 0; i < 400; i++) {
        c.fillStyle = `rgba(60,40,20,${Math.random() * 0.15})`;
        c.fillRect(Math.random() * 512, Math.random() * 256, 6, 3);
      }
    });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.04), [iron, iron, iron, iron, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), iron]);
    board.position.set(0, 1.55, 0.05);
    g.add(board);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    g.position.set(-11, 0, -5.6);
    g.rotation.set(0, Math.PI / 2 - 0.3, -0.16);
    return g;
  }

  private swingSet(iron: THREE.Material, wood: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    for (const z of [-1.1, 1.1]) {
      for (const dx of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 6), iron);
        leg.position.set(dx * 0.5, 1.4, z);
        leg.rotation.z = dx * 0.32;
        g.add(leg);
      }
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), iron);
    bar.rotation.x = Math.PI / 2;
    bar.position.y = 2.75;
    g.add(bar);
    this.swing.position.y = 2.72;
    for (const z of [-0.25, 0.25]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.0, 4), iron);
      chain.position.set(0, -1.0, z);
      this.swing.add(chain);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.62), wood);
    seat.position.y = -2.0;
    this.swing.add(seat);
    g.add(this.swing);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    g.position.set(-6.5, 0, -13);
    g.rotation.y = 0.4;
    return g;
  }

  /** A bare tree by the path; one low branch is going to move on its own. */
  private twitchTree(): THREE.Group {
    const g = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x2a2430, roughness: 0.95 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, 5, 7), bark);
    trunk.position.y = 2.5;
    trunk.rotation.z = 0.08;
    g.add(trunk);
    this.branch.position.set(0.05, 2.6, 0);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 2.8, 6), bark);
    limb.geometry.translate(0, 1.4, 0);
    limb.rotation.z = -1.1;
    limb.rotation.y = 0.9;
    this.branch.add(limb);
    for (let i = 0; i < 3; i++) {
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.03, 0.9, 4), bark);
      twig.geometry.translate(0, 0.45, 0);
      twig.position.set(0.6 + i * 0.6, 0.4 + i * 0.3, 0.5 + i * 0.4);
      twig.rotation.set(0.3 * i, 0, -0.6 + i * 0.4);
      this.branch.add(twig);
    }
    g.add(this.branch);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    g.position.set(-3.5, 0, -7.4);
    return g;
  }

  /** The swing moves, though nobody is on it. */
  pushSwing(strength = 1.2): void {
    this.swingVel += strength;
  }

  twitchBranch(): void {
    this.branchT = 0;
  }

  reset(): void {
    this.swingAngle = this.swingVel = 0;
    this.branchT = -1;
    this.swing.rotation.z = 0;
    this.branch.rotation.set(0, 0, 0);
  }

  /** 0..1 — how much the plaza lights matter (they fade from relevance in the chase). */
  update(dt: number, nearPlaza: number): void {
    this.time += dt;
    // Pendulum with a little friction.
    this.swingVel += -this.swingAngle * 6 * dt - this.swingVel * 0.25 * dt;
    this.swingAngle += this.swingVel * dt;
    this.swing.rotation.z = this.swingAngle * 0.45;
    if (this.branchT >= 0) {
      this.branchT += dt;
      const t = this.branchT;
      // A sharp lift, then a slow, deliberate settle — not how wind moves things.
      const lift = smoothstep(0, 0.15, t) * (1 - smoothstep(0.5, 2.5, t));
      this.branch.rotation.z = lift * 0.22 + Math.sin(t * 22) * 0.02 * (1 - smoothstep(0, 0.6, t));
      this.branch.rotation.x = lift * -0.1;
      if (t > 3) this.branchT = -1;
    }
    // Lights: present while anyone could be looking at the plaza.
    this.keyLight.intensity = damp(this.keyLight.intensity, 70 * nearPlaza, 3, dt);
    this.fill.intensity = damp(this.fill.intensity, 26 * nearPlaza, 3, dt);
    this.keyLight.shadow.autoUpdate = nearPlaza > 0.02;
  }
}
