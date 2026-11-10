"use client";

import { useEffect, useRef } from "react";
import type { Mood } from "@/lib/types";
import type { Phase } from "@/client/session";

export interface BallSignal {
  phase: Phase;
  mood: Mood;
  levels: () => { level: number; bass: number; treble: number };
}

/** Two colors per mood: the ball's core and its rim. */
const PALETTE: Record<Mood, [number[], number[]]> = {
  neutral: [[1.0, 0.66, 0.36], [0.93, 0.36, 0.5]],
  warm: [[1.0, 0.62, 0.42], [0.98, 0.42, 0.55]],
  joy: [[1.0, 0.8, 0.3], [1.0, 0.45, 0.32]],
  low: [[0.55, 0.65, 0.95], [0.72, 0.55, 0.85]],
  anxious: [[0.45, 0.8, 0.75], [0.6, 0.72, 0.95]],
  angry: [[1.0, 0.42, 0.3], [0.85, 0.22, 0.32]],
};

const VERTEX = `#version 300 es
in vec3 aDir;
in float aSeed;
uniform float uTime, uLevel, uBass, uTreble, uSwirl, uBreath, uSize, uAspect, uMotion, uRadius;
uniform mat3 uRot;
uniform vec3 uA, uB;
out vec3 vColor;
out float vAlpha;

vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  vec3 d = aDir;
  // Thinking: the sphere twists on itself, like a thought turning over.
  float twist = uSwirl * d.y * 2.2;
  d.xz = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * d.xz;

  float t = uTime * (0.35 + uMotion * 0.4);
  float broad = snoise(d * 1.4 + vec3(0.0, t * 0.6, t * 0.3));
  float fine = snoise(d * 4.2 + vec3(t * 1.3) + aSeed * 3.0);

  float speech = uLevel * uMotion;
  float disp = broad * (0.05 + speech * 0.26 + uBass * 0.18 * uMotion) + fine * (0.012 + uTreble * 0.1 * uMotion);
  float r = uRadius * (1.0 + uBreath + disp);
  // A few particles drift off the surface and get flung out when it talks.
  float halo = step(0.9, aSeed);
  r += halo * (0.03 + speech * 0.22) * (0.6 + 0.4 * broad) * uRadius;

  vec3 p = uRot * (d * r);
  float persp = 2.6 / (2.6 - p.z);
  gl_Position = vec4(p.x * persp / uAspect, p.y * persp, 0.0, 1.0);
  gl_PointSize = uSize * persp * persp * (0.55 + aSeed * 0.9) * (1.0 + speech * 0.5);

  float depth = clamp((p.z / max(uRadius, 0.01) + 1.0) * 0.5, 0.0, 1.0);
  vColor = mix(uB, uA, clamp(0.5 + broad * 0.6 + depth * 0.35, 0.0, 1.0));
  vAlpha = (0.18 + depth * 0.62) * (halo > 0.5 ? 0.55 : 1.0) * (0.85 + speech * 0.4);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vAlpha;
out vec4 color;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  color = vec4(vColor * a * vAlpha, a * vAlpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

/**
 * A sphere of particles that breathes when idle, leans in while you talk,
 * twists while thinking, and ripples with the frequencies of its own voice.
 */
export function ParticleBall({ signal, className }: { signal: React.RefObject<BallSignal | null>; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });
    const program = gl && !gl.isContextLost() ? gl.createProgram() : null;
    try {
      if (!gl || !program) throw new Error("WebGL2 unavailable");
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
      gl.useProgram(program);
    } catch (error) {
      console.warn("[ball] falling back to CSS orb:", error);
      canvas.dataset.fallback = "true";
      return;
    }

    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    const count = small ? 4200 : 7000;
    const dirs = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = golden * i;
      dirs.set([Math.cos(theta) * radius, y, Math.sin(theta) * radius], i * 3);
      seeds[i] = Math.random();
    }

    const bind = (name: string, data: Float32Array, size: number) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    bind("aDir", dirs, 3);
    bind("aSeed", seeds, 1);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uniforms = {
      time: u("uTime"), level: u("uLevel"), bass: u("uBass"), treble: u("uTreble"), swirl: u("uSwirl"),
      breath: u("uBreath"), size: u("uSize"), aspect: u("uAspect"), motion: u("uMotion"), radius: u("uRadius"),
      rot: u("uRot"), a: u("uA"), b: u("uB"),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const smooth = { level: 0, bass: 0, treble: 0, swirl: 0, lean: 0, spin: 0, a: [...PALETTE.neutral[0]], b: [...PALETTE.neutral[1]] };
    let frame = 0;
    let last = performance.now();
    const start = last;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = signal.current;
      const phase = current?.phase ?? "off";
      const levels = current?.levels() ?? { level: 0, bass: 0, treble: 0 };

      const ease = (from: number, to: number, rate: number) => from + (to - from) * Math.min(1, dt * rate);
      const speaking = phase === "speaking";
      smooth.level = ease(smooth.level, speaking ? levels.level : levels.level * 0.35, speaking ? 18 : 8);
      smooth.bass = ease(smooth.bass, speaking ? levels.bass : 0, 14);
      smooth.treble = ease(smooth.treble, speaking ? levels.treble : 0, 14);
      smooth.swirl = ease(smooth.swirl, phase === "thinking" ? Math.sin((now - start) / 700) * 0.6 : 0, 3);
      smooth.lean = ease(smooth.lean, phase === "hearing" ? 1 : 0, 4);
      smooth.spin += dt * (phase === "thinking" ? 0.9 : speaking ? 0.32 : 0.14);

      const palette = PALETTE[current?.mood ?? "neutral"];
      for (let i = 0; i < 3; i++) {
        smooth.a[i] = ease(smooth.a[i], palette[0][i], 1.2);
        smooth.b[i] = ease(smooth.b[i], palette[1][i], 1.2);
      }

      const t = (now - start) / 1000;
      const breath = Math.sin(t * 1.1) * (phase === "off" ? 0.012 : 0.02) - smooth.lean * 0.05;
      const tilt = 0.32 + Math.sin(t * 0.21) * 0.08;
      const cy = Math.cos(smooth.spin), sy = Math.sin(smooth.spin);
      const cx = Math.cos(tilt), sx = Math.sin(tilt);
      // Rotation about Y, then a gentle tilt about X (column-major).
      const rot = new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uniforms.time, t);
      gl.uniform1f(uniforms.level, smooth.level);
      gl.uniform1f(uniforms.bass, smooth.bass);
      gl.uniform1f(uniforms.treble, smooth.treble);
      gl.uniform1f(uniforms.swirl, smooth.swirl);
      gl.uniform1f(uniforms.breath, breath);
      gl.uniform1f(uniforms.size, (small ? 3.4 : 3.0) * dpr * (canvas.height / (720 * dpr)) + 1.2 * dpr);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.uniform1f(uniforms.motion, reduced ? 0.35 : 1);
      gl.uniform1f(uniforms.radius, phase === "off" ? 0.56 : 0.6);
      gl.uniformMatrix3fv(uniforms.rot, false, rot);
      gl.uniform3fv(uniforms.a, smooth.a);
      gl.uniform3fv(uniforms.b, smooth.b);
      gl.drawArrays(gl.POINTS, 0, count);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl.deleteProgram(program);
    };
  }, [signal]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
