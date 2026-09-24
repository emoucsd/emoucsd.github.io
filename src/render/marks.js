// Inline marks for declared form breaks (owner ruling, 2026-09-14). §6.8 still holds: no content
// string is interpreted as markup. This is a closed, tiny grammar parsed into text nodes and a
// fixed set of elements, never innerHTML:
//
//   *text*    em      another voice, or the narrator addressing itself
//   **text**  strong
//   `text`    code    in the mono face
//   ~~text~~  s       struck or overwritten text
//   newline   br      inside a paragraph; a blank line starts a new paragraph
//
// One level only: whatever sits inside a mark is literal text. A marker without its closer is
// literal, as is a marker escaped with a backslash (\* \` \~ \\). A mark's text may not begin
// or end with a space, so "2 * 3 * 4" stays arithmetic. Nothing else is recognised. Content
// lint keeps ordinary cards free of marks; the renderer parses always.

export const MARK_TAGS = new Set(['p', 'br', 'em', 'strong', 'code', 's']);

const ESCAPABLE = new Set(['*', '`', '~', '\\']);

function unescape(s) {
  return s.replace(/\\([*`~\\])/g, '$1');
}

// Index of the closing delimiter at or after `from`, skipping escaped characters. For a single
// `*`, a `**` pair is never a closer.
function findCloser(s, from, delim) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c === '\n') return -1;
    if (!s.startsWith(delim, j)) continue;
    if (delim === '*') {
      if (s[j + 1] === '*') {
        j++;
        continue;
      }
      if (s[j - 1] === '*') continue;
    }
    return j;
  }
  return -1;
}

const DELIMS = [
  ['`', 'code'],
  ['**', 'strong'],
  ['~~', 's'],
  ['*', 'em'],
];

function parseInline(s) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && ESCAPABLE.has(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '\n') {
      flush();
      out.push({ type: 'br' });
      i += 1;
      continue;
    }
    let matched = false;
    for (const [delim, type] of DELIMS) {
      if (!s.startsWith(delim, i)) continue;
      const start = i + delim.length;
      const end = findCloser(s, start, delim);
      const inner = end > start ? s.slice(start, end) : '';
      const spaced = type !== 'code' && (/^\s/.test(inner) || /\s$/.test(inner));
      if (end > start && inner && !spaced) {
        flush();
        out.push({ type, text: unescape(inner) });
        i = end + delim.length;
        matched = true;
      }
      break;
    }
    if (matched) continue;
    // An unmatched run of the same marker is literal as a whole, so "**half" stays "**half".
    let j = i + 1;
    if (c === '*' || c === '~' || c === '`') while (s[j] === c) j++;
    buf += s.slice(i, j);
    i = j;
  }
  flush();
  return out;
}

// Paragraphs of tokens: { type: 'text', text } | { type: 'br' } | { type: 'em'|'strong'|'code'|'s', text }.
export function parseMarks(text) {
  const value = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  return value
    .split(/\n[ \t]*\n\s*/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim())
    .map(parseInline);
}

function appendTokens(parent, tokens, onText) {
  for (const t of tokens) {
    if (t.type === 'text') {
      if (onText) onText(parent, t.text);
      else parent.appendChild(document.createTextNode(t.text));
    } else if (t.type === 'br') {
      parent.appendChild(document.createElement('br'));
    } else if (MARK_TAGS.has(t.type)) {
      const el = document.createElement(t.type);
      el.appendChild(document.createTextNode(t.text));
      parent.appendChild(el);
    }
  }
}

// Replace `target`'s children with the parsed text. Paragraphs become <p> children; with
// { paragraphs: false } (a title) a blank line is two line breaks instead. `onText(parent, text)`
// may take over plain runs, which is how the glossary marks its terms.
export function renderMarks(target, text, opts = {}) {
  while (target.firstChild) target.removeChild(target.firstChild);
  const paras = parseMarks(text);
  if (opts.paragraphs === false) {
    paras.forEach((tokens, i) => {
      if (i > 0) {
        target.appendChild(document.createElement('br'));
        target.appendChild(document.createElement('br'));
      }
      appendTokens(target, tokens, opts.onText);
    });
    return target;
  }
  for (const tokens of paras) {
    const p = document.createElement('p');
    appendTokens(p, tokens, opts.onText);
    target.appendChild(p);
  }
  return target;
}
