<script setup lang="ts">
import { ApiError } from "@aih/example-06-auth/api/src/client.ts";
import { ref, watch } from "vue";
import { type AttachmentsClient, UploadError } from "../../api/src/client.ts";
import { type AttachmentView, IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../../api/src/contract.ts";
import { checkFile } from "./check-file.ts";

const props = defineProps<{ noteId: string; api: AttachmentsClient }>();
const emit = defineEmits<{ failed: [error: unknown] }>();

const items = ref<AttachmentView[]>([]);
const problem = ref("");
const busy = ref(false);
// A view URL lasts five minutes. When an image stops loading, fresh URLs are
// fetched once; if that does not help, the image really is gone.
let refreshedAfterError = false;

async function load(): Promise<void> {
  try {
    items.value = await props.api.list(props.noteId);
  } catch (error) {
    emit("failed", error);
  }
}

async function add(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) {
    return;
  }
  problem.value = "";
  // A courtesy to the user, not a control: the storage service enforces the same limits.
  const checked = checkFile({ type: file.type, size: file.size });
  if (!checked.ok) {
    problem.value = checked.message;
    return;
  }
  busy.value = true;
  try {
    await props.api.attach(props.noteId, file, checked.contentType);
    refreshedAfterError = false;
    await load();
  } catch (error) {
    if (error instanceof UploadError) {
      problem.value = `The upload was refused (HTTP ${error.status}). Nothing was attached.`;
    } else if (error instanceof ApiError && error.code !== "unauthenticated") {
      problem.value = `${error.message} Nothing was attached.`;
    } else {
      emit("failed", error);
    }
  } finally {
    busy.value = false;
  }
}

async function remove(id: string): Promise<void> {
  try {
    await props.api.remove(props.noteId, id);
    await load();
  } catch (error) {
    emit("failed", error);
  }
}

function imageFailed(): void {
  if (!refreshedAfterError) {
    refreshedAfterError = true;
    void load();
  }
}

watch(() => props.noteId, load, { immediate: true });
</script>

<template>
  <section>
    <h2>Images</h2>
    <p v-if="problem !== ''" role="alert">{{ problem }}</p>
    <label>
      Add an image (PNG, JPEG, WebP or GIF, up to {{ MAX_UPLOAD_BYTES / 1024 / 1024 }} MB)
      <input type="file" :accept="IMAGE_TYPES.join(',')" :disabled="busy" @change="add" />
    </label>
    <p v-if="busy">Uploading…</p>
    <p v-if="items.length === 0 && !busy">No images yet.</p>
    <ul>
      <li v-for="item in items" :key="item.id">
        <img :src="item.url" :alt="`Attached image ${item.id}`" @error="imageFailed" />
        <span>{{ Math.ceil(item.size / 1024) }} KB</span>
        <button type="button" @click="remove(item.id)">Remove</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
img {
  max-width: 12rem;
  max-height: 12rem;
}
</style>
