// The cover's atmosphere: a volume of cloud carried by a fluid you can push, drawn with WebGL2.
//
//   const cloud = createFluidCloud(canvas, { seed: 17, reducedMotion: "system" });
//   cloud?.pause();
//
// Returns undefined where WebGL2 is missing. The page then keeps the still
// background it already had.

import { noiseVolume } from "./noise.ts";
import {
  budget,
  canvasSize,
  gridSize,
  nextBudget,
  sceneSize,
  type Size,
  wantsStill,
} from "./quality.ts";
import { finishFragment, fluid, vertex, volumeFragment } from "./shaders.ts";

export type FluidCloudOptions = {
  /** Which cloud. The same seed draws the same one. */
  seed?: number;
  /** 1 is the cover as designed. Lower thins the cloud, higher thickens it. */
  density?: number;
  /** 1 is the designed drift. 0 holds the cloud still. */
  speed?: number;
  /** "system" follows the reader's reduced-motion setting. */
  reducedMotion?: "system" | "reduce" | "no-preference";
  /** Backing-store pixels per CSS pixel, at most. */
  maxPixelRatio?: number;
  /** Pixels the ray-marched image may have, at most. Lower for a cloud that only sits behind text. */
  maxPixels?: number;
  /** The element whose pointer moves push the fluid. Defaults to the canvas. False turns pushing off. */
  pointer?: HTMLElement | false;
  /** Called after each picture is drawn, while the canvas still holds it. */
  onDraw?: () => void;
};

export type FluidCloud = {
  /** False while paused by the caller, by reduced motion, or because the canvas is off screen. */
  readonly moving: boolean;
  /** Whether the fluid is being solved. False where the GPU cannot render to float textures. */
  readonly flowing: boolean;
  pause: () => void;
  resume: () => void;
  set: (options: Pick<FluidCloudOptions, "density" | "speed">) => void;
  /** Pushes the fluid at a point. Positions are 0..1 from the bottom left; the push is in screen heights per second. */
  push: (x: number, y: number, dx: number, dy: number) => void;
  /** Stops drawing and gives the GPU memory back. */
  dispose: () => void;
};

const NOISE_SIZE = 64;
const NOISE_CELLS = 8;
// Where in its drift a still cloud is held, in seconds.
const STILL_TIME = 40;
// Jacobi steps per frame. Fewer leaves the flow visibly compressible.
const PRESSURE_STEPS = 18;

