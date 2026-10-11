import vize from "@vizejs/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Vize compiles the .vue files; it takes the place of @vitejs/plugin-vue.
  plugins: [vize()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: "dist" },
});
