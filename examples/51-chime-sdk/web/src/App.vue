<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";

import { createNotesClient } from "@aih/example-06-auth/api/src/client.ts";
import { createCognitoProvider } from "@aih/example-06-auth/web/src/auth/cognito.ts";
import { createLocalProvider } from "@aih/example-06-auth/web/src/auth/local.ts";
import type { AuthProvider, Session } from "@aih/example-06-auth/web/src/auth/provider.ts";

import { createRoomsClient, type RoomsClient, RoomsError } from "../../api/src/client.ts";
import type { RoomView } from "../../api/src/contract.ts";
import { type CallSignal, type CallView, shouldLeave, viewFor, withPresence } from "./call.ts";
import { type CallsConfig, loadCallsConfig } from "./config.ts";
import type { Call, Tile } from "./session.ts";

const audio = useTemplateRef<HTMLAudioElement>("audio");
const status = ref<"starting" | "signed-out" | "signed-in" | "failed">("starting");
const problem = ref("");
const localUser = ref("alice");
const me = ref("");
const roomId = ref("");
const room = ref<RoomView>();
const invitee = ref("");
const view = ref<CallView>({ name: "idle" });
// Holding a seat and being connected are two facts. Without media only the first exists.
const seated = ref(false);
const present = ref<string[]>([]);
const tiles = ref<Tile[]>([]);
const muted = ref(false);
const camera = ref(false);
// "none": the API hands out seats in a fake meeting, and there is nothing to connect to.
const media = ref<CallsConfig["media"]>("none");

// Memory only, as in chapter 06. The join token is never stored at all: it goes from the
// API's answer into the meeting session and nowhere else.
let session: Session | undefined;
let auth: AuthProvider | undefined;
let rooms: RoomsClient | undefined;
let apiUrl = "";
let call: Call | undefined;

const authMode = computed(() => auth?.mode ?? "local");
const isOwner = computed(() => room.value?.owner === me.value);

function fail(error: unknown): void {
  if (error instanceof RoomsError && error.code === "unauthenticated") {
    session = undefined;
    status.value = "signed-out";
    problem.value = "Your session has ended. Sign in again.";
    return;
  }
  problem.value = error instanceof Error ? error.message : String(error);
}

async function attempt(run: () => Promise<void>): Promise<void> {
  problem.value = "";
  try {
    await run();
  } catch (error) {
    fail(error);
  }
}

const refresh = async (): Promise<void> => {
  if (rooms !== undefined && room.value !== undefined) {
    room.value = await rooms.get(room.value.id);
  }
};

const createRoom = () =>
  attempt(async () => {
    room.value = await rooms?.create();
  });

const openRoom = () =>
  attempt(async () => {
    room.value = await rooms?.get(roomId.value.trim());
  });

const invite = () =>
  attempt(async () => {
    if (room.value !== undefined) {
      await rooms?.invite(room.value.id, invitee.value.trim());
      invitee.value = "";
      await refresh();
    }
  });

const removeMember = (sub: string) =>
  attempt(async () => {
    if (room.value !== undefined) {
      await rooms?.remove(room.value.id, sub);
      await refresh();
    }
  });

function onSignal(signal: CallSignal): void {
  view.value = viewFor(signal);
  if (signal.kind !== "stopped") {
    return;
  }
  call = undefined;
  present.value = [];
  tiles.value = [];
  camera.value = false;
  // A seat that moved to another device is still in use: leaving would end it there too.
  if (shouldLeave(signal.code)) {
    void release();
  } else {
    seated.value = false;
  }
}

const release = () =>
  attempt(async () => {
    if (room.value !== undefined) {
      await rooms?.leave(room.value.id);
      seated.value = false;
      await refresh();
    }
  });

const join = () =>
  attempt(async () => {
    if (rooms === undefined || room.value === undefined) {
      return;
    }
    const seat = await rooms.join(room.value.id);
    seated.value = true;
    await refresh();
    if (media.value !== "chime" || audio.value === null) {
      return;
    }
    // Loaded only when there is something to connect to.
    const { startCall } = await import("./session.ts");
    call = await startCall(seat, audio.value, {
      signal: onSignal,
      presence: (user, isPresent) => (present.value = withPresence(present.value, user, isPresent)),
      tile: (tile) =>
        (tiles.value = [...tiles.value.filter((other) => other.id !== tile.id), tile]),
      tileRemoved: (id) => (tiles.value = tiles.value.filter((tile) => tile.id !== id)),
    });
  });

function leave(): void {
  if (call === undefined) {
    void release();
    return;
  }
  // The session reports "Left", and onSignal gives the seat back.
  call.stop();
}

function toggleMuted(): void {
  muted.value = !muted.value;
  call?.setMuted(muted.value);
}

const toggleCamera = () =>
  attempt(async () => {
    await call?.setCamera(!camera.value);
    camera.value = !camera.value;
  });

const closeRoom = () =>
  attempt(async () => {
    if (room.value !== undefined) {
      await rooms?.close(room.value.id);
      room.value = undefined;
      seated.value = false;
    }
  });

function bindTile(tileId: number, element: unknown): void {
  if (element instanceof HTMLVideoElement) {
    call?.bindVideo(tileId, element);
  }
}

