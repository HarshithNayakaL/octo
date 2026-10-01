import { mkdir, readFile, rename, writeFile, access } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/** Key/value storage for immutable files such as cached provider outputs. */
export interface BlobCache {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Buffer>;
  put(key: string, bytes: Buffer): Promise<void>;
}
const safeKey = (root: string, key: string) => {
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error("Invalid storage key");
  return path;
};
/** Files on local disk; atomic rename keeps a partially written file invisible. */
export function directoryCache(root: string): BlobCache {
  return {
    async has(key) {
      try {
        await access(safeKey(root, key));
        return true;
      } catch {
        return false;
      }
    },
    get: (key) => readFile(safeKey(root, key)),
    async put(key, bytes) {
      const path = safeKey(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path + ".tmp", bytes);
      await rename(path + ".tmp", path);
    },
  };
}
