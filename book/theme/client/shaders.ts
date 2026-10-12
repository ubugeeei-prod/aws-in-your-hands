// The programs behind the cover.
//
// 1. `fluid` solves an incompressible flow on a small grid: the pointer pushes it,
//    pressure keeps it from piling up, and it carries a map of where the cloud has gone.
// 2. `volumeFragment` marches a ray through the cloud, looked up through that map,
//    and writes a small image.
// 3. `finishFragment` enlarges that image to the screen and lays the paper grain over it.
//
// The flow is a real solve, in two dimensions. The cloud's depth and its light are an
// optical approximation: absorption and scattering along the ray, not a 3D simulation.

export const vertex = /* glsl */ `#version 300 es
// One triangle that covers the screen.
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const volumeFragment = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;

// r, g: two gradient noises. b, a: cellular noise, coarse and fine, bright at the cell centres.
uniform sampler3D uNoise;
// xy: how far the flow has carried the cloud here. z: light left by the pointer. w: its warmth.
uniform sampler2D uFlow;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uSeed;
uniform float uDensity;

out vec4 outColor;

const int STEPS = 56;
const int LIGHT_STEPS = 4;
const float DEPTH = 3.2;
const float NOISE_SIZE = 64.0;
// The noise texture repeats every 8 cells.
const float CELLS = 8.0;

// The wind runs down and to the right, slightly away from the viewer.
const vec3 ALONG = vec3(0.8242, -0.4945, 0.2747);
const vec3 ACROSS = vec3(0.5145, 0.8575, 0.0);
const vec3 INTO = vec3(-0.2356, 0.1413, 0.9615);
// The sun is low, up and to the right, a little behind the clouds. Light crosses each
// cloud sideways, so one flank is lit and the other is in its own shadow.
const vec3 SUN = vec3(0.6767, 0.6992, 0.2301);

vec3 linear(vec3 srgb) {
  return pow(srgb, vec3(2.2));
}

float remap(float value, float low, float high) {
  return clamp((value - low) / (high - low), 0.0, 1.0);
}

// Texel coordinates are eased so the trilinear filter does not leave creases at texel borders.
vec4 noise(vec3 cell) {
  vec3 p = cell / CELLS * NOISE_SIZE + 0.5;
  vec3 i = floor(p);
  vec3 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise, (i + f - 0.5) / NOISE_SIZE);
}

// Plain filtering, for detail finer than the easing above can keep.
vec4 detail(vec3 cell) {
  return texture(uNoise, cell / CELLS);
}

// World position to the space the cloud lives in. The wind leans the shapes only slightly:
// drawn out far along it they read as streaks in a liquid, not as heaps of vapour.
vec3 wind(vec3 p) {
  vec3 q = vec3(dot(p, ALONG) * 0.62, dot(p, ACROSS) * 0.86, dot(p, INTO) * 0.9);
  q += uSeed;
  q.x -= uTime * 0.016;
  // Slow turbulence, so the shapes roll over as they travel and never just slide.
  vec3 churn = noise(q * 0.4 + vec3(0.0, uTime * 0.008, uTime * 0.011)).rgg - 0.5;
  return q + churn * vec3(0.55, 0.6, 0.55);
}

// How much of the sky has cloud at all, over long distances.
float cover(vec3 q) {
  return mix(0.58, 0.96, smoothstep(0.38, 0.62, noise(q * 0.22 + 1.9).r));
}

// The body of the cloud: gradient noise for the large forms, cellular noise for the billows.
float body(vec3 q, float amount) {
  vec4 a = noise(q);
  vec4 b = detail(q * 2.0 + 0.37);
  // Gradient noise keeps close to its middle. Spread it out to use the whole range.
  float soft = clamp((a.r * 0.62 + b.g * 0.38 - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float billow = a.b * 0.62 + b.a * 0.38;
  // The cellular noise cuts deep, so the mass comes out in rounded heaps, as vapour does.
  float form = remap(soft, (1.0 - billow) * 0.46, 1.0);
  return remap(form, 1.0 - amount, 1.0);
}

// Density in 0..1. The edges are eaten away by finer billows, as real cloud edges are by dry air.
float cloud(vec3 p) {
  vec3 q = wind(p);
  float amount = cover(q);
  float d = body(q, amount);
  if (d <= 0.0) {
    return 0.0;
  }
  vec4 fine = detail(q * 4.3 + 2.1);
  vec4 finer = detail(q * 9.1 + 4.7);
  float wisps = fine.a * 0.6 + finer.b * 0.25 + finer.a * 0.15;
  d = remap(d, (1.0 - wisps) * 0.44 * (1.0 - d * 0.5), 1.0);
  return d * amount * 2.3;
}

// The same cloud without the eaten edges, for the rays towards the sun.
float cloudCoarse(vec3 p) {
  vec3 q = wind(p);
  float amount = cover(q);
  return body(q, amount) * amount * 2.3;
}

// Henyey-Greenstein: how much light a droplet sends on at this angle.
float phase(float cosine, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * cosine, 1.5));
}

float jitter(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;

  vec3 origin = vec3(uv, 0.0);
  vec3 ray = normalize(vec3(uv * 0.32, 1.0));

  vec3 navy = linear(vec3(0.0627, 0.1059, 0.1686));
  vec3 indigo = linear(vec3(0.165, 0.11, 0.48));
  vec3 violet = linear(vec3(0.3961, 0.2039, 0.8745));
  vec3 pink = linear(vec3(0.9529, 0.0, 0.8745));
  vec3 blush = linear(vec3(1.0, 0.4392, 0.8706));
  vec3 ember = linear(vec3(1.0, 0.5412, 0.0));

  // Dusk. The sky is navy, deepening to indigo, with the last pink low on the left.
  float up = smoothstep(-1.0, 1.0, uv.y);
  vec3 sky = mix(navy * 0.22, mix(navy, indigo, 0.45) * 0.55, up);
  sky += pink * 0.10 * smoothstep(1.6, 0.0, length(uv - vec2(-1.3, -0.9)));

  // Sunlight is white where it comes straight through and turns pink across the frame.
  float across = smoothstep(-1.2, 1.2, uv.x * 0.7 + uv.y * 0.6);
  vec3 sun = mix(mix(pink, violet, 0.25), linear(vec3(0.86, 0.83, 0.92)), across * across) * 3.0;
  vec3 above = mix(violet, indigo, 0.5) * 0.2;
  vec3 below = navy * 0.12 + indigo * 0.05;

  vec4 flow = texture(uFlow, gl_FragCoord.xy / uResolution);
  float glow = min(flow.z, 2.0);
  float warmth = clamp(flow.w / (flow.z + 0.001), 0.0, 1.0);

  // Forward and back scattering together: a strong rim towards the sun, and some light sent back.
  float cosine = dot(ray, SUN);
  float scatter = 0.8 + mix(phase(cosine, 0.72), phase(cosine, -0.25), 0.32) * 3.0;

  float stepLength = DEPTH / float(STEPS);
  float travelled = stepLength * jitter(gl_FragCoord.xy);
  vec3 colour = vec3(0.0);
  float through = 1.0;

  for (int i = 0; i < STEPS; i++) {
    float depth = travelled / DEPTH;
    // Near clouds are carried further than far ones, as they would be seen to.
    vec3 p = origin + ray * travelled - vec3(flow.xy * mix(1.2, 0.5, depth), 0.0);
    float density = cloud(p) * uDensity;

    if (density > 0.003) {
      // The optical depth between here and the sun, in a few growing steps.
      float thickness = 0.0;
      float reach = 0.07;
      vec3 towards = p;
      for (int j = 0; j < LIGHT_STEPS; j++) {
        towards += SUN * reach;
        thickness += cloudCoarse(towards) * uDensity * reach;
        reach *= 1.7;
      }
      // Beer's law, plus a second, gentler falloff for the light that scatters
      // many times inside the cloud. Without it the thick parts go black.
      float beer = max(exp(-thickness * 24.0), 0.2 * exp(-thickness * 4.5));
      // Thin edges facing away from the sun are darker than their thickness alone says.
      float powder = 1.0 - exp(-density * 3.2);

      float height = smoothstep(-1.1, 1.1, uv.y + (0.5 - depth) * 0.4);
      vec3 ambient = mix(below, above, height) * (0.45 + 0.55 * exp(-thickness * 3.0));
      vec3 shade = sun * beer * mix(powder, 1.0, 0.35) * scatter + ambient;

      // Where the pointer has been, the cloud holds light for a while.
      shade += mix(blush, ember, warmth * 0.6) * glow * 0.9;

      // Distance takes the clouds into the sky.
      shade = mix(shade, sky, depth * depth * 0.6);

      float covered = 1.0 - exp(-density * stepLength * 11.0);
      colour += through * covered * shade;
      through *= 1.0 - covered;
      if (through < 0.015) {
        break;
      }
    }
    travelled += stepLength;
  }

  colour += through * sky;

  // Soft shoulder, then display gamma. The dither hides the 8-bit steps in the dark end.
  colour = colour / (1.0 + colour * 0.6);
  colour = pow(colour, vec3(1.0 / 2.2));
  colour += (jitter(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  outColor = vec4(colour, 1.0);
}
`;

