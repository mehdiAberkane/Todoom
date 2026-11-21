// A small Markdown reader for descriptions and comments. It returns a tree of
// plain objects that the Markdown component turns into React elements: no
// HTML is ever produced or injected, so nothing in a ticket can run as code.
// Links only lead to http(s) addresses; everything else stays text.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "path"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export interface ListItem {
  c: Inline[];
  /** null for a plain item, true / false for a checkbox. */
  task: boolean | null;
  /** Line of the item in the source, to tick its box there. */
  line: number;
  /** 0 at the left margin, 1 for an item indented under another… */
  level: number;
}

export type Block =
  | { t: "p"; lines: Inline[][] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; lines: Inline[][] }
  | { t: "list"; ordered: boolean; items: ListItem[] }
  | { t: "hr" };

// Earliest match wins; groups: 1 code, 2-3 link, 4 bare address, 5-6 bold, 7-8 italic, 9 file path.
const INLINE =
  /(`[^`\n]+`)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<!\w)_([^_\s][^_\n]*?)_(?!\w)|([A-Za-z]:\\[^\s"'<>|*?]+|(?:\.{1,2}\/|~\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,8}\b)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    if (at > last) out.push({ t: "text", v: text.slice(last, at) });
    if (m[1]) out.push({ t: "code", v: m[1].slice(1, -1) });
    else if (m[2]) out.push({ t: "link", href: m[3], c: parseInline(m[2]) });
    else if (m[4]) out.push({ t: "link", href: m[4], c: [{ t: "text", v: m[4] }] });
    else if (m[5] ?? m[6]) out.push({ t: "strong", c: parseInline((m[5] ?? m[6])!) });
    else if (m[7] ?? m[8]) out.push({ t: "em", c: parseInline((m[7] ?? m[8])!) });
    else if (m[9]) out.push({ t: "path", v: m[9] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // the closing fence (or the end of the text)
      blocks.push({ t: "code", lang: fence[2], v: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ t: "h", level: heading[1].length, c: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(parseInline(lines[i++].replace(/^\s*>\s?/, "")));
      blocks.push({ t: "quote", lines: quoted });
      continue;
    }
    const first = line.match(LIST_ITEM);
    if (first) {
      const ordered = /\d/.test(first[2]);
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        const task = m[3].match(TASK);
        items.push({
          c: parseInline(task ? m[3].slice(task[0].length) : m[3]),
          task: task ? task[1] !== " " : null,
          line: i,
          level: Math.min(4, Math.floor(m[1].replace(/\t/g, "  ").length / 2)),
        });
        i++;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    const para: Inline[][] = [];
    while (i < lines.length && lines[i].trim() && !LIST_ITEM.test(lines[i]) && !/^(#{1,6}\s|\s*>|\s*(```|~~~))/.test(lines[i])) {
      para.push(parseInline(lines[i++]));
    }
    blocks.push({ t: "p", lines: para });
  }
  return blocks;
}

/** The source with the checkbox of `line` ticked or unticked. */
export function toggleTask(source: string, line: number): string {
  const lines = source.split("\n");
  const m = lines[line]?.match(/^(\s*([-*+]|\d+[.)])\s+)\[([ xX])\]/);
  if (!m) return source;
  lines[line] = `${m[1]}[${m[3] === " " ? "x" : " "}]${lines[line].slice(m[0].length)}`;
  return lines.join("\n");
}
