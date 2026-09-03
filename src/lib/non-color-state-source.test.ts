import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

async function listTsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTsxFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".tsx") ? [entryPath] : [];
    })
  );
  return nested.flat();
}

function hasAttribute(node: ts.JsxOpeningLikeElement, name: string): boolean {
  return node.attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === name
  );
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(process.cwd(), sourceFile.fileName).replaceAll("\\", "/")}:${position.line + 1}`;
}

test("ON/OFF toggle buttons expose their pressed state", async () => {
  const files = await listTsxFiles(path.join(process.cwd(), "src"));
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    function inspect(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "button") {
        const text = node.getText(sourceFile);
        if (text.includes('"ON"') && text.includes('"OFF"')) {
          if (!hasAttribute(node.openingElement, "aria-pressed")) {
            violations.push(
              `${location(sourceFile, node.openingElement)} ON/OFF button lacks aria-pressed`
            );
          }
        }
      }
      ts.forEachChild(node, inspect);
    }

    inspect(sourceFile);
  }

  assert.deepEqual(violations, []);
});

test("selected choices use a visible non-color marker", async () => {
  const indicator = await readFile(
    path.join(process.cwd(), "src/components/ui/selection-indicator.tsx"),
    "utf8"
  );
  const dashboard = await readFile(
    path.join(process.cwd(), "src/app/dashboard/dashboard-client.tsx"),
    "utf8"
  );
  const projects = await readFile(
    path.join(process.cwd(), "src/app/projects/projects-client.tsx"),
    "utf8"
  );
  const workspace = await readFile(
    path.join(process.cwd(), "src/components/workspace/workspace.tsx"),
    "utf8"
  );
  const creator = (
    await Promise.all(
      ["video-creator.tsx", "music-creator.tsx"].map((file) =>
        readFile(
          path.join(process.cwd(), "src/components/workspace/create", file),
          "utf8"
        )
      )
    )
  ).join("\n");
  const canvas = await readFile(
    path.join(process.cwd(), "src/components/workspace/interactive-edit-canvas.tsx"),
    "utf8"
  );
  const mention = await readFile(
    path.join(process.cwd(), "src/components/workspace/mention-textarea.tsx"),
    "utf8"
  );

  assert.match(indicator, /data-selection-indicator/);
  assert.match(indicator, /data-selected=\{selected \? "true" : "false"\}/);
  assert.match(indicator, /<Check /);

  assert.match(dashboard, /SelectionIndicator selected=\{days === r\.days\}/);
  assert.match(dashboard, /aria-pressed=\{tab === "project"\}/);
  assert.match(projects, /SelectionIndicator[\s\S]*?visibility === "private"/);
  assert.match(workspace, /SelectionIndicator[\s\S]*?section === value/);
  assert.match(creator, /aria-pressed=\{extensionDirection === value\}/);
  assert.match(creator, /SelectionIndicator selected=\{mode === value\}/);
  assert.match(canvas, /aria-pressed=\{mode === "move"\}/);
  assert.match(canvas, /interactive-edit-selection-badge/);
  assert.match(mention, /SelectionIndicator selected=\{i === active\}/);
});

test("success, failure, review, and read-only states include text and icons", async () => {
  const dashboard = await readFile(
    path.join(process.cwd(), "src/app/dashboard/dashboard-client.tsx"),
    "utf8"
  );
  const assets = await readFile(
    path.join(process.cwd(), "src/components/workspace/assets-tab.tsx"),
    "utf8"
  );
  const workspace = await readFile(
    path.join(process.cwd(), "src/components/workspace/workspace.tsx"),
    "utf8"
  );

  assert.match(dashboard, /<CircleCheck/);
  assert.match(dashboard, /<CircleAlert/);
  assert.match(dashboard, /ok \? "成功" : skipped \? "已跳过" : "失败"/);

  assert.match(assets, /<CheckCircle2 \/> 采用/);
  assert.match(assets, /<XCircle \/> 废弃/);
  assert.match(assets, /aria-pressed=\{status === "approved"\}/);
  assert.match(assets, /aria-pressed=\{status === "rejected"\}/);

  assert.match(workspace, /data-read-only-notice/);
  assert.match(workspace, /<Eye className="size-4 shrink-0" \/>/);
  assert.match(workspace, /<strong>只读浏览<\/strong>/);
});
