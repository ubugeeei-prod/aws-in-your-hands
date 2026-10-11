import vize from "@vizejs/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [vize()],
  server: { port: 5183, strictPort: true },
  preview: { port: 4183, strictPort: true },
  build: { outDir: "dist" },
});
