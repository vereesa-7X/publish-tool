import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_ROOT = path.join(process.cwd(), ".demo-data");

function resolvePath(segments: string[]): string {
  return path.join(DATA_ROOT, ...segments);
}

export async function readJsonFile<T>(
  segments: string[],
  fallback: () => T
): Promise<T> {
  const filePath = resolvePath(segments);

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      const value = fallback();
      await writeJsonFile(segments, value);
      return value;
    }

    throw error;
  }
}

export async function writeJsonFile<T>(
  segments: string[],
  value: T
): Promise<void> {
  const filePath = resolvePath(segments);
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tempPath, filePath);
}
