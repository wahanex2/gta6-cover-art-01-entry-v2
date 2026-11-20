// main.ts — Vice Light Studio entrypoint (Node 22, standard library only).
//
// Copies app/ and screenshots/ beside this file into the output directory
// ($MAKEFUN_OUTPUT_DIR, or /output) and writes /output/dossier.json, the
// summary the judge reads. The dossier is built by the code in this file
// alone: a from-scratch implementation of the makefun/dossier/v1 contract
// (canonical JSON, "## App" block, sources in import order, screenshots
// with sha256 + base64, caps enforced). No vendor code is imported.
//
// Run it:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'makefun/dossier/v1';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

const INDEX_HTML_MAX_BYTES = 1024 * 1024;
const SOURCE_EXTS = new Set(['html', 'js', 'mjs', 'css', 'glsl', 'vert', 'frag', 'wgsl', 'json']);

class DossierError extends Error {
  readonly limit: string;
  constructor(limit: string, message: string) {
    super(message);
    this.name = 'DossierError';
    this.limit = limit;
  }
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

const utf8 = new TextDecoder('utf-8');
function decode(bytes: Buffer): string {
  return utf8.decode(bytes);
}

function lineCount(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) n++;
  return n + (bytes[bytes.length - 1] === 0x0a ? 0 : 1);
}

function fenceFor(text: string): string {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function languageOf(path: string): string {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  if (ext === 'js' || ext === 'mjs') return 'js';
  if (ext === 'glsl' || ext === 'vert' || ext === 'frag') return 'glsl';
  if (ext === 'wgsl') return 'wgsl';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  return 'text';
}

// Canonical JSON: object keys sorted by code unit, no spaces.
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DossierError('bad_value', 'cannot encode a non-finite number');
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => byCodeUnit(a, b));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  }
  throw new DossierError('bad_value', `cannot encode a ${typeof value}`);
}

type FileKind = 'source' | 'vendored' | 'asset';

function classify(rel: string): FileKind {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (parts.includes('vendor') || base.includes('.min.')) return 'vendored';
  const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '';
  if (SOURCE_EXTS.has(ext)) return 'source';
  return 'asset';
}

interface AppFile {
  path: string;
  bytes: number;
  kind: FileKind;
}

interface AppTree {
  files: AppFile[];
  count: number;
  totalBytes: number;
}

function walkApp(appDir: string): AppTree {
  const files: AppFile[] = [];
  let count = 0;
  let totalBytes = 0;
  const stack: string[] = [appDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        count++;
        stack.push(full);
      } else if (ent.isFile()) {
        count++;
        const size = statSync(full).size;
        totalBytes += size;
        if (totalBytes > CAPS.app_max_bytes) {
          throw new DossierError('app_max_bytes', `app/ holds ${totalBytes} bytes, over the ${CAPS.app_max_bytes} cap`);
        }
        const rel = relative(appDir, full).split(sep).join('/');
        if (byteLength(rel) > CAPS.app_path_max_bytes) {
          throw new DossierError('app_path_max_bytes', `app path ${rel} is over ${CAPS.app_path_max_bytes} bytes`);
        }
        files.push({ path: rel, bytes: size, kind: classify(rel) });
      } else {
        throw new DossierError('unsupported_entry', `${full} is not a file or directory`);
      }
    }
  }
  if (count > CAPS.app_max_files) {
    throw new DossierError('app_max_files', `app/ holds ${count} entries, over the ${CAPS.app_max_files} cap`);
  }
  files.sort((a, b) => byCodeUnit(a.path, b.path));
  return { files, count, totalBytes };
}

// ---- index.html scanning ----

interface HtmlScript {
  type: string;
  src: string | null;
  text: string | null;
}

interface HtmlFacts {
  scripts: HtmlScript[];
  importMaps: unknown[];
}

function tagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function attributesOf(s: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '/') {
      i++;
      continue;
    }
    const start = i;
    while (i < s.length && !/[\s=/>]/.test(s[i])) i++;
    const name = s.slice(start, i).toLowerCase();
    if (name === '') {
      i++;
      continue;
    }
    while (i < s.length && /\s/.test(s[i])) i++;
    let value = '';
    if (s[i] === '=') {
      i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        i++;
        const end = s.indexOf(q, i);
        if (end === -1) {
          value = s.slice(i);
          i = s.length;
        } else {
          value = s.slice(i, end);
          i = end + 1;
        }
      } else {
        const vs = i;
        while (i < s.length && !/[\s>]/.test(s[i])) i++;
        value = s.slice(vs, i);
      }
    }
    attrs.set(name, value);
  }
  return attrs;
}

