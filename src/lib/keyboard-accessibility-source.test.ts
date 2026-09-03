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

function tagName(
  node: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile
): string {
  return node.tagName.getText(sourceFile);
}

function hasAttribute(node: ts.JsxOpeningLikeElement, name: string): boolean {
  return node.attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === name
  );
}

function literalAttributeValue(
  node: ts.JsxOpeningLikeElement,
  name: string
): string | null {
  const attribute = node.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === name
  );
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) return null;
  return ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null;
}

function hasDescendantTag(
  root: ts.JsxElement,
  expected: string,
  sourceFile: ts.SourceFile
): boolean {
  let found = false;
  function visit(node: ts.Node) {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node, sourceFile) === expected
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  for (const child of root.children) visit(child);
  return found;
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(process.cwd(), sourceFile.fileName).replaceAll("\\", "/")}:${position.line + 1}`;
}

test("dialog surfaces expose titles and descriptions", async () => {
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
      if (ts.isJsxOpeningElement(node)) {
        const name = tagName(node, sourceFile);
        if (
          name === "DialogContent" ||
          name === "DialogInlineContent" ||
          name === "DialogDrawerContent"
        ) {
          const element = node.parent;
          const titled =
            hasAttribute(node, "aria-label") ||
            hasAttribute(node, "aria-labelledby") ||
            (ts.isJsxElement(element) &&
              hasDescendantTag(element, "DialogTitle", sourceFile));
          const described =
            hasAttribute(node, "aria-describedby") ||
            (ts.isJsxElement(element) &&
              hasDescendantTag(element, "DialogDescription", sourceFile));
          if (!titled) {
            violations.push(`${location(sourceFile, node)} <${name}> lacks a title`);
          }
          if (!described) {
            violations.push(`${location(sourceFile, node)} <${name}> lacks a description`);
          }
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(sourceFile);
  }

  assert.deepEqual(violations, []);
});

test("custom role buttons expose keyboard semantics", async () => {
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
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = tagName(node, sourceFile);
        if (name !== "button" && literalAttributeValue(node, "role") === "button") {
          if (!hasAttribute(node, "tabIndex") || !hasAttribute(node, "onKeyDown")) {
            violations.push(
              `${location(sourceFile, node)} custom role button lacks tabIndex/onKeyDown`
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

test("keyboard, focus return, and live-region contracts stay explicit", async () => {
  const dialog = await readFile(
    path.join(process.cwd(), "src/components/ui/dialog.tsx"),
    "utf8"
  );
  const workspace = await readFile(
    path.join(process.cwd(), "src/components/workspace/workspace.tsx"),
    "utf8"
  );
  const creator = (
    await Promise.all(
      ["creator-stage.tsx", "settings-flyout.tsx"].map((file) =>
        readFile(
          path.join(process.cwd(), "src/components/workspace/create", file),
          "utf8"
        )
      )
    )
  ).join("\n");
  const upload = await readFile(
    path.join(process.cwd(), "src/components/workspace/upload-drop-zone.tsx"),
    "utf8"
  );
  const status = await readFile(
    path.join(process.cwd(), "src/components/ui/status-message.tsx"),
    "utf8"
  );
  const loading = await readFile(
    path.join(process.cwd(), "src/components/ui/loading-state.tsx"),
    "utf8"
  );
  const interactiveCanvas = await readFile(
    path.join(process.cwd(), "src/components/workspace/interactive-edit-canvas.tsx"),
    "utf8"
  );
  const audioWave = await readFile(
    path.join(process.cwd(), "src/components/workspace/audio-wave.tsx"),
    "utf8"
  );
  const taskDetails = await readFile(
    path.join(process.cwd(), "src/components/workspace/task-details-drawer.tsx"),
    "utf8"
  );

  assert.match(dialog, /function DialogInlineContent/);
  assert.match(dialog, /function DialogDrawerContent/);
  assert.match(dialog, /DialogPrimitive\.Content/);

  assert.match(workspace, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/);
  assert.match(workspace, /onOpenAutoFocus/);
  assert.match(workspace, /onCloseAutoFocus/);
  assert.match(workspace, /triggerRef\.current\?\.focus\(\)/);
  assert.match(workspace, /aria-haspopup="dialog"/);
  assert.match(workspace, /<DialogClose asChild>/);

  assert.match(creator, /modal=\{false\}/);
  assert.match(creator, /onCloseAutoFocus/);
  assert.match(creator, /triggerRef\.current\?\.focus\(\)/);
  assert.match(creator, /aria-controls=\{settingsPanelId\}/);

  assert.match(upload, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(upload, /event\.preventDefault\(\)/);
  assert.match(upload, /aria-disabled=\{busy\}/);

  assert.match(interactiveCanvas, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Delete"/);
  assert.match(interactiveCanvas, /onKeyDown=\{\(event\) => onResizeKeyDown/);
  assert.match(interactiveCanvas, /居中添加/);
  assert.match(audioWave, /入点（秒）/);
  assert.match(audioWave, /出点（秒）/);
  assert.match(taskDetails, /onCloseAutoFocus/);
  assert.match(taskDetails, /restoreFocusRef\?\.current/);
  assert.match(taskDetails, /target\.focus\(\)/);

  assert.match(status, /aria-atomic="true"/);
  assert.match(loading, /aria-atomic="true"/);
});