async function signedIn(next: Session): Promise<void> {
  session = next;
  me.value = (await createNotesClient(apiUrl, () => session?.accessToken).me()).sub;
  status.value = "signed-in";
}

const signIn = () =>
  attempt(async () => {
    const next = await auth?.signIn(localUser.value);
    if (next !== undefined) {
      await signedIn(next);
    }
  });

function signOut(): void {
  call?.stop();
  session = undefined;
  room.value = undefined;
  status.value = "signed-out";
  const url = auth?.signOutUrl();
  if (url !== undefined) {
    window.location.assign(url);
  }
}

onMounted(async () => {
  try {
    const config = await loadCallsConfig();
    apiUrl = config.apiUrl;
    media.value = config.media;
    auth =
      config.auth.mode === "local"
        ? createLocalProvider(config.apiUrl)
        : createCognitoProvider(
            {
              issuer: config.auth.issuer,
              domain: config.auth.domain,
              clientId: config.auth.clientId,
              redirectUri: `${window.location.origin}/callback`,
              signedOutUri: `${window.location.origin}/`,
            },
            window.sessionStorage,
            (url) => window.location.assign(url),
          );
    rooms = createRoomsClient(config.apiUrl, () => session?.accessToken);

    const returned = await auth.completeSignIn(new URL(window.location.href));
    if (window.location.pathname === "/callback") {
      window.history.replaceState(null, "", "/");
    }
    if (returned === undefined) {
      status.value = "signed-out";
    } else {
      await signedIn(returned);
    }
  } catch (error) {
    status.value = "failed";
    problem.value = String(error);
  }
});

// Closing the tab runs none of this reliably. The attendee then lives until the meeting ends.
onBeforeUnmount(() => call?.stop());
</script>

<template>
  <main>
    <header>
      <h1>Rooms</h1>
      <span v-if="status === 'signed-in'">
        <code>{{ me }}</code>
        <button type="button" @click="signOut">Sign out</button>
      </span>
    </header>

    <p v-if="problem !== ''" role="alert">{{ problem }}</p>

    <p v-if="status === 'starting'">Starting…</p>
    <p v-else-if="status === 'failed'">The page could not start.</p>

    <section v-else-if="status === 'signed-out'">
      <form @submit.prevent="signIn">
        <label v-if="authMode === 'local'">
          Local development user
          <input v-model="localUser" pattern="[a-z0-9\-]{1,32}" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </section>

    <section v-else-if="room === undefined">
      <button type="button" @click="createRoom">Create a room</button>
      <form @submit.prevent="openRoom">
        <label>Room ID <input v-model="roomId" required /></label>
        <button type="submit">Open</button>
      </form>
      <p>To be let into someone else's room, give them your user ID shown above.</p>
    </section>

    <section v-else>
      <h2>
        Room <code>{{ room.id }}</code>
      </h2>
      <ul>
        <li v-for="member in room.members" :key="member">
          <code>{{ member }}</code>
          <span v-if="member === room.owner"> (owner)</span>
          <span v-if="room.seated.includes(member)"> has a seat</span>
          <span v-if="present.includes(member)"> and is connected</span>
          <button
            v-if="isOwner && member !== room.owner"
            type="button"
            @click="removeMember(member)"
          >
            Remove
          </button>
        </li>
      </ul>
      <form v-if="isOwner" @submit.prevent="invite">
        <label>User ID to let in <input v-model="invitee" required /></label>
        <button type="submit">Add</button>
      </form>

      <p v-if="view.name === 'connecting'">Connecting…</p>
      <p v-else-if="view.name === 'reconnecting'">Reconnecting…</p>
      <p v-else-if="view.name === 'ended'">{{ view.message }}</p>
      <p v-if="seated && media === 'none'">
        You hold a seat. This API runs with fake meetings, so there is no audio or video to connect
        to.
      </p>

      <button v-if="!seated" type="button" @click="join">Join</button>
      <template v-else>
        <button type="button" @click="leave">Leave</button>
        <template v-if="view.name === 'in-call'">
          <button type="button" @click="toggleMuted">{{ muted ? "Unmute" : "Mute" }}</button>
          <button type="button" @click="toggleCamera">
            {{ camera ? "Camera off" : "Camera on" }}
          </button>
        </template>
      </template>
      <button type="button" @click="refresh">Refresh</button>
      <button v-if="isOwner" type="button" @click="closeRoom">End the call for everyone</button>

      <div class="tiles">
        <figure v-for="tile in tiles" :key="tile.id">
          <!-- playsinline: without it iOS Safari opens the video full screen. -->
          <video
            :ref="(element) => bindTile(tile.id, element)"
            autoplay
            playsinline
            :muted="tile.local"
          />
          <figcaption>{{ tile.local ? "You" : tile.user }}</figcaption>
        </figure>
      </div>
    </section>

    <!-- Everyone else's voices arrive mixed into one stream, played here. -->
    <audio ref="audio" />
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
  line-height: 1.6;
}
main {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1rem;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
label {
  display: block;
  margin: 0.5rem 0;
}
button {
  margin-right: 0.5rem;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.5rem;
  margin-top: 1rem;
}
.tiles figure {
  margin: 0;
}
.tiles video {
  width: 100%;
  background: #000;
}
</style>
