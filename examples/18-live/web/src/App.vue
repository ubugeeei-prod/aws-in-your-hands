<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { loadConfig } from "./config.ts";
import { type Playback, playerSupported, startPlayback } from "./player.ts";
import { type PlayerSignal, type View, viewFor } from "./viewer.ts";

const video = useTemplateRef<HTMLVideoElement>("video");
const setup = ref<"starting" | "unconfigured" | "unsupported" | "ready" | "failed">("starting");
const problem = ref("");
const view = ref<View>({ name: "connecting" });
const muted = ref(true);
const latency = ref<{ seconds: number; lowLatency: boolean }>();
const lastMetadata = ref("");

let playback: Playback | undefined;
let offlineAttempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let latencyTimer: ReturnType<typeof setInterval> | undefined;

function onSignal(signal: PlayerSignal): void {
  const next = viewFor(signal, offlineAttempts);
  view.value = next;
  clearTimeout(retryTimer);
  if (next.name === "offline") {
    offlineAttempts += 1;
    retryTimer = setTimeout(() => playback?.reload(), next.retryInMs);
  } else if (next.name === "playing") {
    offlineAttempts = 0;
  }
}

function retryNow(): void {
  clearTimeout(retryTimer);
  view.value = { name: "connecting" };
  playback?.reload();
}

function toggleMuted(): void {
  muted.value = !muted.value;
  playback?.setMuted(muted.value);
}

onMounted(async () => {
  try {
    const config = await loadConfig();
    if (config.playbackUrl === null) {
      setup.value = "unconfigured";
      return;
    }
    if (!playerSupported || video.value === null) {
      setup.value = "unsupported";
      return;
    }
    playback = startPlayback(video.value, config.playbackUrl, {
      signal: onSignal,
      metadata: (text) => (lastMetadata.value = text),
    });
    // Each viewer has its own delay. Showing it makes that visible.
    latencyTimer = setInterval(() => {
      latency.value = view.value.name === "playing" ? playback?.latency() : undefined;
    }, 1_000);
    setup.value = "ready";
  } catch (error) {
    setup.value = "failed";
    problem.value = String(error);
  }
});

onBeforeUnmount(() => {
  clearTimeout(retryTimer);
  clearInterval(latencyTimer);
  playback?.stop();
});
</script>

<template>
  <main>
    <h1>Live</h1>

    <p v-if="setup === 'starting'">Starting…</p>
    <p v-else-if="setup === 'unconfigured'">
      No channel is configured. Deploy the stack, then run <code>vp run stream:config</code> and
      <code>vp run preview:stream:web</code>.
    </p>
    <p v-else-if="setup === 'unsupported'" role="alert">This browser cannot run the IVS player (no WebAssembly).</p>
    <p v-else-if="setup === 'failed'" role="alert">The page could not start: {{ problem }}</p>

    <!-- playsinline: without it iOS Safari opens the video full screen. -->
    <video v-show="setup === 'ready'" ref="video" playsinline />

    <section v-if="setup === 'ready'">
      <p v-if="view.name === 'connecting'">Connecting…</p>
      <p v-else-if="view.name === 'buffering'">Buffering…</p>
      <p v-else-if="view.name === 'paused'">
        Paused.
        <button type="button" @click="playback?.play()">Play</button>
      </p>
      <p v-else-if="view.name === 'offline'">
        The channel is offline. Checking again in {{ Math.round(view.retryInMs / 1000) }} s.
        <button type="button" @click="retryNow">Check now</button>
      </p>
      <p v-else-if="view.name === 'full'" role="alert">The channel has reached its viewer limit.</p>
      <p v-else-if="view.name === 'failed'" role="alert">
        Playback failed: {{ view.message }}
        <button type="button" @click="retryNow">Try again</button>
      </p>
      <p v-else>
        Live.
        <span v-if="latency !== undefined">
          About {{ latency.seconds.toFixed(1) }} s behind the server ({{
            latency.lowLatency ? "low-latency" : "normal-latency"
          }}
          mode).
        </span>
      </p>

      <button type="button" @click="toggleMuted">{{ muted ? "Unmute" : "Mute" }}</button>
      <p v-if="lastMetadata !== ''">
        Timed metadata: <code>{{ lastMetadata }}</code>
      </p>
    </section>
  </main>
</template>
