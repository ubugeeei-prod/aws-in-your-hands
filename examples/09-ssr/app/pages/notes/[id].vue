<script setup lang="ts">
import { createError, useFetch, useHead, useRoute } from "nuxt/app";
import * as v from "valibot";

import { publicNoteSchema } from "../../../core/notes.ts";

const route = useRoute();
const id = String(route.params["id"]);

const { data, error } = await useFetch(`/api/notes/${encodeURIComponent(id)}`, {
  transform: (body: unknown) => v.parse(publicNoteSchema, body),
});
if (error.value !== undefined || data.value === undefined) {
  // A real 404 status, so that neither a browser nor a cache takes this for the note.
  throw createError({ statusCode: 404, statusMessage: "Note not found", fatal: true });
}
const note = data.value;

useHead({ title: note.title });
</script>

<template>
  <article>
    <h1>{{ note.title }}</h1>
    <p class="meta">Updated {{ note.updatedAt.slice(0, 10) }}</p>
    <p>{{ note.body }}</p>
  </article>
</template>