function closeIndexOf(html: string, from: number, name: string): number {
  return html.toLowerCase().indexOf(`</${name}`, from);
}

function scanHtml(html: string): HtmlFacts {
  const scripts: HtmlScript[] = [];
  const importMaps: unknown[] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!') {
      const gt = html.indexOf('>', lt + 2);
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    const m = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(lt));
    if (m === null) {
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    const after = lt + 1 + m[1].length;
    if (after < n && /[A-Za-z0-9]/.test(html[after])) {
      i = lt + 1;
      continue;
    }
    const gt = tagEnd(html, after);
    if (gt === -1) break;
    if (tag === 'script') {
      const attrs = attributesOf(html.slice(after, gt));
      const type = (attrs.get('type') ?? '').trim().toLowerCase();
      const src = attrs.has('src') ? (attrs.get('src') as string) : null;
      if (src === null) {
        const close = closeIndexOf(html, gt + 1, 'script');
        const body = close === -1 ? html.slice(gt + 1) : html.slice(gt + 1, close);
        if (type === 'importmap') {
          try {
            importMaps.push(JSON.parse(body));
          } catch {
            throw new DossierError('bad_importmap', 'index.html carries an import map that does not parse');
          }
        } else {
          scripts.push({ type, src: null, text: body });
        }
        i = close === -1 ? n : close + 8;
      } else {
        scripts.push({ type, src, text: null });
        i = gt + 1;
      }
    } else {
      i = gt + 1;
    }
  }
  return { scripts, importMaps };
}

// ---- import maps + specifier resolution ----

interface ImportMap {
  imports: Record<string, string>;
}

function importMapOf(maps: unknown[]): ImportMap {
  const out: ImportMap = { imports: {} };
  for (const m of maps) {
    if (m === null || typeof m !== 'object' || Array.isArray(m)) continue;
    const im = (m as Record<string, unknown>).imports;
    if (im !== null && typeof im === 'object' && !Array.isArray(im)) {
      for (const [k, v] of Object.entries(im as Record<string, unknown>)) {
        if (typeof v === 'string') out.imports[k] = v;
      }
    }
  }
  return out;
}

function resolveAppPath(spec: string, from: string): string | null {
  const base = from.split('/').slice(0, -1);
  const parts: string[] = spec.startsWith('/') ? [] : [...base];
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const rel = parts.join('/');
  if (rel === '' || rel === '..' || rel.startsWith('../')) return null;
  return rel;
}

function mappedSpecifier(spec: string, map: ImportMap): string | null {
  const imports = map.imports;
  if (Object.prototype.hasOwnProperty.call(imports, spec)) return imports[spec];
  let best: string | null = null;
  for (const key of Object.keys(imports)) {
    if (key.endsWith('/') && spec.startsWith(key)) {
      if (best === null || key.length > best.length) best = key;
    }
  }
  if (best === null) return null;
  return imports[best] + spec.slice(best.length);
}

function resolveSpecifier(spec: string, from: string, map: ImportMap): string | null {
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
    return resolveAppPath(spec, from);
  }
  const mapped = mappedSpecifier(spec, map);
  if (mapped === null) return null;
  return resolveSpecifier(mapped, from, map);
}

// ---- static import scanning (comments, strings, templates, regexes skipped) ----

