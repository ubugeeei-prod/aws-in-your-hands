<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { Note } from "./notes/note.ts";
import { createLocalNoteStore } from "./notes/store.ts";
import { useRoute } from "./router/use-route.ts";

const store = createLocalNoteStore({
  storage: window.localStorage,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
});

const { route, navigate } = useRoute();
const notes = ref<Note[]>(store.list());
const title = ref("");
const body = ref("");
const error = ref("");

const editing = computed(() =>
  route.value.name === "note" ? store.get(route.value.id) : undefined,
);

watch(
  route,
  () => {
    title.value = editing.value?.title ?? "";
    body.value = editing.value?.body ?? "";
    error.value = "";
  },
  { immediate: true },
);

function save(): void {
  try {
    store.save({ title: title.value, body: body.value }, editing.value?.id);
  } catch {
    error.value = "A note needs a title of 1 to 120 characters.";
    return;
  }
  notes.value = store.list();
  navigate({ name: "list" });
}

function remove(id: string): void {
  store.remove(id);
  notes.value = store.list();
  navigate({ name: "list" });
}
</script>

<template>
  <main>
    <header>
      <h1><a href="/" @click.prevent="navigate({ name: 'list' })">Notes</a></h1>
      <a href="/notes/new" @click.prevent="navigate({ name: 'new' })">New note</a>
    </header>

    <section v-if="route.name === 'list'">
      <p v-if="notes.length === 0">No notes yet. They are kept in this browser only.</p>
      <ul>
        <li v-for="note in notes" :key="note.id">
          <a
            :href="`/notes/${encodeURIComponent(note.id)}`"
            @click.prevent="navigate({ name: 'note', id: note.id })"
          >
            {{ note.title }}
          </a>
          <time :datetime="note.updatedAt">{{ new Date(note.updatedAt).toLocaleString() }}</time>
        </li>
      </ul>
    </section>

    <section v-else-if="route.name === 'new' || editing !== undefined">
      <form @submit.prevent="save">
        <label>Title <input v-model="title" maxlength="120" required /></label>
        <label>Body <textarea v-model="body" rows="10" maxlength="10000" /></label>
        <p v-if="error !== ''" role="alert">{{ error }}</p>
        <button type="submit">Save</button>
        <button v-if="editing !== undefined" type="button" @click="remove(editing.id)">
          Delete
        </button>
      </form>
    </section>

    <section v-else>
      <h2>Not found</h2>
      <p>
        There is no page or note at
        <code>{{ route.name === "not-found" ? route.path : "this address" }}</code
        >.
      </p>
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
button + button {
  margin-left: 0.5rem;
}
</style>
