import { Fragment, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { cx } from './ui';

type Alignment = 'left' | 'center' | 'right' | null;

interface ListItemNode {
  lines: string[];
  checked?: boolean;
  children: ListBlockNode[];
}

interface ListBlockNode {
  type: 'list';
  ordered: boolean;
  start: number;
  items: ListItemNode[];
}

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'hr' }
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; headers: string[]; alignments: Alignment[]; rows: string[][] }
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | ListBlockNode
  | { type: 'paragraph'; lines: string[] };

const ESCAPABLE_PUNCTUATION = new Set([
  '\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '>', '~',
]);

export function sanitizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/^<|>$/g, '');
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/** Splits a GFM table row while preserving escaped pipes (`\|`) and pipes inside backtick code spans. */
function splitTableRow(rawLine: string): string[] {
  let line = rawLine.trim();
  if (line.startsWith('|')) line = line.slice(1);
  if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let i = 0;
  let inCodeTicks = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length && line[i + 1] === '|') {
      current += '|';
      i += 2;
      continue;
    }
    if (ch === '`') {
      let run = 0;
      while (i + run < line.length && line[i + run] === '`') run++;
      if (inCodeTicks === 0) inCodeTicks = run;
      else if (inCodeTicks === run) inCodeTicks = 0;
      current += line.slice(i, i + run);
      i += run;
      continue;
    }
    if (ch === '|' && inCodeTicks === 0) {
      cells.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  cells.push(current.trim());
  return cells;
}

function parseTableDelimiterRow(line: string, expectedCols: number): Alignment[] | null {
  if (!line.includes('|') && expectedCols <= 1) return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return null;
  if (cells.length < expectedCols && expectedCols > 1 && cells.length === 1) return null;

  const alignments: Alignment[] = [];
  for (const cell of cells) {
    if (!/^:?-{1,}:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) alignments.push('center');
    else if (right) alignments.push('right');
    else if (left) alignments.push('left');
    else alignments.push(null);
  }
  return alignments;
}

function matchListLine(line: string): {
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
  checked?: boolean;
} | null {
  const ul = line.match(/^(\s*)([-*+•])\s+(.*)$/);
  if (ul) {
    const body = ul[3];
    const task = body.match(/^\[([ xX])\]\s+(.*)$/);
    return {
      indent: ul[1].replace(/\t/g, '  ').length,
      ordered: false,
      start: 1,
      text: task ? task[2] : body,
      ...(task ? { checked: task[1].toLowerCase() === 'x' } : {}),
    };
  }
  const ol = line.match(/^(\s*)(\d{1,9})[.)]\s+(.*)$/);
  if (ol) {
    const body = ol[3];
    const task = body.match(/^\[([ xX])\]\s+(.*)$/);
    return {
      indent: ol[1].replace(/\t/g, '  ').length,
      ordered: true,
      start: Number.parseInt(ol[2], 10) || 1,
      text: task ? task[2] : body,
      ...(task ? { checked: task[1].toLowerCase() === 'x' } : {}),
    };
  }
  return null;
}