function sourceImports(src: string): string[] {
  const found: string[] = [];
  const len = src.length;
  let i = 0;
  const isIdent = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_$]/.test(c);

  function skipWs(): void {
    while (i < len && /\s/.test(src[i])) i++;
  }

  function regexStart(pos: number): boolean {
    let j = pos - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    const prev = src[j];
    if (isIdent(prev)) return false;
    if (prev === ')' || prev === ']' || prev === '}') return false;
    return true;
  }

  // Reads a string starting at src[i] (a quote char). Template literals
  // may carry ${ ... } expressions; those are scanned through so a `}` or
  // quote inside them cannot end the string early. Returns the value, or
  // null for a template with an interpolation.
  function readString(): string | null {
    const q = src[i];
    i++;
    let out = '';
    let interpolated = false;
    while (i < len) {
      const c = src[i];
      if (c === '\\') {
        if (q !== '`' && i + 1 < len) out += src[i + 1];
        i += 2;
        continue;
      }
      if (q === '`' && c === '$' && src[i + 1] === '{') {
        interpolated = true;
        i += 2;
        skipExpression();
        continue;
      }
      if (c === q) {
        i++;
        return interpolated ? null : out;
      }
      if (q !== '`' && (c === '\n' || c === '\r')) return out;
      out += c;
      i++;
    }
    return out;
  }

  // Skips a ${ ... } expression: braces nest, strings/templates/regexes
  // inside are consumed by the same readers. Stops just past the matching }.
  function skipExpression(): void {
    let depth = 1;
    while (i < len && depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') {
        readString();
        continue;
      }
      if (c === '/' && src[i + 1] === '/') {
        while (i < len && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? len : end + 2;
        continue;
      }
      if (c === '/' && regexStart(i)) {
        readRegex();
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') depth--;
      i++;
    }
  }

  function readRegex(): void {
    i++; // the opening /
    let inClass = false;
    while (i < len) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '[') inClass = true;
      if (c === ']') inClass = false;
      if (c === '/' && !inClass) {
        i++;
        while (i < len && /[A-Za-z]/.test(src[i])) i++;
        return;
      }
      if (c === '\n') return;
      i++;
    }
  }

  function readIdent(): string {
    const start = i;
    while (i < len && isIdent(src[i])) i++;
    return src.slice(start, i);
  }

  // After `import`: dynamic import("..."), import.meta, or a clause whose
  // first string is the specifier (side-effect import or after `from`).
  function parseImport(): void {
    skipWs();
    if (src[i] === '(') {
      i++;
      skipWs();
      if (src[i] === '"' || src[i] === "'") {
        const v = readString();
        if (v !== null) found.push(v);
      }
      return;
    }
    if (src[i] === '.') return;
    for (;;) {
      skipWs();
      if (i >= len) return;
      const c = src[i];
      if (c === '"' || c === "'") {
        const v = readString();
        if (v !== null) found.push(v);
        return;
      }
      if (c === ';') return;
      if (isIdent(c)) {
        const w = readIdent();
        if (w === 'from') {
          skipWs();
          if (src[i] === '"' || src[i] === "'") {
            const v = readString();
            if (v !== null) found.push(v);
          }
          return;
        }
        continue;
      }
      i++;
    }
  }

  // After `export`: only a string that follows `from` is a specifier.
  // Strings in values are discarded; the clause ends at `;`.
  function parseExport(): void {
    for (;;) {
      skipWs();
      if (i >= len) return;
      const c = src[i];
      if (c === ';') return;
      if (c === '"' || c === "'" || c === '`') {
        readString();
        continue;
      }
      if (isIdent(c)) {
        const w = readIdent();
        if (w === 'from') {
          skipWs();
          if (src[i] === '"' || src[i] === "'") {
            const v = readString();
            if (v !== null) found.push(v);
          }
          return;
        }
        continue;
      }
      i++;
    }
  }

  while (i < len) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      readString();
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (c === '/' && regexStart(i)) {
      readRegex();
      continue;
    }
    if (isIdent(c)) {
      const word = readIdent();
      if (word === 'import') parseImport();
      else if (word === 'export') parseExport();
      continue;
    }
    i++;
  }
  return found;
}

// ---- import order ----

interface SourceFile {
  path: string;
  bytes: Buffer;
  text: string;
}

function importOrder(sources: SourceFile[], facts: HtmlFacts, map: ImportMap): string[] {
  const byPath = new Map<string, SourceFile>(sources.map((s) => [s.path, s]));
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (path: string, walk: boolean): void => {
    if (seen.has(path)) return;
    const file = byPath.get(path);
    if (file === undefined) return;
    if (!file.path.endsWith('.js') && !file.path.endsWith('.mjs')) return;
    seen.add(path);
    order.push(path);
    if (!walk) return;
    for (const spec of sourceImports(file.text)) {
      const target = resolveSpecifier(spec, path, map);
      if (target !== null) visit(target, true);
    }
  };
  for (const script of facts.scripts) {
    if (script.src !== null) {
      const target = resolveSpecifier(script.src, 'index.html', map);
      if (target !== null) visit(target, script.type === 'module');
    } else if (script.type === 'module') {
      for (const spec of sourceImports(script.text ?? '')) {
        const target = resolveSpecifier(spec, 'index.html', map);
        if (target !== null) visit(target, true);
      }
    }
  }
  return order;
}

