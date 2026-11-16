import type {
  MolecularSceneData,
  SceneAtom,
  SceneBond,
  SceneResidueNode,
} from './structureAtoms';
import type { RenderStyle, ViewportLayout } from './workbenchReducers';

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

export interface ScreenPickTarget {
  sx: number;
  sy: number;
  depth: number;
  kind: 'residue' | 'atom';
  seqId: number;
  label: string;
  xyz: [number, number, number];
  chainKind?: 'ref' | 'mob';
}

export interface ViewportRenderOptions {
  layout: ViewportLayout;
  style: RenderStyle;
  camera: CameraState;
  focusedSeqId: number | null;
  highlightedSeqIds: Set<number>;
  distancePair: [SceneResidueNode | null, SceneResidueNode | null];
  paePair: [number, number] | null;
}

const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;

uniform mat4 uViewProj;
uniform mat4 uView;

out vec3 vNormalView;
out vec3 vPosView;
out vec3 vColor;

void main() {
  vec4 viewPos = uView * vec4(aPos, 1.0);
  vPosView = viewPos.xyz;
  vNormalView = mat3(uView) * aNormal;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vNormalView;
in vec3 vPosView;
in vec3 vColor;

out vec4 outColor;

void main() {
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(-vPosView);
  vec3 L1 = normalize(vec3(0.45, 0.72, 0.85));
  vec3 L2 = normalize(vec3(-0.65, -0.35, 0.40));

  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0) * 0.35;
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.38;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4) * 0.16;

  vec3 shaded = vColor * (0.24 + 0.78 * diff1 + diff2) + vec3(spec + rim);
  // Subtle depth cue
  float fog = clamp((-vPosView.z - 25.0) / 140.0, 0.0, 0.42);
  vec3 bg = vec3(0.035, 0.051, 0.078);
  outColor = vec4(mix(shaded, bg, fog), 1.0);
}
`;

function sub3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(a: [number, number, number], s: number): [number, number, number] {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm3(a: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  if (len < 1e-8) return [0, 1, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

function dist3(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

function buildLookAtViewMatrix(camera: CameraState): Float32Array {
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const eye: [number, number, number] = [
    camera.target[0] + camera.distance * cp * sy,
    camera.target[1] + camera.distance * sp,
    camera.target[2] + camera.distance * cp * cy,
  ];

  const f = norm3(sub3(camera.target, eye));
  const upWorld: [number, number, number] = [0, 1, 0];
  const r = norm3(cross3(f, upWorld));
  const u = cross3(r, f);

  // Column-major 4x4 for WebGL
  return new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]),
    -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]),
    f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
    1,
  ]);
}

function buildPerspectiveMatrix(
  fovRad: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mulMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function projectPointToViewport(
  viewProj: Float32Array,
  p: [number, number, number],
  vpX: number,
  vpY: number,
  vpW: number,
  vpH: number,
): { sx: number; sy: number; ndcZ: number; visible: boolean } {
  const x = viewProj[0] * p[0] + viewProj[4] * p[1] + viewProj[8] * p[2] + viewProj[12];
  const y = viewProj[1] * p[0] + viewProj[5] * p[1] + viewProj[9] * p[2] + viewProj[13];
  const z = viewProj[2] * p[0] + viewProj[6] * p[1] + viewProj[10] * p[2] + viewProj[14];
  const w = viewProj[3] * p[0] + viewProj[7] * p[1] + viewProj[11] * p[2] + viewProj[15];
  if (w <= 0.05) return { sx: -9999, sy: -9999, ndcZ: 2, visible: false };
  const nx = x / w;
  const ny = y / w;
  const nz = z / w;
  return {
    sx: vpX + (nx * 0.5 + 0.5) * vpW,
    sy: vpY + (-ny * 0.5 + 0.5) * vpH,
    ndcZ: nz,
    visible: nz >= -1 && nz <= 1,
  };
}

function catmullRom(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  t: number,
): [number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] =
      0.5 *
      (2 * p1[i] +
        (-p0[i] + p2[i]) * t +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

class MeshBuilder {
  // Interleaved: px, py, pz, nx, ny, nz, r, g, b (9 floats per vertex)
  private data: number[] = [];

  pushTri(
    p1: [number, number, number],
    n1: [number, number, number],
    c1: [number, number, number],
    p2: [number, number, number],
    n2: [number, number, number],
    c2: [number, number, number],
    p3: [number, number, number],
    n3: [number, number, number],
    c3: [number, number, number],
  ): void {
    this.data.push(
      p1[0], p1[1], p1[2], n1[0], n1[1], n1[2], c1[0] / 255, c1[1] / 255, c1[2] / 255,
      p2[0], p2[1], p2[2], n2[0], n2[1], n2[2], c2[0] / 255, c2[1] / 255, c2[2] / 255,
      p3[0], p3[1], p3[2], n3[0], n3[1], n3[2], c3[0] / 255, c3[1] / 255, c3[2] / 255,
    );
  }

  addSphere(
    center: [number, number, number],
    radius: number,
    color: [number, number, number],
    latSegs = 8,
    lonSegs = 12,
  ): void {
    for (let i = 0; i < latSegs; i++) {
      const th1 = (i / latSegs) * Math.PI;
      const th2 = ((i + 1) / latSegs) * Math.PI;
      for (let j = 0; j < lonSegs; j++) {
        const ph1 = (j / lonSegs) * Math.PI * 2;
        const ph2 = ((j + 1) / lonSegs) * Math.PI * 2;

        const n00: [number, number, number] = [
          Math.sin(th1) * Math.cos(ph1),
          Math.cos(th1),
          Math.sin(th1) * Math.sin(ph1),
        ];
        const n10: [number, number, number] = [
          Math.sin(th2) * Math.cos(ph1),
          Math.cos(th2),
          Math.sin(th2) * Math.sin(ph1),
        ];
        const n11: [number, number, number] = [
          Math.sin(th2) * Math.cos(ph2),
          Math.cos(th2),
          Math.sin(th2) * Math.sin(ph2),
        ];
        const n01: [number, number, number] = [
          Math.sin(th1) * Math.cos(ph2),
          Math.cos(th1),
          Math.sin(th1) * Math.sin(ph2),
        ];

        const p00 = add3(center, scale3(n00, radius));
        const p10 = add3(center, scale3(n10, radius));
        const p11 = add3(center, scale3(n11, radius));
        const p01 = add3(center, scale3(n01, radius));

        if (i > 0) this.pushTri(p00, n00, color, p01, n01, color, p11, n11, color);
        if (i < latSegs - 1) this.pushTri(p00, n00, color, p11, n11, color, p10, n10, color);
      }
    }
  }

  addCylinder(
    a: [number, number, number],
    b: [number, number, number],
    radius: number,
    colorA: [number, number, number],
    colorB: [number, number, number],
    sides = 8,
  ): void {
    const dir = sub3(b, a);
    const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
    if (len < 1e-4) return;
    const axis = scale3(dir, 1 / len);
    const ref: [number, number, number] =
      Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm3(cross3(axis, ref));
    const v = cross3(axis, u);

    for (let i = 0; i < sides; i++) {
      const ang1 = (i / sides) * Math.PI * 2;
      const ang2 = ((i + 1) / sides) * Math.PI * 2;
      const n1 = add3(scale3(u, Math.cos(ang1)), scale3(v, Math.sin(ang1)));
      const n2 = add3(scale3(u, Math.cos(ang2)), scale3(v, Math.sin(ang2)));

      const a1 = add3(a, scale3(n1, radius));
      const a2 = add3(a, scale3(n2, radius));
      const b1 = add3(b, scale3(n1, radius));
      const b2 = add3(b, scale3(n2, radius));

      this.pushTri(a1, n1, colorA, a2, n2, colorA, b2, n2, colorB);
      this.pushTri(a1, n1, colorA, b2, n2, colorB, b1, n1, colorB);
    }
  }

  addBackboneRibbon(
    residues: SceneResidueNode[],
    radiusW: number,
    radiusH: number,
    subdiv = 4,
    sides = 8,
  ): void {
    if (residues.length < 2) return;

    // Split into contiguous chain segments whenever C-alpha gap > 6.5 A
    const segments: SceneResidueNode[][] = [];
    let current: SceneResidueNode[] = [residues[0]];
    for (let i = 1; i < residues.length; i++) {
      if (dist3(residues[i - 1].xyz, residues[i].xyz) > 6.5) {
        if (current.length >= 2) segments.push(current);
        current = [residues[i]];
      } else {
        current.push(residues[i]);
      }
    }
    if (current.length >= 2) segments.push(current);

    for (const seg of segments) {
      const samples: Array<{
        pos: [number, number, number];
        col: [number, number, number];
      }> = [];

      for (let i = 0; i < seg.length - 1; i++) {
        const p0 = seg[Math.max(0, i - 1)].xyz;
        const p1 = seg[i].xyz;
        const p2 = seg[i + 1].xyz;
        const p3 = seg[Math.min(seg.length - 1, i + 2)].xyz;
        const c1 = seg[i].color;
        const c2 = seg[i + 1].color;

        const steps = i === seg.length - 2 ? subdiv + 1 : subdiv;
        for (let s = 0; s < steps; s++) {
          const t = s / subdiv;
          const pos = catmullRom(p0, p1, p2, p3, t);
          const col: [number, number, number] = [
            c1[0] + (c2[0] - c1[0]) * t,
            c1[1] + (c2[1] - c1[1]) * t,
            c1[2] + (c2[2] - c1[2]) * t,
          ];
          samples.push({ pos, col });
        }
      }

      // Parallel transport frames to avoid ribbon twisting artifacts
      let prevT = norm3(sub3(samples[1].pos, samples[0].pos));
      const initRef: [number, number, number] =
        Math.abs(prevT[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let prevN = norm3(cross3(prevT, initRef));
      let prevB = cross3(prevT, prevN);

      const rings: Array<{
        pts: Array<[number, number, number]>;
        norms: Array<[number, number, number]>;
        col: [number, number, number];
      }> = [];

      for (let i = 0; i < samples.length; i++) {
        const tangent =
          i === samples.length - 1
            ? norm3(sub3(samples[i].pos, samples[i - 1].pos))
            : i === 0
              ? prevT
              : norm3(sub3(samples[i + 1].pos, samples[i - 1].pos));

        // Rotate previous normal onto plane perpendicular to tangent
        const rotAxis = cross3(prevT, tangent);
        const sinA = Math.sqrt(
          rotAxis[0] ** 2 + rotAxis[1] ** 2 + rotAxis[2] ** 2,
        );
        if (sinA > 1e-5) {
          const dot = Math.max(-1, Math.min(1, prevT[0] * tangent[0] + prevT[1] * tangent[1] + prevT[2] * tangent[2]));
          const angle = Math.acos(dot);
          const k = scale3(rotAxis, 1 / sinA);
          const cosA = Math.cos(angle);
          const sA = Math.sin(angle);
          const kDotN = k[0] * prevN[0] + k[1] * prevN[1] + k[2] * prevN[2];
          const kCrossN = cross3(k, prevN);
          prevN = norm3([
            prevN[0] * cosA + kCrossN[0] * sA + k[0] * kDotN * (1 - cosA),
            prevN[1] * cosA + kCrossN[1] * sA + k[1] * kDotN * (1 - cosA),
            prevN[2] * cosA + kCrossN[2] * sA + k[2] * kDotN * (1 - cosA),
          ]);
        }
        prevB = norm3(cross3(tangent, prevN));
        prevT = tangent;

        const pts: Array<[number, number, number]> = [];
        const norms: Array<[number, number, number]> = [];
        for (let k = 0; k < sides; k++) {
          const ang = (k / sides) * Math.PI * 2;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const offset = add3(
            scale3(prevN, ca * radiusW),
            scale3(prevB, sa * radiusH),
          );
          const normal = norm3(
            add3(scale3(prevN, ca / radiusW), scale3(prevB, sa / radiusH)),
          );
          pts.push(add3(samples[i].pos, offset));
          norms.push(normal);
        }
        rings.push({ pts, norms, col: samples[i].col });
      }

      for (let i = 0; i < rings.length - 1; i++) {
        const rA = rings[i];
        const rB = rings[i + 1];
        for (let k = 0; k < sides; k++) {
          const kn = (k + 1) % sides;
          this.pushTri(
            rA.pts[k], rA.norms[k], rA.col,
            rA.pts[kn], rA.norms[kn], rA.col,
            rB.pts[kn], rB.norms[kn], rB.col,
          );
          this.pushTri(
            rA.pts[k], rA.norms[k], rA.col,
            rB.pts[kn], rB.norms[kn], rB.col,
            rB.pts[k], rB.norms[k], rB.col,
          );
        }
      }
    }
  }

  toFloat32Array(): Float32Array {
    return new Float32Array(this.data);
  }
}

export class MolecularViewportEngine {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private uViewProjLoc: WebGLUniformLocation | null = null;
  private uViewLoc: WebGLUniformLocation | null = null;
  public readonly mode: 'webgl2' | 'canvas2d-fallback';

  constructor(private readonly glCanvas: HTMLCanvasElement) {
    const gl = glCanvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (gl && this.initProgram(gl)) {
      this.gl = gl;
      this.mode = 'webgl2';
    } else {
      this.mode = 'canvas2d-fallback';
    }
  }

  private initProgram(gl: WebGL2RenderingContext): boolean {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vs || !fs) return false;
    gl.shaderSource(vs, VERTEX_SHADER);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return false;

    gl.shaderSource(fs, FRAGMENT_SHADER);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return false;

    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

    this.program = prog;
    this.uViewProjLoc = gl.getUniformLocation(prog, 'uViewProj');
    this.uViewLoc = gl.getUniformLocation(prog, 'uView');
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 9 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    return true;
  }

  public render(
    scene: MolecularSceneData,
    opts: ViewportRenderOptions,
    hudCanvas: HTMLCanvasElement,
    width: number,
    height: number,
    dpr: number,
  ): ScreenPickTarget[] {
    const pickTargets: ScreenPickTarget[] = [];
    const pw = Math.max(1, Math.floor(width * dpr));
    const ph = Math.max(1, Math.floor(height * dpr));

    if (this.glCanvas.width !== pw || this.glCanvas.height !== ph) {
      this.glCanvas.width = pw;
      this.glCanvas.height = ph;
    }
    if (hudCanvas.width !== pw || hudCanvas.height !== ph) {
      hudCanvas.width = pw;
      hudCanvas.height = ph;
    }

    const hud = hudCanvas.getContext('2d');
    if (hud) {
      hud.setTransform(dpr, 0, 0, dpr, 0, 0);
      hud.clearRect(0, 0, width, height);
    }

    const panels: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      showRef: boolean;
      showMob: boolean;
      title?: string;
    }> =
      opts.layout === 'split'
        ? [
            { x: 0, y: 0, w: width / 2, h: height, showRef: true, showMob: false, title: 'REFERENCE (EXPERIMENTAL)' },
            { x: width / 2, y: 0, w: width / 2, h: height, showRef: false, showMob: true, title: 'PREDICTION (SUPERPOSED)' },
          ]
        : [
            {
              x: 0,
              y: 0,
              w: width,
              h: height,
              showRef: opts.layout === 'overlay' || opts.layout === 'reference',
              showMob: opts.layout === 'overlay' || opts.layout === 'mobile',
            },
          ];

    const view = buildLookAtViewMatrix(opts.camera);

    if (this.mode === 'webgl2' && this.gl && this.program && this.vao && this.vbo) {
      const gl = this.gl;
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0.035, 0.051, 0.078, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);

      for (const panel of panels) {
        const aspect = Math.max(0.1, panel.w / Math.max(1, panel.h));
        const proj = buildPerspectiveMatrix((38 * Math.PI) / 180, aspect, 0.5, 600);
        const viewProj = mulMat4(proj, view);

        const mesh = this.buildPanelMesh(scene, opts, panel.showRef, panel.showMob);
        const verts = mesh.toFloat32Array();

        const sx = Math.floor(panel.x * dpr);
        const sw = Math.floor(panel.w * dpr);
        const sh = Math.floor(panel.h * dpr);
        gl.viewport(sx, 0, sw, sh);
        gl.scissor(sx, 0, sw, sh);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.uniformMatrix4fv(this.uViewLoc, false, view);
        gl.uniformMatrix4fv(this.uViewProjLoc, false, viewProj);
        gl.drawArrays(gl.TRIANGLES, 0, verts.length / 9);

        this.collectAndDrawHud(
          scene,
          opts,
          viewProj,
          panel,
          hud,
          pickTargets,
        );
      }

      gl.disable(gl.SCISSOR_TEST);
    } else {
      // Automatic 2D Canvas projection fallback if WebGL2 is unavailable
      const ctx2d = this.glCanvas.getContext('2d');
      if (ctx2d) {
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.fillStyle = '#090d14';
        ctx2d.fillRect(0, 0, width, height);

        for (const panel of panels) {
          const aspect = Math.max(0.1, panel.w / Math.max(1, panel.h));
          const proj = buildPerspectiveMatrix((38 * Math.PI) / 180, aspect, 0.5, 600);
          const viewProj = mulMat4(proj, view);
          this.render2dPanel(ctx2d, scene, opts, viewProj, panel);
          this.collectAndDrawHud(scene, opts, viewProj, panel, hud, pickTargets);
        }
      }
    }

    if (opts.layout === 'split' && hud) {
      hud.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      hud.lineWidth = 1;
      hud.beginPath();
      hud.moveTo(width / 2, 0);
      hud.lineTo(width / 2, height);
      hud.stroke();
    }

    return pickTargets;
  }

  private buildPanelMesh(
    scene: MolecularSceneData,
    opts: ViewportRenderOptions,
    showRef: boolean,
    showMob: boolean,
  ): MeshBuilder {
    const mesh = new MeshBuilder();
    const isPocket = opts.style === 'pocket';

    if (showRef && scene.refResidues.length > 0) {
      if (opts.style === 'trace') {
        for (let i = 0; i < scene.refResidues.length - 1; i++) {
          const a = scene.refResidues[i];
          const b = scene.refResidues[i + 1];
          if (dist3(a.xyz, b.xyz) <= 6.5) {
            mesh.addCylinder(a.xyz, b.xyz, 0.24, a.color, b.color, 6);
          }
        }
        for (const r of scene.refResidues) {
          mesh.addSphere(r.xyz, 0.34, r.color, 6, 8);
        }
      } else {
        mesh.addBackboneRibbon(
          scene.refResidues,
          isPocket ? 0.34 : 0.44,
          isPocket ? 0.14 : 0.18,
          4,
          8,
        );
      }
    }

    if (showMob && scene.mobResidues.length > 0) {
      if (opts.style === 'trace') {
        for (let i = 0; i < scene.mobResidues.length - 1; i++) {
          const a = scene.mobResidues[i];
          const b = scene.mobResidues[i + 1];
          if (dist3(a.xyz, b.xyz) <= 6.5) {
            mesh.addCylinder(a.xyz, b.xyz, 0.2, a.color, b.color, 6);
          }
        }
        for (const r of scene.mobResidues) {
          mesh.addSphere(r.xyz, 0.3, r.color, 6, 8);
        }
      } else {
        mesh.addBackboneRibbon(
          scene.mobResidues,
          isPocket ? 0.26 : 0.36,
          isPocket ? 0.11 : 0.14,
          4,
          8,
        );
      }
    }

    // Always render Zn2+ metal & AZM/ligands on reference view (bolder in pocket mode)
    if (showRef) {
      for (const bond of scene.ligandBonds) {
        mesh.addCylinder(bond.a, bond.b, isPocket ? bond.radius : bond.radius * 0.75, bond.colorA, bond.colorB, 7);
      }
      for (const atom of scene.ligandAtoms) {
        mesh.addSphere(atom.xyz, isPocket ? atom.radius : atom.radius * 0.85, atom.color, 9, 12);
      }
      if (isPocket) {
        for (const bond of scene.pocketBonds) {
          mesh.addCylinder(bond.a, bond.b, bond.radius, bond.colorA, bond.colorB, 6);
        }
        for (const atom of scene.pocketAtoms) {
          mesh.addSphere(atom.xyz, atom.radius, atom.color, 6, 8);
        }
      }
    }

    // Highlight focused residue or highlighted contact shell
    const allRes = [
      ...(showRef ? scene.refResidues : []),
      ...(showMob ? scene.mobResidues : []),
    ];
    for (const r of allRes) {
      if (opts.focusedSeqId === r.seqId) {
        mesh.addSphere(r.xyz, 0.92, [251, 191, 36], 10, 14);
      } else if (opts.highlightedSeqIds.has(r.seqId)) {
        mesh.addSphere(r.xyz, 0.68, [244, 114, 182], 8, 10);
      }
    }

    if (opts.paePair) {
      const [pi, pj] = opts.paePair;
      const ra = allRes.find((r) => r.seqId === pi);
      const rb = allRes.find((r) => r.seqId === pj);
      if (ra) mesh.addSphere(ra.xyz, 0.85, [34, 211, 238], 9, 12);
      if (rb) mesh.addSphere(rb.xyz, 0.85, [52, 211, 153], 9, 12);
    }

    return mesh;
  }

  private render2dPanel(
    ctx: CanvasRenderingContext2D,
    scene: MolecularSceneData,
    opts: ViewportRenderOptions,
    viewProj: Float32Array,
    panel: { x: number; y: number; w: number; h: number; showRef: boolean; showMob: boolean },
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(panel.x, panel.y, panel.w, panel.h);
    ctx.clip();

    interface DrawItem {
      depth: number;
      draw: () => void;
    }
    const queue: DrawItem[] = [];

    const pushResidueChain = (residues: SceneResidueNode[], widthPx: number) => {
      for (let i = 0; i < residues.length - 1; i++) {
        const a = residues[i];
        const b = residues[i + 1];
        if (dist3(a.xyz, b.xyz) > 6.5) continue;
        const pa = projectPointToViewport(viewProj, a.xyz, panel.x, panel.y, panel.w, panel.h);
        const pb = projectPointToViewport(viewProj, b.xyz, panel.x, panel.y, panel.w, panel.h);
        if (!pa.visible || !pb.visible) continue;
        const depth = (pa.ndcZ + pb.ndcZ) * 0.5;
        queue.push({
          depth,
          draw: () => {
            ctx.strokeStyle = `rgb(${a.color[0]},${a.color[1]},${a.color[2]})`;
            ctx.lineWidth = widthPx;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pa.sx, pa.sy);
            ctx.lineTo(pb.sx, pb.sy);
            ctx.stroke();
          },
        });
      }
    };

    if (panel.showRef) pushResidueChain(scene.refResidues, opts.style === 'pocket' ? 3 : 4);
    if (panel.showMob) pushResidueChain(scene.mobResidues, opts.style === 'pocket' ? 2.4 : 3.2);

    const pushAtoms = (atoms: SceneAtom[], bonds: SceneBond[]) => {
      for (const b of bonds) {
        const pa = projectPointToViewport(viewProj, b.a, panel.x, panel.y, panel.w, panel.h);
        const pb = projectPointToViewport(viewProj, b.b, panel.x, panel.y, panel.w, panel.h);
        if (!pa.visible || !pb.visible) continue;
        queue.push({
          depth: (pa.ndcZ + pb.ndcZ) * 0.5,
          draw: () => {
            ctx.strokeStyle = `rgb(${b.colorA[0]},${b.colorA[1]},${b.colorA[2]})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pa.sx, pa.sy);
            ctx.lineTo(pb.sx, pb.sy);
            ctx.stroke();
          },
        });
      }
      for (const a of atoms) {
        const pa = projectPointToViewport(viewProj, a.xyz, panel.x, panel.y, panel.w, panel.h);
        if (!pa.visible) continue;
        queue.push({
          depth: pa.ndcZ,
          draw: () => {
            ctx.fillStyle = `rgb(${a.color[0]},${a.color[1]},${a.color[2]})`;
            ctx.beginPath();
            ctx.arc(pa.sx, pa.sy, a.isMetal ? 6 : 3.5, 0, Math.PI * 2);
            ctx.fill();
          },
        });
      }
    };

    if (panel.showRef) {
      pushAtoms(scene.ligandAtoms, scene.ligandBonds);
      if (opts.style === 'pocket') pushAtoms(scene.pocketAtoms, scene.pocketBonds);
    }

    queue.sort((a, b) => b.depth - a.depth);
    for (const item of queue) item.draw();
    ctx.restore();
  }

  private collectAndDrawHud(
    scene: MolecularSceneData,
    opts: ViewportRenderOptions,
    viewProj: Float32Array,
    panel: { x: number; y: number; w: number; h: number; showRef: boolean; showMob: boolean; title?: string },
    hud: CanvasRenderingContext2D | null,
    pickTargets: ScreenPickTarget[],
  ): void {
    const addPick = (t: ScreenPickTarget) => {
      if (t.sx >= panel.x && t.sx <= panel.x + panel.w && t.sy >= panel.y && t.sy <= panel.y + panel.h) {
        pickTargets.push(t);
      }
    };

    if (panel.showRef) {
      for (const r of scene.refResidues) {
        const p = projectPointToViewport(viewProj, r.xyz, panel.x, panel.y, panel.w, panel.h);
        if (p.visible) {
          addPick({
            sx: p.sx,
            sy: p.sy,
            depth: p.ndcZ,
            kind: 'residue',
            seqId: r.seqId,
            label: `${r.resName3} ${r.seqId} (Ref)`,
            xyz: r.xyz,
            chainKind: 'ref',
          });
        }
      }
      for (const a of scene.ligandAtoms) {
        const p = projectPointToViewport(viewProj, a.xyz, panel.x, panel.y, panel.w, panel.h);
        if (p.visible) {
          addPick({
            sx: p.sx,
            sy: p.sy,
            depth: p.ndcZ,
            kind: 'atom',
            seqId: a.seqId,
            label: a.label,
            xyz: a.xyz,
            chainKind: 'ref',
          });
        }
      }
    }

    if (panel.showMob) {
      for (const r of scene.mobResidues) {
        const p = projectPointToViewport(viewProj, r.xyz, panel.x, panel.y, panel.w, panel.h);
        if (p.visible) {
          addPick({
            sx: p.sx,
            sy: p.sy,
            depth: p.ndcZ,
            kind: 'residue',
            seqId: r.seqId,
            label: `${r.resName3} ${r.seqId} (Mob)`,
            xyz: r.xyz,
            chainKind: 'mob',
          });
        }
      }
    }

    if (!hud) return;
    hud.save();
    hud.beginPath();
    hud.rect(panel.x, panel.y, panel.w, panel.h);
    hud.clip();

    // Draw Zn2+ coordination dashed lines in HUD for crisp dash clarity
    if (panel.showRef && opts.style === 'pocket') {
      for (const cb of scene.coordinationBonds) {
        const pa = projectPointToViewport(viewProj, cb.a, panel.x, panel.y, panel.w, panel.h);
        const pb = projectPointToViewport(viewProj, cb.b, panel.x, panel.y, panel.w, panel.h);
        if (!pa.visible || !pb.visible) continue;
        hud.save();
        hud.setLineDash([4, 3]);
        hud.strokeStyle = 'rgba(216, 180, 254, 0.85)';
        hud.lineWidth = 1.4;
        hud.beginPath();
        hud.moveTo(pa.sx, pa.sy);
        hud.lineTo(pb.sx, pb.sy);
        hud.stroke();
        hud.restore();
      }
    }

    // Label Zn2+ and key catalytic ligands / pocket histidines
    if (panel.showRef) {
      const zn = scene.ligandAtoms.find((a) => a.element === 'ZN');
      if (zn) {
        const p = projectPointToViewport(viewProj, zn.xyz, panel.x, panel.y, panel.w, panel.h);
        if (p.visible) {
          drawBadge(hud, p.sx + 10, p.sy - 8, 'Zn²⁺', '#d8b4fe');
        }
      }
      const azmAnchor = scene.ligandAtoms.find((a) => a.resName === 'AZM' && a.atomName === 'S1');
      if (azmAnchor) {
        const p = projectPointToViewport(viewProj, azmAnchor.xyz, panel.x, panel.y, panel.w, panel.h);
        if (p.visible) {
          drawBadge(hud, p.sx + 10, p.sy + 10, 'AZM', '#67e8f9');
        }
      }
      if (opts.style === 'pocket') {
        for (const seq of [94, 96, 119]) {
          const r = scene.refResidues.find((x) => x.seqId === seq);
          if (!r) continue;
          const p = projectPointToViewport(viewProj, r.xyz, panel.x, panel.y, panel.w, panel.h);
          if (p.visible) {
            drawBadge(hud, p.sx + 8, p.sy - 6, `${r.resName3}${r.seqId}`, '#94a3b8');
          }
        }
      }
    }

    // Focused residue badge
    if (opts.focusedSeqId != null) {
      const res =
        (panel.showRef && scene.refResidues.find((r) => r.seqId === opts.focusedSeqId)) ||
        (panel.showMob && scene.mobResidues.find((r) => r.seqId === opts.focusedSeqId));
      if (res) {
        const p = projectPointToViewport(viewProj, res.xyz, panel.x, panel.y, panel.w, panel.h);
        if (p.visible) {
          hud.strokeStyle = '#fbbf24';
          hud.lineWidth = 2;
          hud.beginPath();
          hud.arc(p.sx, p.sy, 10, 0, Math.PI * 2);
          hud.stroke();
          drawBadge(hud, p.sx + 12, p.sy - 12, `${res.resName3}${res.seqId}`, '#fbbf24');
        }
      }
    }

    // Pairwise distance tool measurement line
    const [dA, dB] = opts.distancePair;
    if (dA && dB) {
      const pa = projectPointToViewport(viewProj, dA.xyz, panel.x, panel.y, panel.w, panel.h);
      const pb = projectPointToViewport(viewProj, dB.xyz, panel.x, panel.y, panel.w, panel.h);
      if (pa.visible && pb.visible) {
        hud.save();
        hud.setLineDash([5, 4]);
        hud.strokeStyle = '#f43f5e';
        hud.lineWidth = 2;
        hud.beginPath();
        hud.moveTo(pa.sx, pa.sy);
        hud.lineTo(pb.sx, pb.sy);
        hud.stroke();
        hud.restore();

        const ang = dist3(dA.xyz, dB.xyz);
        const mx = (pa.sx + pb.sx) * 0.5;
        const my = (pa.sy + pb.sy) * 0.5;
        drawBadge(
          hud,
          mx,
          my,
          `${dA.resName3}${dA.seqId} ↔ ${dB.resName3}${dB.seqId}: ${ang.toFixed(2)} Å`,
          '#fda4af',
        );
      }
    } else if (dA) {
      const pa = projectPointToViewport(viewProj, dA.xyz, panel.x, panel.y, panel.w, panel.h);
      if (pa.visible) {
        hud.strokeStyle = '#f43f5e';
        hud.lineWidth = 2;
        hud.beginPath();
        hud.arc(pa.sx, pa.sy, 9, 0, Math.PI * 2);
        hud.stroke();
        drawBadge(hud, pa.sx + 10, pa.sy + 10, `A: ${dA.resName3}${dA.seqId}`, '#fda4af');
      }
    }

    if (panel.title) {
      hud.fillStyle = 'rgba(15, 23, 42, 0.78)';
      hud.fillRect(panel.x + 10, panel.y + 44, 178, 20);
      hud.strokeStyle = 'rgba(51, 65, 85, 0.8)';
      hud.strokeRect(panel.x + 10, panel.y + 44, 178, 20);
      hud.fillStyle = '#cbd5e1';
      hud.font = '600 10px ui-monospace, monospace';
      hud.fillText(panel.title, panel.x + 16, panel.y + 57);
    }

    hud.restore();
  }
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
): void {
  ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  const metrics = ctx.measureText(text);
  const padX = 5;
  const w = metrics.width + padX * 2;
  const h = 16;
  ctx.fillStyle = 'rgba(9, 13, 20, 0.84)';
  ctx.fillRect(x, y - 11, w, h);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y - 11, w, h);
  ctx.fillStyle = color;
  ctx.fillText(text, x + padX, y);
}
