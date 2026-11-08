import path from 'node:path';
import ts from 'typescript';

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const directive = (source, name) => {
  const first = source.statements[0];
  return first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)
    && first.expression.text === `use ${name}`;
};
const privateCredentialMarker = /\bSUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)\b/;

function referencesPrivateCredential(source) {
  // The scanner skips both line and block comments while preserving the old
  // conservative check for credential names in executable tokens and strings.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (privateCredentialMarker.test(scanner.getTokenText())) return true;
  }
  return false;
}

export function assertRlsDeclarations(sources) {
  const states = new Map();
  for (const [filename, raw] of sources) {
    const source = withoutComments(raw).replace(/--[^\r\n]*/g, '');
    if (/\bdrop\s+table\b/i.test(source)) throw new Error('DROP TABLE requires explicit RLS guard support before this schema change can pass.');
    // Reject unqualified names instead of guessing the active SQL search_path.
    const declarations = /\b(?:create\s+(?:(?:unlogged|temporary|temp)\s+)?table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?)("[^"]+"|[a-z_][a-z0-9_]*)(\s*\.)?/gi;
    for (const match of source.matchAll(declarations)) {
      if (!match[2]) throw new Error(`Unqualified table ${match[1]} in ${filename}; schema qualification is required by the RLS guard.`);
    }
    // CREATE TABLE AS does not have a column-list parenthesis. Private
    // singleton tables also need RLS, even when they have no tenant_id column.
    const operations = /\b(create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?)(public|private|"public"|"private")\s*\.\s*"?([a-z_][a-z0-9_]*)"?\s*(\(|as\b|enable\s+row\s+level\s+security|disable\s+row\s+level\s+security)/gi;
    for (const match of source.matchAll(operations)) {
      const table = `${match[2].replaceAll('"', '').toLowerCase()}.${match[3].toLowerCase()}`;
      if (match[1].toLowerCase().startsWith('create')) {
        if (!/if\s+not\s+exists/i.test(match[1]) || !states.has(table)) states.set(table, { enabled: false, filename });
      } else {
        states.set(table, { enabled: /^enable/i.test(match[4]), filename });
      }
    }
  }
  if (states.size === 0) throw new Error('No application table declarations found.');
  const missing = [...states].filter(([, state]) => !state.enabled);
  if (missing.length) throw new Error(`Application tables without RLS enabled: ${missing.map(([table, state]) => `${table} (${state.filename})`).join(', ')}`);
  return [...states.keys()].sort();
}

export function assertClientBoundaries(sources) {
  const parsed = new Map();
  function parse(filename) {
    if (!parsed.has(filename)) {
      const extension = path.posix.extname(filename);
      const kind = extension === '.tsx' ? ts.ScriptKind.TSX
        : extension === '.jsx' ? ts.ScriptKind.JSX
          : extension === '.js' || extension === '.mjs' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      const source = ts.createSourceFile(filename, sources.get(filename), ts.ScriptTarget.Latest, true, kind);
      if (source.parseDiagnostics.length) throw new Error(`Cannot inspect client source ${filename}: syntax error`);
      parsed.set(filename, source);
    }
    return parsed.get(filename);
  }
  function resolve(from, specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
    const base = specifier.startsWith('@/') ? specifier.slice(2) : path.posix.join(path.posix.dirname(from), specifier);
    const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map(ext => base + ext), ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map(ext => `${base}/index${ext}`)];
    if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
    const found = candidates.find(candidate => sources.has(candidate));
    if (!found) throw new Error(`Unresolved local client import ${specifier} from ${from}; update the boundary resolver.`);
    return found;
  }
  function visit(filename, chain, seen) {
    if (seen.has(filename)) return;
    seen.add(filename);
    const raw = sources.get(filename);
    const source = parse(filename);
    if (directive(source, 'server')) return; // Next.js serializes calls to explicit server actions.
    const next = [...chain, filename];
    if (filename === 'lib/supabase/admin.ts' || referencesPrivateCredential(raw)) {
      throw new Error(`Private Supabase credentials reachable from client: ${next.join(' -> ')}`);
    }
    function follow(specifier) {
      const target = resolve(filename, specifier);
      if (target) visit(target, next, seen);
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`Nonliteral client import requires security review: ${filename}`);
        follow(node.moduleSpecifier.text);
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const argument = node.moduleReference.expression;
        if (!argument || !ts.isStringLiteral(argument)) throw new Error(`Nonliteral client import requires security review: ${filename}`);
        follow(argument.text);
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
        const isRequireProperty = ts.isPropertyAccessExpression(callee) && callee.name.text === 'require'
          && ts.isIdentifier(callee.expression) && ['module', 'globalThis'].includes(callee.expression.text);
        const isRequireElement = ts.isElementAccessExpression(callee)
          && ts.isIdentifier(callee.expression) && ['module', 'globalThis'].includes(callee.expression.text)
          && ts.isStringLiteralLike(callee.argumentExpression) && callee.argumentExpression.text === 'require';
        if (callee.kind === ts.SyntaxKind.ImportKeyword || isRequire || isRequireProperty || isRequireElement) {
          const argument = node.arguments[0];
          if (node.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) {
            throw new Error(`Nonliteral client import requires security review: ${filename}`);
          }
          follow(argument.text);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  for (const filename of sources.keys()) if (directive(parse(filename), 'client')) visit(filename, [], new Set());
}

// Adding a privileged client call site requires an explicit security review.
// The approved paths either validate the owner, verify a Stripe signature, or
// call a server-side RPC that validates public booking inputs in PostgreSQL.
export function assertTrustedAdminClientUsage(sources, approvedPaths) {
  for (const filename of approvedPaths) {
    if (!sources.has(filename)) throw new Error(`Approved privileged client path is missing: ${filename}`);
  }
  for (const [filename, raw] of sources) {
    if (filename === 'lib/supabase/admin.ts') continue;
    const source = withoutComments(raw);
    if (/\bcreateAdminClient\b|\bSUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)\b|["'](?:@\/lib\/supabase\/admin|[^"']*\/supabase\/admin)(?:\.[cm]?[jt]s)?["']/.test(source)
        && !approvedPaths.has(filename)) {
      throw new Error(`Unreviewed privileged Supabase client use: ${filename}`);
    }
  }
}