function isHorizontalRule(line: string): boolean {
  return /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function isHeadingLine(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const m = line.match(/^\s*(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
  if (!m) return null;
  return {
    level: m[1].length as 1 | 2 | 3 | 4 | 5 | 6,
    text: m[2].trim(),
  };
}

function matchFenceStart(line: string): { char: string; len: number; lang: string } | null {
  const m = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (!m) return null;
  const fence = m[1];
  const info = m[2].trim();
  if (fence[0] === '`' && info.includes('`')) return null;
  return {
    char: fence[0],
    len: fence.length,
    lang: info.split(/\s+/)[0] ?? '',
  };
}

function isBlockStarter(lines: string[], idx: number): boolean {
  const line = lines[idx];
  if (!line.trim()) return true;
  if (matchFenceStart(line)) return true;
  if (isHeadingLine(line)) return true;
  if (isHorizontalRule(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (matchListLine(line)) return true;
  if (idx + 1 < lines.length && line.includes('|')) {
    const headerCells = splitTableRow(line);
    if (parseTableDelimiterRow(lines[idx + 1], headerCells.length)) return true;
  }
  return false;
}

interface FlatListEntry {
  indent: number;
  ordered: boolean;
  start: number;
  lines: string[];
  checked?: boolean;
}

function buildListTree(entries: FlatListEntry[], startIdx = 0, baseIndent = entries[0]?.indent ?? 0): {
  list: ListBlockNode;
  nextIdx: number;
} {
  const first = entries[startIdx];
  const list: ListBlockNode = {
    type: 'list',
    ordered: first.ordered,
    start: first.start,
    items: [],
  };

  let idx = startIdx;
  while (idx < entries.length) {
    const cur = entries[idx];
    if (cur.indent < baseIndent) break;
    if (cur.indent === baseIndent && cur.ordered !== list.ordered) break;

    if (cur.indent > baseIndent) {
      if (list.items.length === 0) {
        // Normalize unexpectedly deep initial indent to current level.
        const item: ListItemNode = {
          lines: cur.lines,
          checked: cur.checked,
          children: [],
        };
        list.items.push(item);
        idx++;
        continue;
      }
      const nested = buildListTree(entries, idx, cur.indent);
      list.items[list.items.length - 1].children.push(nested.list);
      idx = nested.nextIdx;
      continue;
    }

    list.items.push({
      lines: cur.lines,
      checked: cur.checked,
      children: [],
    });
    idx++;
  }

  return { list, nextIdx: idx };
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // 1. Fenced code block
    const fence = matchFenceStart(line);
    if (fence) {
      const codeLines: string[] = [];
      const closeRe = new RegExp(`^\\s*${fence.char}{${fence.len},}\\s*$`);
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && closeRe.test(lines[i])) i++;
      blocks.push({ type: 'code', lang: fence.lang, code: codeLines.join('\n') });
      continue;
    }

    // 2. GFM Table (checked before HR so `| --- |` isn't treated as HR)
    if (i + 1 < lines.length && line.includes('|')) {
      const headers = splitTableRow(line);
      const alignments = parseTableDelimiterRow(lines[i + 1], headers.length);
      if (alignments) {
        const colCount = Math.max(headers.length, alignments.length);
        const normHeaders = Array.from({ length: colCount }, (_, c) => headers[c] ?? '');
        const normAligns = Array.from({ length: colCount }, (_, c) => alignments[c] ?? null);
        const rows: string[][] = [];
        i += 2;
        while (i < lines.length) {
          const rowLine = lines[i];
          if (!rowLine.trim()) break;
          if (!rowLine.includes('|')) break;
          if (matchFenceStart(rowLine) || isHeadingLine(rowLine) || isHorizontalRule(rowLine) || /^\s*>\s?/.test(rowLine)) {
            break;
          }
          const cells = splitTableRow(rowLine);
          rows.push(Array.from({ length: colCount }, (_, c) => cells[c] ?? ''));
          i++;
        }
        blocks.push({ type: 'table', headers: normHeaders, alignments: normAligns, rows });
        continue;
      }
    }

    // 3. Heading (H1 - H6)
    const heading = isHeadingLine(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading.level, text: heading.text });
      i++;
      continue;
    }

    // 4. Horizontal rule
    if (isHorizontalRule(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 5. Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', blocks: parseMarkdownBlocks(quoteLines.join('\n')) });
      continue;
    }

    // 6. Lists (ordered, unordered, nested, task lists)
    const firstList = matchListLine(line);
    if (firstList) {
      const entries: FlatListEntry[] = [];
      while (i < lines.length) {
        const curLine = lines[i];
        if (!curLine.trim()) {
          // Look ahead: stay in list only if the next non-blank line is another list item.
          let lookahead = i + 1;
          while (lookahead < lines.length && !lines[lookahead].trim()) lookahead++;
          if (lookahead < lines.length && matchListLine(lines[lookahead])) {
            i = lookahead;
            continue;
          }
          break;
        }
        const m = matchListLine(curLine);
        if (m) {
          entries.push({
            indent: m.indent,
            ordered: m.ordered,
            start: m.start,
            lines: [m.text],
            checked: m.checked,
          });
          i++;
          continue;
        }
        if (isBlockStarter(lines, i)) break;
        if (entries.length > 0) {
          entries[entries.length - 1].lines.push(curLine.trim());
          i++;
          continue;
        }
        break;
      }

      let cursor = 0;
      while (cursor < entries.length) {
        const built = buildListTree(entries, cursor, entries[cursor].indent);
        blocks.push(built.list);
        cursor = built.nextIdx;
      }
      continue;
    }

    // 7. Paragraph
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && !isBlockStarter(lines, i)) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', lines: paraLines });
  }

  return blocks;
}

function findClosingDelimiter(
  text: string,
  from: number,
  delim: string,
  requireWordBoundary: boolean,
): number {
  let i = from;
  while (i <= text.length - delim.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === '`') {
      let run = 0;
      while (i + run < text.length && text[i + run] === '`') run++;
      const closeTick = text.indexOf('`'.repeat(run), i + run);
      if (closeTick !== -1) {
        i = closeTick + run;
        continue;
      }
    }
    if (text.startsWith(delim, i)) {
      // Avoid matching `**` when closing single `*`, or `__` when closing single `_`.
      if (delim.length === 1 && text[i + 1] === delim[0]) {
        i += 2;
        continue;
      }
      const prevChar = text[i - 1] ?? '';
      if (!/\s/.test(prevChar)) {
        if (requireWordBoundary) {
          const nextChar = text[i + delim.length] ?? '';
          if (!nextChar || !/[a-zA-Z0-9]/.test(nextChar)) return i;
        } else {
          return i;
        }
      }
    }
    i++;
  }
  return -1;
}

