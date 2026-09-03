import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const CUSTOM_CONTROLS = new Set(["Input", "Textarea", "SelectTrigger"]);
const NATIVE_CONTROLS = new Set(["input", "textarea", "select"]);
const ACCESSIBLE_NAME_ATTRIBUTES = ["aria-label", "aria-labelledby"];

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

function attributes(node: ts.JsxOpeningLikeElement): Map<string, ts.JsxAttribute> {
  const result = new Map<string, ts.JsxAttribute>();
  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property)) {
      result.set(property.name.getText(), property);
    }
  }
  return result;
}

function attributeReference(
  attribute: ts.JsxAttribute | undefined,
  sourceFile: ts.SourceFile
): string | null {
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) {
    return `literal:${attribute.initializer.text}`;
  }
  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
    return `expression:${attribute.initializer.expression.getText(sourceFile)}`;
  }
  return null;
}

function isWrappedByLabel(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && current !== sourceFile) {
    if (
      ts.isJsxElement(current) &&
      tagName(current.openingElement, sourceFile) === "label"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function location(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(process.cwd(), sourceFile.fileName).replaceAll("\\", "/")}:${position.line + 1}`;
}

test("form controls expose labels or accessible names", async () => {
  const files = await listTsxFiles(path.join(process.cwd(), "src"));
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relativeFile = path.relative(process.cwd(), file).replaceAll("\\", "/");
    const isSharedPrimitive =
      relativeFile === "src/components/ui/input.tsx" ||
      relativeFile === "src/components/ui/textarea.tsx";
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const labelTargets = new Set<string>();

    function collectLabelTargets(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = tagName(node, sourceFile);
        if (name === "Label" || name === "label") {
          const target = attributeReference(attributes(node).get("htmlFor"), sourceFile);
          if (target) labelTargets.add(target);
        }
      }
      ts.forEachChild(node, collectLabelTargets);
    }
    collectLabelTargets(sourceFile);

    function inspect(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = tagName(node, sourceFile);
        const props = attributes(node);
        const hasAccessibleName = ACCESSIBLE_NAME_ATTRIBUTES.some((attribute) =>
          props.has(attribute)
        );
        const id = attributeReference(props.get("id"), sourceFile);
        const hasAssociatedLabel = id !== null && labelTargets.has(id);

        if (CUSTOM_CONTROLS.has(name) && !hasAccessibleName && !hasAssociatedLabel) {
          violations.push(`${location(sourceFile, node)} <${name}> lacks an accessible name`);
        }

        if (
          NATIVE_CONTROLS.has(name) &&
          !isSharedPrimitive &&
          !hasAccessibleName &&
          !hasAssociatedLabel &&
          !isWrappedByLabel(node, sourceFile)
        ) {
          violations.push(`${location(sourceFile, node)} <${name}> lacks an accessible name`);
        }

        if (props.has("contentEditable") && props.has("role") && !hasAccessibleName) {
          violations.push(
            `${location(sourceFile, node)} contentEditable textbox lacks an accessible name`
          );
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(sourceFile);
  }

  assert.deepEqual(violations, []);
});

test("shared form primitives keep the compile-time accessible-name contract", async () => {
  for (const relativePath of [
    "src/components/ui/input.tsx",
    "src/components/ui/textarea.tsx",
    "src/components/ui/select.tsx",
  ]) {
    const source = await readFile(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, /AccessibleControlName/);
  }

  const modelSelect = await readFile(
    path.join(process.cwd(), "src/components/workspace/model-select.tsx"),
    "utf8"
  );
  assert.match(modelSelect, /ariaLabel: string/);
  assert.match(modelSelect, /aria-label=\{ariaLabel\}/);

  const mentionTextarea = await readFile(
    path.join(process.cwd(), "src/components/workspace/mention-textarea.tsx"),
    "utf8"
  );
  assert.match(mentionTextarea, /ariaLabel: string/);
  assert.match(mentionTextarea, /aria-label=\{ariaLabel\}/);
});