type Program = {
  use: () => void;
  set: (name: string, ...values: number[]) => void;
  texture: (name: string, unit: number) => void;
};
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; size: Size };
type Pair = { read: Target; write: Target };
type Push = { x: number; y: number; dx: number; dy: number };

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("could not create a shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true && !gl.isContextLost()) {
    throw new Error(`shader did not compile: ${gl.getShaderInfoLog(shader) ?? ""}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, fragment: string): Program {
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("could not create a program");
  }
  const shaders = [
    compile(gl, gl.VERTEX_SHADER, vertex),
    compile(gl, gl.FRAGMENT_SHADER, fragment),
  ];
  for (const shader of shaders) {
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  for (const shader of shaders) {
    gl.deleteShader(shader);
  }
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) {
    throw new Error(`program did not link: ${gl.getProgramInfoLog(program) ?? ""}`);
  }

  const locations = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string): WebGLUniformLocation | null => {
    if (!locations.has(name)) {
      locations.set(name, gl.getUniformLocation(program, name));
    }
    return locations.get(name) ?? null;
  };
  return {
    use: () => gl.useProgram(program),
    set(name, ...values) {
      const [a = 0, b = 0, c = 0, d = 0] = values;
      if (values.length === 1) {
        gl.uniform1f(at(name), a);
      } else if (values.length === 2) {
        gl.uniform2f(at(name), a, b);
      } else if (values.length === 3) {
        gl.uniform3f(at(name), a, b, c);
      } else {
        gl.uniform4f(at(name), a, b, c, d);
      }
    },
    texture: (name, unit) => gl.uniform1i(at(name), unit),
  };
}

function target(gl: WebGL2RenderingContext, size: Size, format: "rgba8" | "rgba16f"): Target {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (format === "rgba8") {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      size.width,
      size.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      size.width,
      size.height,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null,
    );
  }
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
    gl.texParameteri(gl.TEXTURE_2D, axis, gl.CLAMP_TO_EDGE);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, size };
}

function release(gl: WebGL2RenderingContext, ...targets: Target[]): void {
  for (const each of targets) {
    gl.deleteTexture(each.texture);
    gl.deleteFramebuffer(each.framebuffer);
  }
}

function noiseTexture(gl: WebGL2RenderingContext, seed: number): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA16F,
    NOISE_SIZE,
    NOISE_SIZE,
    NOISE_SIZE,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    noiseVolume(NOISE_SIZE, NOISE_CELLS, seed),
  );
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
    gl.texParameteri(gl.TEXTURE_3D, axis, gl.REPEAT);
  }
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

/** Everything that lives on the GPU. Built again from nothing if the context is lost. */
function build(gl: WebGL2RenderingContext, seed: number) {
  // Rendering to float textures is an extension in WebGL2. Without it the cloud
  // still drifts and is still lit; it just cannot be pushed.
  const floats =
    gl.getExtension("EXT_color_buffer_float") ?? gl.getExtension("EXT_color_buffer_half_float");

  return {
    floats: floats !== null,
    volume: link(gl, volumeFragment),
    finish: link(gl, finishFragment),
    solve: {
      splat: link(gl, fluid.splat),
      curl: link(gl, fluid.curl),
      force: link(gl, fluid.force),
      advect: link(gl, fluid.advect),
      divergence: link(gl, fluid.divergence),
      pressure: link(gl, fluid.pressure),
      project: link(gl, fluid.project),
      carry: link(gl, fluid.carry),
    },
    noise: noiseTexture(gl, seed),
    // The triangle comes from gl_VertexID. WebGL2 still wants a vertex array bound.
    vertexArray: gl.createVertexArray(),
    // A flow that has carried nothing anywhere, for when there is no solve.
    calm: target(gl, { width: 1, height: 1 }, "rgba8"),
  };
}

export function createFluidCloud(
  canvas: HTMLCanvasElement,
  options: FluidCloudOptions = {},
): FluidCloud | undefined {
  const seed = options.seed ?? 17;
  const maxPixelRatio = options.maxPixelRatio ?? 2;
  let density = options.density ?? 1;
  let speed = options.speed ?? 1;

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (gl === null) {
    return undefined;
  }

  let gpu: ReturnType<typeof build>;
  try {
    gpu = build(gl, seed);
  } catch (error) {
    console.warn("fluid cloud: falling back to the still background.", error);
    return undefined;
  }

  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const still = (): boolean => wantsStill(options.reducedMotion ?? "system", reduceQuery.matches);

  // A place in the noise for this seed. Kept small: the texture repeats every 8 cells.
  const offset = [0.618_034, 0.414_214, 0.732_051].map((step) => (seed * step) % NOISE_CELLS);

  const maxPixels = options.maxPixels ?? budget.max;
  let pixels: number = Math.min(budget.start, maxPixels);
  let size: Size = { width: 0, height: 0 };
  let scene: Target | undefined;
  let velocity: Pair | undefined;
  let flow: Pair | undefined;
  let pressure: Pair | undefined;
  let scratch: Target | undefined;
  let curl: Target | undefined;
  const pushes: Push[] = [];

  let paused = false;
  let onScreen = true;
  let tabVisible = document.visibilityState === "visible";
  let lost = false;
  let disposed = false;
  let frame = 0;
  let clock = STILL_TIME;
  let last = 0;
  let slowest = 0;
  let frames = 0;

  const pass = (to: Target | null, width: number, height: number): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to === null ? null : to.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const bind = (unit: number, texture: WebGLTexture): void => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };
  const swap = (pair: Pair): void => {
    [pair.read, pair.write] = [pair.write, pair.read];
  };

  const fit = (): void => {
    const wanted = sceneSize(size, pixels);
    if (
      scene === undefined ||
      scene.size.width !== wanted.width ||
      scene.size.height !== wanted.height
    ) {
      if (scene !== undefined) {
        release(gl, scene);
      }
      scene = target(gl, wanted, "rgba8");
    }
    if (!gpu.floats) {
      return;
    }
    const cells = gridSize(size);
    if (
      velocity === undefined ||
      velocity.read.size.width !== cells.width ||
      velocity.read.size.height !== cells.height
    ) {
      // A new grid starts at rest. Resizing is rare, and the cloud itself does not jump.
      for (const pair of [velocity, flow, pressure]) {
        if (pair !== undefined) {
          release(gl, pair.read, pair.write);
        }
      }
      if (scratch !== undefined && curl !== undefined) {
        release(gl, scratch, curl);
      }
      const make = (): Pair => ({
        read: target(gl, cells, "rgba16f"),
        write: target(gl, cells, "rgba16f"),
      });
      velocity = make();
      flow = make();
      pressure = make();
      scratch = target(gl, cells, "rgba16f");
      curl = target(gl, cells, "rgba16f");
    }
  };

  /** One step of the fluid: forces, self-advection, projection, then carry the cloud's map. */
  const solve = (dt: number): void => {
    if (
      velocity === undefined ||
      flow === undefined ||
      pressure === undefined ||
      scratch === undefined ||
      curl === undefined
    ) {
      return;
    }
    const { width, height } = velocity.read.size;
    const aspect = width / height;
    const { solve: step } = gpu;
    const begin = (program: Program): void => {
      program.use();
      program.set("uTexel", 1 / width, 1 / height);
    };

    // The pointer: a push on the fluid, and a trace of light for it to carry.
    for (const push of pushes.splice(0)) {
      begin(step.splat);
      step.splat.set("uPoint", push.x, push.y);
      step.splat.set("uAspect", aspect);
      step.splat.texture("uTarget", 0);

      bind(0, velocity.read.texture);
      step.splat.set("uRadius", 0.0035);
      step.splat.set("uValue", push.dx, push.dy, 0, 0);
      pass(velocity.write, width, height);
      swap(velocity);

      const strength = Math.min(1, Math.hypot(push.dx, push.dy) * 0.6);
      bind(0, flow.read.texture);
      step.splat.set("uRadius", 0.0022);
      step.splat.set("uValue", 0, 0, strength * 0.5, strength * 0.2);
      pass(flow.write, width, height);
      swap(flow);
    }

    begin(step.curl);
    bind(0, velocity.read.texture);
    step.curl.texture("uVelocity", 0);
    pass(curl, width, height);

    begin(step.force);
    bind(0, velocity.read.texture);
    bind(1, curl.texture);
    step.force.texture("uVelocity", 0);
    step.force.texture("uCurl", 1);
    step.force.set("uDt", dt);
    step.force.set("uTime", clock);
    step.force.set("uAspect", aspect);
    step.force.set("uConfinement", 5);
    step.force.set("uStir", 0.006);
    pass(velocity.write, width, height);
    swap(velocity);

    // Velocities are in screen heights per second. The grid's UV spans 2 heights up and 2 × aspect across.
    const toUv = [0.5 / aspect, 0.5] as const;

    begin(step.advect);
    bind(0, velocity.read.texture);
    step.advect.texture("uVelocity", 0);
    step.advect.texture("uSource", 0);
    step.advect.set("uToUv", ...toUv);
    step.advect.set("uDt", dt);
    step.advect.set("uLoss", 0.8);
    pass(velocity.write, width, height);
    swap(velocity);

    begin(step.divergence);
    bind(0, velocity.read.texture);
    step.divergence.texture("uVelocity", 0);
    pass(scratch, width, height);

    // Last frame's pressure is a good first guess.
    begin(step.pressure);
    bind(1, scratch.texture);
    step.pressure.texture("uPressure", 0);
    step.pressure.texture("uDivergence", 1);
    for (let i = 0; i < PRESSURE_STEPS; i++) {
      bind(0, pressure.read.texture);
      pass(pressure.write, width, height);
      swap(pressure);
    }

    begin(step.project);
    bind(0, pressure.read.texture);
    bind(1, velocity.read.texture);
    step.project.texture("uPressure", 0);
    step.project.texture("uVelocity", 1);
    pass(velocity.write, width, height);
    swap(velocity);

    begin(step.carry);
    bind(0, velocity.read.texture);
    bind(1, flow.read.texture);
    step.carry.texture("uVelocity", 0);
    step.carry.texture("uFlow", 1);
    step.carry.set("uToUv", ...toUv);
    step.carry.set("uDt", dt);
    step.carry.set("uSettle", 0.3);
    step.carry.set("uFade", 0.45);
    pass(flow.write, width, height);
    swap(flow);
  };

  const draw = (): void => {
    fit();
    if (scene === undefined) {
      return;
    }
    gl.bindVertexArray(gpu.vertexArray);

    gpu.volume.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, gpu.noise);
    bind(1, flow === undefined ? gpu.calm.texture : flow.read.texture);
    gpu.volume.texture("uNoise", 0);
    gpu.volume.texture("uFlow", 1);
    gpu.volume.set("uResolution", scene.size.width, scene.size.height);
    gpu.volume.set("uTime", clock);
    gpu.volume.set("uSeed", offset[0] ?? 0, offset[1] ?? 0, offset[2] ?? 0);
    gpu.volume.set("uDensity", density);
    pass(scene, scene.size.width, scene.size.height);

    gpu.finish.use();
    bind(0, scene.texture);
    gpu.finish.texture("uScene", 0);
    gpu.finish.set("uResolution", size.width, size.height);
    gpu.finish.set("uSceneTexel", 1 / scene.size.width, 1 / scene.size.height);
    gpu.finish.set("uPixelRatio", size.width / Math.max(1, canvas.clientWidth));
    pass(null, size.width, size.height);
    options.onDraw?.();
  };

  const moving = (): boolean =>
    !paused && !still() && onScreen && tabVisible && !lost && !disposed && speed > 0;

  const tick = (now: number): void => {
    frame = 0;
    if (!moving()) {
      return;
    }
    // A tab that was in the background reports one very long frame. Do not jump the cloud by it.
    const elapsed = last === 0 ? 16 : Math.min(now - last, 50);
    last = now;
    const dt = (elapsed / 1000) * speed;
    clock += dt;
    fit();
    gl.bindVertexArray(gpu.vertexArray);
    solve(dt);
    draw();

    // Judge the size on the slowest of each 20 frames.
    slowest = Math.max(slowest, elapsed);
    frames += 1;
    if (frames === 20) {
      pixels = Math.min(maxPixels, nextBudget(pixels, slowest));
      slowest = 0;
      frames = 0;
    }
    frame = requestAnimationFrame(tick);
  };

  const wake = (): void => {
    if (frame !== 0 || lost || disposed) {
      return;
    }
    if (moving()) {
      last = 0;
      frame = requestAnimationFrame(tick);
    } else {
      // Held still, but the size or the settings may have changed.
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!lost && !disposed) {
          draw();
        }
      });
    }
  };

  const resize = new ResizeObserver(() => {
    const next = canvasSize(
      canvas.clientWidth,
      canvas.clientHeight,
      window.devicePixelRatio,
      maxPixelRatio,
    );
    if (next.width === size.width && next.height === size.height) {
      return;
    }
    size = next;
    canvas.width = size.width;
    canvas.height = size.height;
    wake();
  });
  resize.observe(canvas);

  const watch = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    wake();
  });
  watch.observe(canvas);

  const push = (x: number, y: number, dx: number, dy: number): void => {
    // Only the newest few matter, and a paused cloud should not wake up to a backlog.
    if (moving() && pushes.length < 16) {
      pushes.push({ x, y, dx, dy });
    }
  };

  // Each pointer's last position, to turn moves into pushes.
  const pointers = new Map<number, { x: number; y: number; at: number }>();
  const onPointerMove = (event: PointerEvent): void => {
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      return;
    }
    const x = (event.clientX - box.left) / box.width;
    const y = 1 - (event.clientY - box.top) / box.height;
    const before = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x, y, at: event.timeStamp });
    if (before === undefined) {
      return;
    }
    const seconds = Math.max((event.timeStamp - before.at) / 1000, 1 / 240);
    // From a fraction of the box to screen heights, then to a speed the fluid can take.
    const dx = ((x - before.x) * 2 * (box.width / box.height)) / seconds;
    const dy = ((y - before.y) * 2) / seconds;
    const scale = Math.min(1, 3 / (Math.hypot(dx, dy) + 0.0001)) * 0.32;
    push(x, y, dx * scale, dy * scale);
  };
  const onPointerGone = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
  };
  const surface = options.pointer === false ? undefined : (options.pointer ?? canvas);
  surface?.addEventListener("pointermove", onPointerMove, { passive: true });
  surface?.addEventListener("pointerleave", onPointerGone);
  surface?.addEventListener("pointercancel", onPointerGone);
  surface?.addEventListener("pointerup", onPointerGone);

  const onVisibility = (): void => {
    tabVisible = document.visibilityState === "visible";
    wake();
  };
  const onContextLost = (event: Event): void => {
    // Without this the browser never offers the context back.
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const onContextRestored = (): void => {
    gpu = build(gl, seed);
    scene = undefined;
    velocity = undefined;
    flow = undefined;
    pressure = undefined;
    scratch = undefined;
    curl = undefined;
    lost = false;
    wake();
  };

  document.addEventListener("visibilitychange", onVisibility);
  reduceQuery.addEventListener("change", wake);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  return {
    get moving() {
      return moving();
    },
    get flowing() {
      return gpu.floats;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      wake();
    },
    set(next) {
      density = next.density ?? density;
      speed = next.speed ?? speed;
      wake();
    },
    push,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      watch.disconnect();
      surface?.removeEventListener("pointermove", onPointerMove);
      surface?.removeEventListener("pointerleave", onPointerGone);
      surface?.removeEventListener("pointercancel", onPointerGone);
      surface?.removeEventListener("pointerup", onPointerGone);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceQuery.removeEventListener("change", wake);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      // Dropping the context frees every texture and program at once.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
