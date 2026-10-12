import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

import type { FileOps } from "./file-notes.ts";

// #region node-files
/** The real file system. `sync()` is what makes "written" mean "on the volume". */
export const nodeFiles: FileOps = {
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  },
  async writeDurably(path, content) {
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, "w", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
  },
  rename,
  async syncDirectory(path) {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  },
};
// #endregion node-files
