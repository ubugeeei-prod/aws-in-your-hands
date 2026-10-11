<script setup lang="ts">
import { createError, useFetch, useHead } from "nuxt/app";
import { viewerSchema } from "../../core/profile.ts";

// During server rendering, Nuxt passes the incoming Cookie header on to this call.
const { data, error } = await useFetch("/me/api/viewer", {
  transform: (body: unknown) => viewerSchema.parse(body),
});
if (error.value !== undefined || data.value === undefined) {
  throw createError({ statusCode: 502, statusMessage: "Your page could not be loaded" });
}
const viewer = data.value;

useHead({ title: "Your page" });
</script>

<template>
  <h1>Your page</h1>
  <template v-if="viewer.signedIn">
    <p>
      Signed in as <strong>{{ viewer.profile.name }}</strong> since {{ viewer.profile.signedInAt }}.
    </p>
    <form method="post" action="/me/sign-out">
      <button type="submit">Sign out</button>
    </form>
  </template>
  <template v-else-if="viewer.signIn === 'dev'">
    <p>Nobody is signed in. This practice sign-in believes any name you type.</p>
    <form method="post" action="/me/sign-in">
      <label>Name <input name="name" required maxlength="40" autocomplete="off" /></label>
      <button type="submit">Sign in</button>
    </form>
  </template>
  <p v-else>Nobody is signed in, and sign-in is turned off in this deployment.</p>
</template>
