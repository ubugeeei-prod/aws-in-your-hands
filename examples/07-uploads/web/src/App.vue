<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { ApiError, createNotesClient, type NotesClient } from "@aih/example-06-auth/api/src/client.ts";
import type { Note } from "@aih/example-06-auth/api/src/contract.ts";
import { createCognitoProvider } from "@aih/example-06-auth/web/src/auth/cognito.ts";
import { createLocalProvider } from "@aih/example-06-auth/web/src/auth/local.ts";
import type { AuthProvider, Session } from "@aih/example-06-auth/web/src/auth/provider.ts";
import { loadConfig } from "@aih/example-06-auth/web/src/config.ts";
import { parseRoute, pathFor, type Route } from "@aih/example-06-auth/web/src/router/route.ts";
import { type AttachmentsClient, createAttachmentsClient } from "../../api/src/client.ts";
import NoteAttachments from "./NoteAttachments.vue";

// Chapter 06's screen, with the images panel added under the note form.

const status = ref<"starting" | "signed-out" | "signed-in" | "failed">("starting");
const problem = ref("");
const route = ref<Route>(parseRoute(window.location.pathname));
const notes = ref<Note[]>([]);
const nextCursor = ref<string | null>(null);
const editing = ref<Note>();
const title = ref("");
const body = ref("");
const theirs = ref<Note>();
const localUser = ref("alice");
const me = ref("");

// Memory only: not localStorage, not a cookie. An injected script could read
// it while the page is open, but nothing persists for it to find later.
let session: Session | undefined;
let auth: AuthProvider | undefined;
let api: NotesClient | undefined;
// Same token source as `api`. The upload itself goes to the storage service without it.
const attachmentsApi = shallowRef<AttachmentsClient>();

const authMode = computed(() => auth?.mode ?? "local");

function go(next: { name: "list" } | { name: "new" } | { name: "note"; id: string }): void {
  window.history.pushState(null, "", pathFor(next));
  route.value = next;
  void show();
}
window.addEventListener("popstate", () => {
  route.value = parseRoute(window.location.pathname);
  void show();
});

function fail(error: unknown): void {
  if (error instanceof ApiError && error.code === "unauthenticated") {
    // Expired or rejected: forget the token and ask for sign-in again.
    session = undefined;
    status.value = "signed-out";
    problem.value = "Your session has ended. Sign in again.";
    return;
  }
  problem.value =
    error instanceof ApiError ? `${error.message} (request ${error.requestId ?? "unknown"})` : String(error);
}

async function show(): Promise<void> {
  if (api === undefined || status.value !== "signed-in") {
    return;
  }
  problem.value = "";
  theirs.value = undefined;
  try {
    if (route.value.name === "list") {
      const page = await api.list();
      notes.value = page.notes;
      nextCursor.value = page.nextCursor;
    } else if (route.value.name === "note") {
      editing.value = await api.get(route.value.id);
      title.value = editing.value.title;
      body.value = editing.value.body;
    } else if (route.value.name === "new") {
      editing.value = undefined;
      title.value = "";
      body.value = "";
    }
  } catch (error) {
    fail(error);
  }
}

async function more(): Promise<void> {
  if (api === undefined || nextCursor.value === null) {
    return;
  }
  try {
    const page = await api.list({ cursor: nextCursor.value });
    notes.value = [...notes.value, ...page.notes];
    nextCursor.value = page.nextCursor;
  } catch (error) {
    fail(error);
  }
}

async function save(): Promise<void> {
  if (api === undefined) {
    return;
  }
  problem.value = "";
  try {
    if (editing.value === undefined) {
      await api.create({ title: title.value, body: body.value });
      go({ name: "list" });
      return;
    }
    const outcome = await api.update(editing.value.id, {
      title: title.value,
      body: body.value,
      expectedVersion: editing.value.version,
    });
    if (outcome.status === "updated") {
      go({ name: "list" });
    } else {
      // Someone saved first, and nothing of ours was written. Show both and
      // let the user decide.
      theirs.value = outcome.current;
    }
  } catch (error) {
    fail(error);
  }
}

function keepMine(): void {
  // The next save builds on the stored version. The text boxes keep the user's text.
  editing.value = theirs.value;
  theirs.value = undefined;
}

function takeTheirs(): void {
  if (theirs.value !== undefined) {
    editing.value = theirs.value;
    title.value = theirs.value.title;
    body.value = theirs.value.body;
    theirs.value = undefined;
  }
}

