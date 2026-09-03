import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readGlobalStyleManifest(): Promise<string> {
  return readFile(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
}

export async function globalStyleImports(): Promise<string[]> {
  const manifest = await readGlobalStyleManifest();
  return [...manifest.matchAll(/@import\s+["']([^"']+)["']\s*;/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("./"));
}

export async function readGlobalStyles(): Promise<string> {
  const appRoot = path.join(process.cwd(), "src", "app");
  const imports = await globalStyleImports();
  const sources = await Promise.all(
    imports.map((specifier) => readFile(path.resolve(appRoot, specifier), "utf8"))
  );
  return sources.join("\n");
}
