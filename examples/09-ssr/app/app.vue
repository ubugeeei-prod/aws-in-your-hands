<template>
  <header class="bar">
    <NuxtLink to="/">Public notes</NuxtLink>
    <NuxtLink to="/me">Your page</NuxtLink>
  </header>
  <main class="page">
    <NuxtPage />
  </main>
</template>

<style>
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  line-height: 1.6;
  color: #1c1917;
  background: #fafaf9;
}
.bar {
  display: flex;
  gap: 1.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #d6d3d1;
}
.page {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1rem;
}
.meta {
  color: #57534e;
  font-size: 0.875rem;
}
</style>