// ---- dossier assembly ----

function cutLine(count: number, bytes: number): string {
  return `[... ${count} more file${count === 1 ? '' : 's'} (${bytes} bytes) not shown.]\n`;
}

function appBlockLines(tree: AppTree): string[] {
  const sources = tree.files.filter((f) => f.kind === 'source');
  const vendored = tree.files.filter((f) => f.kind === 'vendored');
  const assets = tree.files.filter((f) => f.kind === 'asset');
  const sum = (arr: AppFile[]): number => arr.reduce((a, f) => a + f.bytes, 0);
  const lines: string[] = [
    '## App',
    '',
    `Source files: ${sources.length} (${sum(sources)} bytes)`,
    `Vendored files: ${vendored.length} (${sum(vendored)} bytes)`,
  ];
  if (vendored.length > 0) {
    for (const f of vendored.slice(0, 24)) lines.push(`  ${f.path} (${f.bytes} bytes)`);
    if (vendored.length > 24) lines.push(`  ... and ${vendored.length - 24} more`);
  }
  if (assets.length === 0) {
    lines.push('Assets: none');
  } else {
    const byExt = new Map<string, { n: number; bytes: number }>();
    for (const f of assets) {
      const ext = f.path.includes('.') ? f.path.slice(f.path.lastIndexOf('.') + 1).toLowerCase() : '';
      const e = byExt.get(ext) ?? { n: 0, bytes: 0 };
      e.n++;
      e.bytes += f.bytes;
      byExt.set(ext, e);
    }
    const parts = [...byExt.entries()]
      .sort(([a], [b]) => byCodeUnit(a, b))
      .map(([ext, e]) => `${ext === '' ? '(no extension)' : ext} ${e.n} (${e.bytes} bytes)`);
    lines.push(`Assets: ${parts.join(', ')}`);
  }
  lines.push(`Totals: ${tree.count} files and directories (${tree.totalBytes} bytes)`);
  return lines;
}

interface Section {
  path: string;
  heading: string;
  block: string | null;
  bytes: number;
  totalLines: number;
  text: string;
  norm: Buffer;
}

// A partial section: heading + fence + the first k lines that fit in the
// remaining room (with the not-shown note and the cut line for the files
// after it), or null when not even one line fits.
function sourceHead(sec: Section, room: number, restCount: number, restBytes: number): string | null {
  const lines = sec.text.split('\n');
  const total = sec.totalLines;
  const fence = fenceFor(sec.text);
  const open = `${fence}${languageOf(sec.path)}\n`;
  const close = `${fence}\n\n`;
  const fixed = byteLength(sec.heading) + byteLength(open) + byteLength(close);
  let best = 0;
  let shown = 0;
  let raw = 0;
  for (let k = 1; k < total; k++) {
    shown += byteLength(lines[k - 1]) + 1;
    raw = sec.norm.indexOf(0x0a, raw) + 1;
    const hidden = total - k;
    const note = `[${hidden} of this file's ${total} lines not shown.]\n`;
    const tail = cutLine(restCount, restBytes + (sec.norm.length - raw));
    if (fixed + shown + byteLength(note) + byteLength(tail) <= room) best = k;
  }
  if (best === 0) return null;
  const head = lines.slice(0, best).map((l) => l + '\n').join('');
  let rawEnd = 0;
  for (let k = 0; k < best; k++) rawEnd = sec.norm.indexOf(0x0a, rawEnd) + 1;
  const hidden = total - best;
  return (
    sec.heading +
    open +
    head +
    close +
    `[${hidden} of this file's ${total} lines not shown.]\n` +
    cutLine(restCount, restBytes + (sec.norm.length - rawEnd))
  );
}

interface DossierImage {
  name: string;
  media_type: string;
  sha256: string;
  base64: string;
}