async function remove(): Promise<void> {
  if (api === undefined || editing.value === undefined) {
    return;
  }
  try {
    await api.remove(editing.value.id);
    go({ name: "list" });
  } catch (error) {
    fail(error);
  }
}

async function signedIn(next: Session): Promise<void> {
  session = next;
  status.value = "signed-in";
  me.value = (await api?.me())?.sub ?? "";
  await show();
}

async function signIn(): Promise<void> {
  problem.value = "";
  try {
    const next = await auth?.signIn(localUser.value);
    if (next !== undefined) {
      await signedIn(next);
    }
  } catch (error) {
    fail(error);
  }
}

function signOut(): void {
  session = undefined;
  notes.value = [];
  status.value = "signed-out";
  const url = auth?.signOutUrl();
  if (url !== undefined) {
    window.location.assign(url);
  }
}

onMounted(async () => {
  try {
    const config = await loadConfig();
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
    api = createNotesClient(config.apiUrl, () => session?.accessToken);
    attachmentsApi.value = createAttachmentsClient(config.apiUrl, () => session?.accessToken);

    const returned = await auth.completeSignIn(new URL(window.location.href));
    if (route.value.name === "callback") {
      // Take the code out of the address bar and the history entry.
      window.history.replaceState(null, "", "/");
      route.value = { name: "list" };
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
</script>

<template>
  <main>
    <header>
      <h1><a href="/" @click.prevent="go({ name: 'list' })">Notes</a></h1>
      <span v-if="status === 'signed-in'">
        <code>{{ me }}</code>
        <button type="button" @click="signOut">Sign out</button>
      </span>
    </header>

    <p v-if="problem !== ''" role="alert">{{ problem }}</p>

    <section v-if="status === 'starting'"><p>Starting…</p></section>

    <section v-else-if="status === 'failed'"><p>The app could not start.</p></section>

    <section v-else-if="status === 'signed-out'">
      <form @submit.prevent="signIn">
        <label v-if="authMode === 'local'">
          Local development user
          <input v-model="localUser" pattern="[a-z0-9\-]{1,32}" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
      <p v-if="authMode === 'local'">Local sign-in asks for no password. It is not available in a deployment.</p>
    </section>

    <section v-else-if="route.name === 'list'">
      <p><a href="/notes/new" @click.prevent="go({ name: 'new' })">New note</a></p>
      <p v-if="notes.length === 0">No notes yet.</p>
      <ul>
        <li v-for="note in notes" :key="note.id">
          <a :href="pathFor({ name: 'note', id: note.id })" @click.prevent="go({ name: 'note', id: note.id })">{{
            note.title
          }}</a>
          <time :datetime="note.updatedAt">{{ new Date(note.updatedAt).toLocaleString() }}</time>
        </li>
      </ul>
      <button v-if="nextCursor !== null" type="button" @click="more">More</button>
    </section>

    <section v-else-if="route.name === 'new' || route.name === 'note'">
      <form @submit.prevent="save">
        <label>Title <input v-model="title" maxlength="120" required /></label>
        <label>Body <textarea v-model="body" rows="10" maxlength="10000" /></label>
        <button type="submit" :disabled="theirs !== undefined">Save</button>
        <button v-if="editing !== undefined" type="button" @click="remove">Delete</button>
      </form>

      <aside v-if="theirs !== undefined" role="alert">
        <h2>This note was changed somewhere else</h2>
        <p>Your text is still in the form above and has not been saved. The saved note now reads:</p>
        <blockquote>
          <strong>{{ theirs.title }}</strong>
          <pre>{{ theirs.body }}</pre>
        </blockquote>
        <button type="button" @click="keepMine">Keep my text and save over it</button>
        <button type="button" @click="takeTheirs">Discard my text and use the saved note</button>
      </aside>

      <NoteAttachments
        v-if="editing !== undefined && attachmentsApi !== undefined"
        :note-id="editing.id"
        :api="attachmentsApi"
        @failed="fail"
      />
    </section>

    <section v-else>
      <h2>Not found</h2>
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
  line-height: 1.6;
}
main {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem;
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
ul {
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}
label {
  display: grid;
  gap: 0.25rem;
  margin-bottom: 1rem;
}
input,
textarea,
button {
  font: inherit;
  padding: 0.5rem;
}
button + button,
code + button {
  margin-left: 0.5rem;
}
aside {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid currentColor;
}
pre {
  white-space: pre-wrap;
}
</style>
