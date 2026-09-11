import path from 'node:path';

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const directive = (source, name) => new RegExp(`^\\s*['"]use ${name}['"]\\s*;?`).test(withoutComments(source));

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
    const operations = /\b(create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?)(?:public|"public")\s*\.\s*"?([a-z_][a-z0-9_]*)"?\s*(\(|enable\s+row\s+level\s+security|disable\s+row\s+level\s+security)/gi;
    for (const match of source.matchAll(operations)) {
      const table = match[2].toLowerCase();
      if (match[1].toLowerCase().startsWith('create')) {
        if (!/if\s+not\s+exists/i.test(match[1]) || !states.has(table)) states.set(table, { enabled: false, filename });
      } else {
        states.set(table, { enabled: /^enable/i.test(match[3]), filename });
      }
    }
  }
  if (states.size === 0) throw new Error('No public table declarations found.');
  const missing = [...states].filter(([, state]) => !state.enabled);
  if (missing.length) throw new Error(`Public tables without RLS enabled: ${missing.map(([table, state]) => `${table} (${state.filename})`).join(', ')}`);
  return [...states.keys()].sort();
}

export function assertClientBoundaries(sources) {
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
    if (directive(raw, 'server')) return; // Next.js serializes calls to explicit server actions.
    const source = withoutComments(raw);
    const next = [...chain, filename];
    if (filename === 'lib/supabase/admin.ts' || /SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/.test(source)) {
      throw new Error(`Private Supabase credentials reachable from client: ${next.join(' -> ')}`);
    }
    const imports = [
      ...source.matchAll(/\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["']([^"']+)["']/g),
      ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g),
    ];
    for (const match of imports) {
      const target = resolve(filename, match[1]);
      if (target) visit(target, next, seen);
    }
  }
  for (const [filename, source] of sources) if (directive(source, 'client')) visit(filename, [], new Set());
}