export const finishFragment = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform vec2 uSceneTexel;
uniform float uPixelRatio;

out vec4 outColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float value(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  // A small tent filter: the scene is rendered smaller than the screen and jittered.
  vec3 colour = texture(uScene, uv).rgb * 0.25;
  colour += texture(uScene, uv + vec2(uSceneTexel.x, 0.0)).rgb * 0.125;
  colour += texture(uScene, uv - vec2(uSceneTexel.x, 0.0)).rgb * 0.125;
  colour += texture(uScene, uv + vec2(0.0, uSceneTexel.y)).rgb * 0.125;
  colour += texture(uScene, uv - vec2(0.0, uSceneTexel.y)).rgb * 0.125;
  colour += texture(uScene, uv + uSceneTexel).rgb * 0.0625;
  colour += texture(uScene, uv - uSceneTexel).rgb * 0.0625;
  colour += texture(uScene, uv + vec2(uSceneTexel.x, -uSceneTexel.y)).rgb * 0.0625;
  colour += texture(uScene, uv + vec2(-uSceneTexel.x, uSceneTexel.y)).rgb * 0.0625;

  // Grain in CSS pixels, so it looks the same on every display density.
  // Long threads across, shorter ones down: the weave of a printed cover.
  vec2 px = gl_FragCoord.xy / uPixelRatio;
  float weft = value(px * vec2(0.085, 0.95));
  float warp = value(px * vec2(0.95, 0.11) + 40.0);
  float tooth = hash(floor(px * 1.0));
  float grain = (weft - 0.5) * 0.05 + (warp - 0.5) * 0.03 + (tooth - 0.5) * 0.03;
  colour *= 1.0 + grain;
  colour += grain * 0.012;

  // The corners fall back into the navy, where the small text sits.
  vec2 centred = uv * 2.0 - 1.0;
  float corner = smoothstep(0.55, 1.5, length(centred * vec2(0.85, 1.0)));
  colour *= 1.0 - corner * 0.42;
  // And the foot of the picture stays deep enough for the white title to stand on.
  colour *= 1.0 - 0.45 * smoothstep(0.6, 0.05, uv.y);

  colour += (hash(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;
  outColor = vec4(colour, 1.0);
}
`;

// ---- the flow ---------------------------------------------------------------
//
// Stable fluids on a grid: add forces, carry the velocity along itself, then remove
// whatever divergence that left by solving for pressure. Velocities are in screen
// heights per second, so the grid's shape does not change the motion.

const grid = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uTexel;
out vec4 outColor;
#define UV (gl_FragCoord.xy * uTexel)
`;

export const fluid = {
  /** Adds a soft dot of `uValue` at `uPoint`: a push, or a trace of light. */
  splat: /* glsl */ `${grid}
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec4 uValue;
uniform float uRadius;
uniform float uAspect;

void main() {
  vec2 d = UV - uPoint;
  d.x *= uAspect;
  outColor = texture(uTarget, UV) + uValue * exp(-dot(d, d) / uRadius);
}
`,

  /** How much the flow spins at each cell. */
  curl: /* glsl */ `${grid}
uniform sampler2D uVelocity;

void main() {
  float left = texture(uVelocity, UV - vec2(uTexel.x, 0.0)).y;
  float right = texture(uVelocity, UV + vec2(uTexel.x, 0.0)).y;
  float below = texture(uVelocity, UV - vec2(0.0, uTexel.y)).x;
  float above = texture(uVelocity, UV + vec2(0.0, uTexel.y)).x;
  outColor = vec4(0.5 * (right - left - above + below), 0.0, 0.0, 1.0);
}
`,

  /**
   * Forces. Vorticity confinement gives back the small eddies the grid smears away,
   * and a slow stir keeps the current alive when nobody touches it.
   */
  force: /* glsl */ `${grid}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uDt;
uniform float uTime;
uniform float uAspect;
uniform float uConfinement;
uniform float uStir;

void main() {
  float left = texture(uCurl, UV - vec2(uTexel.x, 0.0)).x;
  float right = texture(uCurl, UV + vec2(uTexel.x, 0.0)).x;
  float below = texture(uCurl, UV - vec2(0.0, uTexel.y)).x;
  float above = texture(uCurl, UV + vec2(0.0, uTexel.y)).x;
  float here = texture(uCurl, UV).x;

  vec2 eddy = 0.5 * vec2(abs(above) - abs(below), abs(right) - abs(left));
  eddy /= length(eddy) + 0.0001;
  eddy *= uConfinement * here;
  eddy.y = -eddy.y;

  vec2 w = (UV * 2.0 - 1.0) * vec2(uAspect, 1.0);
  vec2 stir = vec2(
    sin(w.y * 2.1 + uTime * 0.21 + sin(w.x * 1.3 - uTime * 0.13)),
    -sin(w.x * 1.7 - uTime * 0.17 + sin(w.y * 1.9 + uTime * 0.11))
  );

  vec2 velocity = texture(uVelocity, UV).xy + (eddy + stir * uStir) * uDt;
  outColor = vec4(clamp(velocity, -6.0, 6.0), 0.0, 1.0);
}
`,

  /** Carries `uSource` along the velocity, losing a little on the way. */
  advect: /* glsl */ `${grid}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uToUv;
uniform float uDt;
uniform float uLoss;

void main() {
  vec2 from = UV - uDt * texture(uVelocity, UV).xy * uToUv;
  outColor = texture(uSource, from) * exp(-uLoss * uDt);
}
`,

  divergence: /* glsl */ `${grid}
uniform sampler2D uVelocity;

void main() {
  float left = texture(uVelocity, UV - vec2(uTexel.x, 0.0)).x;
  float right = texture(uVelocity, UV + vec2(uTexel.x, 0.0)).x;
  float below = texture(uVelocity, UV - vec2(0.0, uTexel.y)).y;
  float above = texture(uVelocity, UV + vec2(0.0, uTexel.y)).y;
  outColor = vec4(0.5 * (right - left + above - below), 0.0, 0.0, 1.0);
}
`,

  /** One Jacobi step towards the pressure that cancels the divergence. */
  pressure: /* glsl */ `${grid}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main() {
  float left = texture(uPressure, UV - vec2(uTexel.x, 0.0)).x;
  float right = texture(uPressure, UV + vec2(uTexel.x, 0.0)).x;
  float below = texture(uPressure, UV - vec2(0.0, uTexel.y)).x;
  float above = texture(uPressure, UV + vec2(0.0, uTexel.y)).x;
  outColor = vec4((left + right + below + above - texture(uDivergence, UV).x) * 0.25, 0.0, 0.0, 1.0);
}
`,

  /** Subtracts the pressure's slope: what is left neither gathers nor spreads. */
  project: /* glsl */ `${grid}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main() {
  float left = texture(uPressure, UV - vec2(uTexel.x, 0.0)).x;
  float right = texture(uPressure, UV + vec2(uTexel.x, 0.0)).x;
  float below = texture(uPressure, UV - vec2(0.0, uTexel.y)).x;
  float above = texture(uPressure, UV + vec2(0.0, uTexel.y)).x;
  vec2 velocity = texture(uVelocity, UV).xy - 0.5 * vec2(right - left, above - below);
  outColor = vec4(velocity, 0.0, 1.0);
}
`,

  /**
   * Carries the map the cloud is drawn through. Each cell remembers how far its
   * cloud has come (xy), so a push is seen as the cloud itself moving, folds and all.
   * The memory fades: left alone, the cloud settles back into its own drift.
   */
  carry: /* glsl */ `${grid}
uniform sampler2D uVelocity;
uniform sampler2D uFlow;
uniform vec2 uToUv;
uniform float uDt;
uniform float uSettle;
uniform float uFade;

void main() {
  vec2 velocity = texture(uVelocity, UV).xy;
  vec4 flow = texture(uFlow, UV - uDt * velocity * uToUv);
  flow.xy = (flow.xy + velocity * uDt) * exp(-uSettle * uDt);
  // Past about a third of the screen the cloud would be stretched out of recognition.
  flow.xy *= min(1.0, 0.7 / (length(flow.xy) + 0.0001));
  flow.zw *= exp(-uFade * uDt);
  outColor = flow;
}
`,
} as const;