function findMatchingBracket(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === '`') {
      let run = 0;
      while (i + run < text.length && text[i + run] === '`') run++;
      const close = text.indexOf('`'.repeat(run), i + run);
      if (close !== -1) {
        i = close + run;
        continue;
      }
    }
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    } else if (/\s/.test(text[i]) && depth === 1) {
      // Allow optional link title like `(https://example.com "title")`.
      const closeAfterTitle = text.indexOf(')', i);
      return closeAfterTitle;
    }
    i++;
  }
  return -1;
}

function trimBareUrlTrailing(rawUrl: string): string {
  let url = rawUrl;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === '.' || last === ',' || last === ';' || last === ':' || last === '!' || last === '?') {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')' || last === ']') {
      const openChar = last === ')' ? '(' : '[';
      const opens = (url.match(new RegExp(`\\${openChar}`, 'g')) ?? []).length;
      const closes = (url.match(new RegExp(`\\${last}`, 'g')) ?? []).length;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

export function renderInlineMarkdown(text: string, compact = false, keyPrefix = 'in'): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  let pos = 0;
  let k = 0;

  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };

  const linkCls =
    'inline-flex items-baseline gap-0.5 break-all font-medium text-sky-300 underline decoration-sky-400/35 underline-offset-2 transition-colors hover:text-sky-200 hover:decoration-sky-300';
  const codeCls = compact
    ? 'rounded border border-white/[0.06] bg-white/[0.08] px-1 py-px font-mono text-[0.8125em] text-sky-200'
    : 'rounded-md border border-white/[0.07] bg-white/[0.07] px-1.5 py-px font-mono text-[0.8125em] text-sky-200';

  while (pos < text.length) {
    const ch = text[pos];

    // 1. Backslash escape
    if (ch === '\\' && pos + 1 < text.length && ESCAPABLE_PUNCTUATION.has(text[pos + 1])) {
      buf += text[pos + 1];
      pos += 2;
      continue;
    }

    // 2. Inline code span (1 or more backticks)
    if (ch === '`') {
      let run = 0;
      while (pos + run < text.length && text[pos + run] === '`') run++;
      const needle = '`'.repeat(run);
      let searchFrom = pos + run;
      let closeIdx = -1;
      while (searchFrom < text.length) {
        const candidate = text.indexOf(needle, searchFrom);
        if (candidate === -1) break;
        const beforeOk = candidate === 0 || text[candidate - 1] !== '`';
        const afterOk = candidate + run >= text.length || text[candidate + run] !== '`';
        if (beforeOk && afterOk) {
          closeIdx = candidate;
          break;
        }
        searchFrom = candidate + 1;
      }
      if (closeIdx !== -1) {
        let content = text.slice(pos + run, closeIdx);
        if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim().length > 0) {
          content = content.slice(1, -1);
        }
        flush();
        out.push(
          <code key={`${keyPrefix}-c-${k++}`} className={codeCls}>
            {content}
          </code>,
        );
        pos = closeIdx + run;
        continue;
      }
      buf += needle;
      pos += run;
      continue;
    }

    // 3. Markdown link [label](url)
    if (ch === '[') {
      const closeBracket = findMatchingBracket(text, pos);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = findMatchingParen(text, closeBracket + 1);
        if (closeParen !== -1) {
          const label = text.slice(pos + 1, closeBracket);
          const rawTarget = text.slice(closeBracket + 2, closeParen).trim();
          const urlPart = rawTarget.split(/\s+/)[0] ?? '';
          const safeHref = sanitizeExternalUrl(urlPart);
          if (safeHref) {
            flush();
            out.push(
              <a
                key={`${keyPrefix}-a-${k++}`}
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className={linkCls}
              >
                <span>{renderInlineMarkdown(label, compact, `${keyPrefix}-l-${k}`)}</span>
                <ExternalLink className="inline h-3 w-3 shrink-0 self-center opacity-70" />
              </a>,
            );
            pos = closeParen + 1;
            continue;
          }
        }
      }
    }

    // 4. Autolink <https://...>
    if (ch === '<') {
      const autoMatch = text.slice(pos).match(/^<(https?:\/\/[^\s<>]+)>/i);
      if (autoMatch) {
        const safeHref = sanitizeExternalUrl(autoMatch[1]);
        if (safeHref) {
          flush();
          out.push(
            <a
              key={`${keyPrefix}-au-${k++}`}
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className={linkCls}
            >
              <span>{autoMatch[1]}</span>
              <ExternalLink className="inline h-3 w-3 shrink-0 self-center opacity-70" />
            </a>,
          );
          pos += autoMatch[0].length;
          continue;
        }
      }
    }

    // 5. Bare http(s) URL auto-link
    if (
      (ch === 'h' || ch === 'H') &&
      (pos === 0 || /[\s(|[\-:;,>]/.test(text[pos - 1])) &&
      /^https?:\/\/[^\s<>"'`]+/i.test(text.slice(pos))
    ) {
      const match = text.slice(pos).match(/^https?:\/\/[^\s<>"'`]+/i)!;
      const cleaned = trimBareUrlTrailing(match[0]);
      const safeHref = sanitizeExternalUrl(cleaned);
      if (safeHref) {
        flush();
        out.push(
          <a
            key={`${keyPrefix}-u-${k++}`}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className={linkCls}
          >
            <span>{cleaned}</span>
            <ExternalLink className="inline h-3 w-3 shrink-0 self-center opacity-70" />
          </a>,
        );
        pos += cleaned.length;
        continue;
      }
    }

    // 5. Bold (**...** or __...__)
    if (text.startsWith('**', pos) && pos + 2 < text.length && !/\s/.test(text[pos + 2])) {
      const close = findClosingDelimiter(text, pos + 2, '**', false);
      if (close !== -1) {
        flush();
        out.push(
          <strong key={`${keyPrefix}-b-${k++}`} className="font-semibold text-slate-100">
            {renderInlineMarkdown(text.slice(pos + 2, close), compact, `${keyPrefix}-bi-${k}`)}
          </strong>,
        );
        pos = close + 2;
        continue;
      }
    }

    if (
      text.startsWith('__', pos) &&
      (pos === 0 || !/[a-zA-Z0-9]/.test(text[pos - 1])) &&
      pos + 2 < text.length &&
      !/\s/.test(text[pos + 2])
    ) {
      const close = findClosingDelimiter(text, pos + 2, '__', true);
      if (close !== -1) {
        flush();
        out.push(
          <strong key={`${keyPrefix}-bb-${k++}`} className="font-semibold text-slate-100">
            {renderInlineMarkdown(text.slice(pos + 2, close), compact, `${keyPrefix}-bbi-${k}`)}
          </strong>,
        );
        pos = close + 2;
        continue;
      }
    }

    // 6. Strikethrough (~~...~~)
    if (text.startsWith('~~', pos) && pos + 2 < text.length && !/\s/.test(text[pos + 2])) {
      const close = findClosingDelimiter(text, pos + 2, '~~', false);
      if (close !== -1) {
        flush();
        out.push(
          <del key={`${keyPrefix}-s-${k++}`} className="text-slate-400 line-through">
            {renderInlineMarkdown(text.slice(pos + 2, close), compact, `${keyPrefix}-si-${k}`)}
          </del>,
        );
        pos = close + 2;
        continue;
      }
    }

    // 7. Italic (*...* or word-bounded _..._)
    if (ch === '*' && text[pos + 1] !== '*' && pos + 1 < text.length && !/\s/.test(text[pos + 1])) {
      const close = findClosingDelimiter(text, pos + 1, '*', false);
      if (close !== -1) {
        flush();
        out.push(
          <em key={`${keyPrefix}-em-${k++}`} className="italic text-slate-300">
            {renderInlineMarkdown(text.slice(pos + 1, close), compact, `${keyPrefix}-emi-${k}`)}
          </em>,
        );
        pos = close + 1;
        continue;
      }
    }

    if (
      ch === '_' &&
      text[pos + 1] !== '_' &&
      (pos === 0 || !/[a-zA-Z0-9]/.test(text[pos - 1])) &&
      pos + 1 < text.length &&
      !/\s/.test(text[pos + 1])
    ) {
      const close = findClosingDelimiter(text, pos + 1, '_', true);
      if (close !== -1) {
        flush();
        out.push(
          <em key={`${keyPrefix}-emu-${k++}`} className="italic text-slate-400">
            {renderInlineMarkdown(text.slice(pos + 1, close), compact, `${keyPrefix}-emui-${k}`)}
          </em>,
        );
        pos = close + 1;
        continue;
      }
    }

    buf += ch;
    pos++;
  }

  flush();
  return out;
}

function CodeBlockCard({ lang, code, compact }: { lang: string; code: string; compact: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      void navigator.clipboard?.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failures in restricted environments.
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-white/[0.09] bg-[#06090f]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
        <span className="font-mono text-[0.6875rem] font-medium tracking-wide text-slate-400 lowercase">
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] text-slate-400 transition-colors hover:bg-white/[0.07] hover:text-slate-200"
          title="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre
        className={cx(
          'overflow-x-auto px-3.5 py-2.5 font-mono leading-relaxed text-slate-200',
          compact ? 'text-[0.75rem]' : 'text-[0.8125rem]',
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderListNode(node: ListBlockNode, compact: boolean, keyPrefix: string): ReactNode {
  const Tag = node.ordered ? 'ol' : 'ul';
  return (
    <Tag
      start={node.ordered && node.start !== 1 ? node.start : undefined}
      className={cx(
        'my-1.5 space-y-1.5 pl-5',
        node.ordered
          ? 'list-decimal marker:font-mono marker:text-[0.82em] marker:font-medium marker:text-sky-300/80'
          : 'list-disc marker:text-slate-500',
      )}
    >
      {node.items.map((item, idx) => (
        <li key={`${keyPrefix}-li-${idx}`} className="leading-relaxed text-slate-200">
          <div className={cx(item.checked !== undefined && 'flex items-start gap-2')}>
            {item.checked !== undefined && (
              <span
                aria-hidden
                className={cx(
                  'mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[0.625rem]',
                  item.checked
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
                    : 'border-white/20 bg-white/[0.03] text-transparent',
                )}
              >
                ✓
              </span>
            )}
            <div className="min-w-0 flex-1">
              {item.lines.map((ln, lIdx) => (
                <Fragment key={lIdx}>
                  {lIdx > 0 && <br />}
                  {renderInlineMarkdown(ln, compact, `${keyPrefix}-li-${idx}-${lIdx}`)}
                </Fragment>
              ))}
            </div>
          </div>
          {item.children.map((child, cIdx) => (
            <Fragment key={`${keyPrefix}-sub-${idx}-${cIdx}`}>
              {renderListNode(child, compact, `${keyPrefix}-sub-${idx}-${cIdx}`)}
            </Fragment>
          ))}
        </li>
      ))}
    </Tag>
  );
}

function renderBlocks(blocks: MarkdownBlock[], compact: boolean, keyPrefix = 'blk'): ReactNode[] {
  const headingClasses: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
    1: compact
      ? 'mt-2.5 mb-1 border-b border-white/[0.08] pb-1 text-sm font-semibold text-slate-50 first:mt-0'
      : 'mt-4 mb-1.5 border-b border-white/[0.08] pb-1.5 text-base font-semibold tracking-tight text-slate-50 first:mt-0',
    2: compact
      ? 'mt-2.5 mb-1 text-[0.84375rem] font-semibold text-slate-100 first:mt-0'
      : 'mt-3.5 mb-1.5 text-[0.9375rem] font-semibold tracking-tight text-slate-100 first:mt-0',
    3: compact
      ? 'mt-2 mb-0.5 text-[0.8125rem] font-semibold text-sky-200/95 first:mt-0'
      : 'mt-3 mb-1 text-sm font-semibold text-slate-100 first:mt-0',
    4: compact
      ? 'mt-2 mb-0.5 text-xs font-semibold text-sky-200/90 first:mt-0'
      : 'mt-2.5 mb-1 text-[0.84375rem] font-semibold text-sky-200/95 first:mt-0',
    5: 'mt-2 mb-0.5 text-xs font-semibold tracking-wide text-slate-300 uppercase first:mt-0',
    6: 'mt-2 mb-0.5 text-[0.6875rem] font-semibold tracking-wider text-slate-400 uppercase first:mt-0',
  };

  return blocks.map((block, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (block.type) {
      case 'heading': {
        const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return (
          <Tag key={key} className={headingClasses[block.level]}>
            {renderInlineMarkdown(block.text, compact, key)}
          </Tag>
        );
      }
      case 'hr':
        return <hr key={key} className="my-3 border-t border-white/[0.08]" />;
      case 'code':
        return <CodeBlockCard key={key} lang={block.lang} code={block.code} compact={compact} />;
      case 'table':
        return (
          <div
            key={key}
            className="my-2.5 overflow-x-auto rounded-xl border border-white/[0.09] bg-black/25"
          >
            <table className={cx('w-full border-collapse text-left', compact ? 'text-[0.75rem]' : 'text-[0.8125rem]')}>
              <thead className="border-b border-white/[0.09] bg-white/[0.04] text-slate-100">
                <tr>
                  {block.headers.map((header, hIdx) => {
                    const align = block.alignments[hIdx];
                    return (
                      <th
                        key={hIdx}
                        className={cx(
                          'px-3 py-2 font-semibold whitespace-nowrap',
                          align === 'center' && 'text-center',
                          align === 'right' && 'text-right',
                        )}
                      >
                        {renderInlineMarkdown(header, compact, `${key}-th-${hIdx}`)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] text-slate-200">
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="transition-colors hover:bg-white/[0.025]">
                    {row.map((cell, cIdx) => {
                      const align = block.alignments[cIdx];
                      return (
                        <td
                          key={cIdx}
                          className={cx(
                            'px-3 py-2 align-top leading-snug',
                            align === 'center' && 'text-center',
                            align === 'right' && 'text-right',
                          )}
                        >
                          {renderInlineMarkdown(cell, compact, `${key}-td-${rIdx}-${cIdx}`)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'blockquote':
        return (
          <blockquote
            key={key}
            className="my-2 space-y-1.5 rounded-r-lg border-l-2 border-sky-400/50 bg-sky-500/[0.04] py-2 pr-3 pl-3.5 text-slate-300"
          >
            {renderBlocks(block.blocks, compact, `${key}-bq`)}
          </blockquote>
        );
      case 'list':
        return <Fragment key={key}>{renderListNode(block, compact, key)}</Fragment>;
      case 'paragraph':
        return (
          <p key={key} className="leading-relaxed text-slate-200">
            {block.lines.map((ln, lIdx) => (
              <Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {renderInlineMarkdown(ln, compact, `${key}-p-${lIdx}`)}
              </Fragment>
            ))}
          </p>
        );
    }
  });
}

/** Strips basic markdown syntax for single-line preview summaries. */
export function stripMarkdownForPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*•>]\s+/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function MarkdownContent({
  text,
  compact = false,
  className,
}: {
  text: string;
  compact?: boolean;
  className?: string;
}) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div
      className={cx(
        'min-w-0 break-words',
        compact ? 'space-y-1.5 text-[0.8125rem] leading-relaxed' : 'space-y-2.5 text-sm leading-relaxed',
        className,
      )}
    >
      {renderBlocks(blocks, compact)}
    </div>
  );
}
