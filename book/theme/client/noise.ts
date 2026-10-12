// The 3D texture the cloud is made of: four gradient noises that repeat at the edges.
// Built once on the CPU, so the shader pays one texture fetch where it would pay four hashes.

/** A small deterministic generator (mulberry32). The same seed gives the same cloud. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * One channel of gradient noise on a lattice of `cells`³ that wraps around.
 * Returns a function of a position measured in cells. Output is roughly -1..1.
 */
export function tileableNoise(
  cells: number,
  seed: number,
): (x: number, y: number, z: number) => number {
  const next = random(seed);
  // A unit gradient per lattice point.
  const gradients = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < gradients.length; i += 3) {
    const z = next() * 2 - 1;
    const angle = next() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    gradients[i] = r * Math.cos(angle);
    gradients[i + 1] = r * Math.sin(angle);
    gradients[i + 2] = z;
  }
  const wrap = (n: number): number => ((n % cells) + cells) % cells;
  const corner = (
    ix: number,
    iy: number,
    iz: number,
    dx: number,
    dy: number,
    dz: number,
  ): number => {
    const at = ((wrap(iz) * cells + wrap(iy)) * cells + wrap(ix)) * 3;
    return (
      (gradients[at] ?? 0) * dx + (gradients[at + 1] ?? 0) * dy + (gradients[at + 2] ?? 0) * dz
    );
  };

  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);
    const near = mix(
      mix(corner(ix, iy, iz, fx, fy, fz), corner(ix + 1, iy, iz, fx - 1, fy, fz), u),
      mix(
        corner(ix, iy + 1, iz, fx, fy - 1, fz),
        corner(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz),
        u,
      ),
      v,
    );
    const far = mix(
      mix(
        corner(ix, iy, iz + 1, fx, fy, fz - 1),
        corner(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1),
        u,
      ),
      mix(
        corner(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1),
        corner(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1),
        u,
      ),
      v,
    );
    // Gradient noise in 3D stays within about ±0.87.
    return mix(near, far, w) / 0.87;
  };
}

/** A 32-bit float as the 16 bits WebGL calls HALF_FLOAT. Enough for values near 0..1. */
export function toHalf(value: number): number {
  if (value === 0) {
    return 0;
  }
  const sign = value < 0 ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  let exponent = Math.floor(Math.log2(magnitude));
  if (exponent < -14) {
    // Subnormal: no implicit leading 1.
    return sign | Math.round(magnitude / 2 ** -24);
  }
  if (exponent > 15) {
    return sign | 0x7c00;
  }
  let mantissa = Math.round((magnitude / 2 ** exponent - 1) * 1024);
  if (mantissa === 1024) {
    mantissa = 0;
    exponent += 1;
  }
  return sign | ((exponent + 15) << 10) | mantissa;
}

/**
 * Cellular noise that wraps around: one point per lattice cell, and the distance to the
 * nearest. Returned upside down, 1 at a point and 0 far from all of them, which is the
 * shape of a billow.
 */
export function tileableCells(
  cells: number,
  seed: number,
): (x: number, y: number, z: number) => number {
  const next = random(seed);
  const points = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < points.length; i++) {
    points[i] = next();
  }
  const wrap = (n: number): number => ((n % cells) + cells) % cells;

  return (x, y, z) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let nearest = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const at = ((wrap(iz + dz) * cells + wrap(iy + dy)) * cells + wrap(ix + dx)) * 3;
          const px = ix + dx + (points[at] ?? 0) - x;
          const py = iy + dy + (points[at + 1] ?? 0) - y;
          const pz = iz + dz + (points[at + 2] ?? 0) - z;
          nearest = Math.min(nearest, px * px + py * py + pz * pz);
        }
      }
    }
    return Math.max(0, 1 - Math.sqrt(nearest));
  };
}

/**
 * `size`³ texels of RGBA in 0..1. Red and green are gradient noise around 0.5;
 * blue and alpha are cellular noise, coarse and fine.
 * Texel centres sit at (index + 0.5) / size of the repeat.
 */
export function noiseVolume(size: number, cells: number, seed: number): Uint16Array {
  const gradient = (channel: number) => {
    const noise = tileableNoise(cells, seed * 4 + channel);
    return (x: number, y: number, z: number): number => noise(x, y, z) * 0.5 + 0.5;
  };
  // The cellular lattices divide the gradient one, so every channel repeats together.
  const cellular = (channel: number, per: number) => {
    const noise = tileableCells(cells / per, seed * 4 + channel);
    return (x: number, y: number, z: number): number => noise(x / per, y / per, z / per);
  };
  const channels = [gradient(0), gradient(1), cellular(2, 2), cellular(3, 1)];
  const data = new Uint16Array(size * size * size * 4);
  const scale = cells / size;
  let at = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (const channel of channels) {
          const n = channel((x + 0.5) * scale, (y + 0.5) * scale, (z + 0.5) * scale);
          data[at++] = toHalf(Math.min(1, Math.max(0, n)));
        }
      }
    }
  }
  return data;
}
