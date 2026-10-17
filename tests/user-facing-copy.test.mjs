import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const authoredCopy = /\u2014|&mdash;|&#0*8212;|&#x0*2014;/iu;

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(location));
    else if (/\.(?:ts|tsx|js|jsx|css|json)$/.test(entry.name)) files.push(location);
  }
  return files;
}

function violationsInCode(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations = [];
  function visit(node) {
    if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) ||
      node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle || node.kind === ts.SyntaxKind.TemplateTail
    ) {
      if (authoredCopy.test(node.text)) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        violations.push(`${path.relative(root, filename)}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}

test("copy guard catches authored punctuation without rejecting comments or dynamic customer text", () => {
  const sample = `// Older copy used ${String.fromCodePoint(0x2014)} here.\nconst label = "Price\\u2014now";\nconst customerText = record.text;`;
  assert.deepEqual(violationsInCode(sample, path.join(root, "app", "sample.ts")), ["app/sample.ts:2"]);
  assert.deepEqual(violationsInCode("const label = <p>&mdash;</p>;", path.join(root, "app", "sample.tsx")), ["app/sample.tsx:1"]);
});

test("product-authored app copy contains no em dash", async () => {
  const violations = [];
  for (const directory of ["app", "components", "lib"]) {
    for (const filename of await sourceFiles(path.join(root, directory))) {
      const source = await readFile(filename, "utf8");
      if (/\.(?:ts|tsx|js|jsx)$/.test(filename)) violations.push(...violationsInCode(source, filename));
      if (filename.endsWith(".css")) {
        const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
        for (const match of withoutComments.matchAll(/\bcontent\s*:\s*([^;}]+)/gi)) {
          if (authoredCopy.test(match[1])) violations.push(path.relative(root, filename));
        }
      }
      if (filename.endsWith(".json") && authoredCopy.test(JSON.stringify(JSON.parse(source)))) violations.push(path.relative(root, filename));
    }
  }
  assert.deepEqual(violations, [], `Product-authored copy contains an em dash: ${violations.join(", ")}`);
});
