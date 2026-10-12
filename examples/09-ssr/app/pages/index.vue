<script setup lang="ts">
import { createError, useFetch, useHead } from "nuxt/app";

import { noteListSchema } from "../../core/notes.ts";

// On the server this calls the route in the same process. In the browser it is
// an HTTP request, so the answer is checked against the schema either way.
const { data, error } = await useFetch("/api/notes", {
  transform: (body: unknown) => noteListSchema.parse(body),
});
if (error.value !== undefined || data.value === undefined) {
  throw createError({ statusCode: 502, statusMessage: "The notes could not be loaded" });
}
const notes = data.value.notes;

useHead({ title: "Public notes" });
</script>

<template>
  <h1>Public notes</h1>
  <ul>
    <li v-for="note in notes" :key="note.id">
      <NuxtLink :to="`/notes/${note.id}`">{{ note.title }}</NuxtLink>
      <span class="meta"> {{ note.updatedAt.slice(0, 10) }}</span>
    </li>
  </ul>
</template>
