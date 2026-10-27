import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { bladeGeometry } from './geometry';
import { Pavement } from './Pavement';

/**
 * An endless field of wind-blown grass beside the path. Blades live in a
 * fixed-size strip that wraps around the camera in the vertex shader, so the
 * field is effectively infinite at a constant cost.
 */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  private uniforms = {
    uTime: { value: 0 },
    uCenter: { value: 0 },
    uSpan: { value: 150 },
    uGust: { value: 0 },
  };

  constructor(count = 20000) {
    const rand = mulberry32(77);
    const geo = bladeGeometry(0.06);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3d5a48,
      roughness: 0.9,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime; uniform float uCenter; uniform float uSpan; uniform float uGust;`,
        )
        .replace(
          '#include <project_vertex>',
          `
          mat4 gIm = instanceMatrix;
          float ix = gIm[3][0];
          float wx = mod(ix - uCenter + uSpan * 0.5, uSpan) + uCenter - uSpan * 0.5;
          gIm[3][0] = wx;
          vec4 mvPosition = gIm * vec4(transformed, 1.0);
          float h = clamp(position.y, 0.0, 1.0);
          float w = sin(uTime * 1.6 + wx * 0.31 + gIm[3][2] * 0.17) * 0.6 + sin(uTime * 3.7 + wx * 1.3) * 0.18;
          mvPosition.x += (w * 0.22 + uGust) * h * h;
          mvPosition.z += w * 0.1 * h * h;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;
          `,
        );
    };

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    const color = new THREE.Color();
    const span = u.uSpan.value;
    for (let i = 0; i < count; i++) {
      const x = rand() * span - span / 2;
      // Denser near the path edges, thinning into the distance.
      const far = rand() < 0.62;
      const dist = Math.pow(rand(), 1.7);
      const edge = Pavement.halfWidth(x) + 0.1;
      const z = far ? -(edge + dist * 34) : edge + dist * 9;
      p.set(x, -0.02, z);
      e.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
      q.setFromEuler(e);
      const tall = 0.35 + rand() * 0.75 + (dist < 0.1 ? 0.25 : 0);
      s.set(1 + rand(), tall, 1);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
      color.setHSL(0.36 + rand() * 0.12, 0.25 + rand() * 0.15, 0.22 + rand() * 0.18);
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, centerX: number, gust: number): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uCenter.value = centerX;
    this.uniforms.uGust.value = gust;
  }
}