function buildDossier(dir: string): Buffer {
  const appDir = join(dir, 'app');
  const tree = walkApp(appDir);
  const indexEntry = tree.files.find((f) => f.path === 'index.html');
  if (indexEntry === undefined) throw new DossierError('no_index', 'app/ carries no index.html');
  const indexBytes = readFileSync(join(appDir, 'index.html'));
  if (indexBytes.length > INDEX_HTML_MAX_BYTES) {
    throw new DossierError('index_too_big', `app/index.html is ${indexBytes.length} bytes, over the ${INDEX_HTML_MAX_BYTES} cap`);
  }
  const indexText = decode(indexBytes);
  const facts = scanHtml(indexText);
  const map = importMapOf(facts.importMaps);

  const sources: SourceFile[] = [];
  for (const f of tree.files) {
    if (f.kind !== 'source') continue;
    const bytes = readFileSync(join(appDir, f.path));
    sources.push({ path: f.path, bytes, text: decode(bytes) });
  }
  const byPath = new Map<string, SourceFile>(sources.map((s) => [s.path, s]));
  const order = importOrder(sources, facts, map);
  const orderedPaths = [
    'index.html',
    ...order.filter((p) => p !== 'index.html'),
    ...sources.map((s) => s.path).filter((p) => p !== 'index.html' && !order.includes(p)).sort(byCodeUnit),
  ];

  const sections: Section[] = [];
  for (const p of orderedPaths) {
    const file = byPath.get(p);
    if (file === undefined) continue;
    const totalLines = lineCount(file.bytes);
    const heading = `### app/${p} (${totalLines} lines, ${file.bytes.length} bytes)\n\n`;
    let block: string | null = null;
    if (totalLines > 0) {
      const fence = fenceFor(file.text);
      block = `${fence}${languageOf(p)}\n${file.text}${file.text.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
    }
    sections.push({
      path: p,
      heading,
      block,
      bytes: byteLength(heading) + (block === null ? 0 : byteLength(block)),
      totalLines,
      text: file.text,
      norm: file.bytes,
    });
  }

  const head = [...appBlockLines(tree), '', '## Sources', '', ''].join('\n');
  const max = CAPS.text_max_bytes;
  let out = head;
  let used = byteLength(head);
  // Bytes of the sections after each index, for the cut line.
  const restBytesArr: number[] = new Array(sections.length + 1).fill(0);
  for (let k = sections.length - 1; k >= 0; k--) {
    restBytesArr[k] = restBytesArr[k + 1] + (k + 1 < sections.length ? sections[k + 1].bytes : 0);
  }
  for (let k = 0; k < sections.length; k++) {
    const sec = sections[k];
    const restCount = sections.length - k - 1;
    const tail = restCount === 0 ? '' : cutLine(restCount, restBytesArr[k]);
    if (used + sec.bytes + byteLength(tail) <= max) {
      out += sec.heading + (sec.block ?? '');
      used += sec.bytes;
      continue;
    }
    if (sec.block === null) {
      out += cutLine(restCount + 1, restBytesArr[k] + sec.bytes);
      break;
    }
    const part = sourceHead(sec, max - used, restCount, restBytesArr[k]);
    if (part !== null) out += part;
    else out += cutLine(restCount + 1, restBytesArr[k] + sec.bytes);
    break;
  }
  const text = out.replace(/\n+$/, '\n');

  const shotsDir = join(dir, 'screenshots');
  const names = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort(byCodeUnit)
    : [];
  if (names.length > CAPS.screenshots.max) {
    throw new DossierError('too_many_screenshots', `${names.length} screenshots, over the ${CAPS.screenshots.max} cap`);
  }
  const images: DossierImage[] = names.map((name) => {
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(name)) {
      throw new DossierError('bad_shot_name', `screenshot name ${name} is not allowed`);
    }
    const bytes = readFileSync(join(shotsDir, name));
    if (bytes.length > CAPS.screenshots.max_bytes) {
      throw new DossierError('shot_too_big', `screenshot ${name} is ${bytes.length} bytes, over the ${CAPS.screenshots.max_bytes} cap`);
    }
    const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isPng && !isJpg) {
      throw new DossierError('bad_shot_type', `screenshot ${name} is neither PNG nor JPEG`);
    }
    return {
      name,
      media_type: isPng ? 'image/png' : 'image/jpeg',
      sha256: sha256Hex(bytes),
      base64: bytes.toString('base64'),
    };
  });

  return Buffer.from(canonicalJson({ schema: SCHEMA, cover: 0, text, images }), 'utf8');
}

// ---- entrypoint ----

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'app'), join(out, 'app'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}
writeFileSync(join(out, 'dossier.json'), buildDossier(out));
