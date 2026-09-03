import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const target = path.resolve(workspace, ".e2e");
if (path.dirname(target) !== workspace) {
  throw new Error(`Refusing to clean unexpected E2E directory: ${target}`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
