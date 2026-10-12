import { mkdir, readdir, unlink } from "node:fs/promises";

import { nodeFiles } from "@aih/example-23-ec2/src/node-files.ts";

import type { DirOps } from "./note-files.ts";

const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

// #region node-dir
/** The real file system: chapter 23's operations, and three more from node:fs. */
export const nodeDir: DirOps = {
  ...nodeFiles,
  async ensureDirectory(path) {
    await mkdir(path, { recursive: true });
  },
  async list(directory) {
    try {
      return await readdir(directory);
    } catch (error) {
      if (missing(error)) {
        return [];
      }
      throw error;
    }
  },
  async remove(path) {
    try {
      await unlink(path);
      return true;
    } catch (error) {
      if (missing(error)) {
        return false;
      }
      throw error;
    }
  },
};
// #endregion node-dir
