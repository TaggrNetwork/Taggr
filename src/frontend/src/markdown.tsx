import * as React from "react";

// --- Types ---

type Alignment = "left" | "center" | "right";

type Block =
    | { type: "heading"; level: number; content: string }
    | { type: "paragraph"; content: string }
    | { type: "code"; lang: string; content: string }
    | { type: "blockquote"; blocks: Block[] }
    | {
          type: "list";
          ordered: boolean;
          start: number;
          items: Block[][];
      }
    | {
          type: "table";
          headers: string[];
          aligns: (Alignment | null)[];
          rows: string[][];
      }
    | { type: "hr" }
    | { type: "details"; summary: string; blocks: Block[] };

interface Components {
    [key: string]: React.ComponentType<any>;
}

interface MarkdownProps {
    children: string;
    components?: Components;
}

// --- Entity Decoding ---

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00A0",
    copy: "\u00A9",
    mdash: "\u2014",
    ndash: "\u2013",
    hellip: "\u2026",
    middot: "\u00B7",
    bull: "\u2022",
    laquo: "\u00AB",
    raquo: "\u00BB",
};

const MAX_NESTING_DEPTH = 10;
const MAX_TABLE_COLUMNS = 50;
const MAX_TABLE_ROWS = 1000;
const MAX_LIST_ITEMS = 1000;

const EMPTY_COMPONENTS: Components = {};

const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

const isSafeUrl = (url: string): boolean => {
    const cleaned = url.trim().replace(/[\t\n\r]/g, "");
    if (cleaned.startsWith("//")) return false;
    try {
        return SAFE_PROTOCOLS.has(
            new URL(cleaned, "https://x.invalid").protocol,
        );
    } catch {
        return false;
    }
};

const safeFromCodePoint = (cp: number): string | null =>
    cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
        ? String.fromCodePoint(cp)
        : null;

const decodeEntities = (text: string): string =>
    text.replace(
        /&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g,
        (match, dec, hex, named) => {
            if (dec) return safeFromCodePoint(parseInt(dec)) || match;
            if (hex) return safeFromCodePoint(parseInt(hex, 16)) || match;
            if (named) return NAMED_ENTITIES[named] || match;
            return match;
        },
    );

// --- Inline Parsing Helpers ---

const findClosingBracket = (text: string, open: number): number => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "[") depth++;
        if (text[i] === "]") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
};

const findClosingParen = (text: string, open: number): number => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "(") depth++;
        if (text[i] === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
};

const findDelimiter = (text: string, start: number, delim: string): number => {
    for (let i = start; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "`") {
            const end = text.indexOf("`", i + 1);
            if (end !== -1) {
                i = end;
                continue;
            }
        }
        if (text.startsWith(delim, i)) return i;
    }
    return -1;
};

const findSingleDelimiter = (
    text: string,
    start: number,
    ch: string,
): number => {
    for (let i = start; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
            continue;
        }
        if (text[i] === "`") {
            const end = text.indexOf("`", i + 1);
            if (end !== -1) {
                i = end;
                continue;
            }
        }
        if (
            text[i] === ch &&
            (i === 0 || text[i - 1] !== ch) &&
            (i + 1 >= text.length || text[i + 1] !== ch)
        )
            return i;
    }
    return -1;
};

// --- Inline Parser ---

const parseInline = (
    text: string,
    comps: Components,
    depth: number = 0,
): React.ReactNode[] => {
    if (!text) return [];
    if (depth > MAX_NESTING_DEPTH) return [text];

    const brRe = /<br\s*\/?\s*>/iy;
    const autolinkRe =
        /(https?:\/\/[^\s<>\[\]]*[^\s<>\[\].,;:!?)\]}'"']|www\.[^\s<>\[\]]*[^\s<>\[\].,;:!?)\]}'"'])/iy;

    // Cache failed delimiter searches to avoid quadratic re-scanning.
    // If findDelimiter returned -1 starting from position X, any search
    // starting at Y >= X will also return -1.
    const noMatch: Record<string, number> = {};
    const findDel = (start: number, delim: string): number => {
        if (delim in noMatch && start >= noMatch[delim]) return -1;
        const r = findDelimiter(text, start, delim);
        if (r === -1 && (!(delim in noMatch) || start < noMatch[delim]))
            noMatch[delim] = start;
        return r;
    };
    const findSDel = (start: number, ch: string): number => {
        const key = `~${ch}`;
        if (key in noMatch && start >= noMatch[key]) return -1;
        const r = findSingleDelimiter(text, start, ch);
        if (r === -1 && (!(key in noMatch) || start < noMatch[key]))
            noMatch[key] = start;
        return r;
    };

    // Pre-scan for the last ] and ) positions to avoid O(n²) scans
    // when the text is full of unmatched [ or ( characters.
    const lastBracket = text.lastIndexOf("]");
    const lastParen = text.lastIndexOf(")");

    const result: React.ReactNode[] = [];
    let buf = "";
    let i = 0;
    let k = 0;

    const flush = () => {
        if (buf) {
            result.push(buf.includes("&") ? decodeEntities(buf) : buf);
            buf = "";
        }
    };

    const el = (
        tag: string,
        props: Record<string, any>,
        ...children: React.ReactNode[]
    ) => {
        const key = k++;
        const Comp = comps[tag];
        if (Comp)
            return children.length > 0
                ? React.createElement(
                      Comp,
                      { key, node: undefined, ...props },
                      ...children,
                  )
                : React.createElement(Comp, {
                      key,
                      node: undefined,
                      ...props,
                  });
        return children.length > 0
            ? React.createElement(tag, { key, ...props }, ...children)
            : React.createElement(tag, { key, ...props });
    };

    while (i < text.length) {
        const ch = text[i];

        // Escape
        if (
            ch === "\\" &&
            i + 1 < text.length &&
            "\\`*_~[]!|".includes(text[i + 1])
        ) {
            buf += text[i + 1];
            i += 2;
            continue;
        }

        // Hard line break: two+ spaces before newline
        if (ch === " " && text[i + 1] === " ") {
            let j = i + 2;
            while (j < text.length && text[j] === " ") j++;
            if (text[j] === "\n") {
                flush();
                result.push(React.createElement("br", { key: k++ }));
                i = j + 1;
                continue;
            }
        }

        // HTML <br>
        if (ch === "<") {
            brRe.lastIndex = i;
            const brMatch = brRe.exec(text);
            if (brMatch) {
                flush();
                result.push(React.createElement("br", { key: k++ }));
                i += brMatch[0].length;
                continue;
            }
        }

        // Image: ![alt](src)
        if (ch === "!" && text[i + 1] === "[" && lastBracket > i + 1) {
            const altEnd = findClosingBracket(text, i + 1);
            if (
                altEnd !== -1 &&
                text[altEnd + 1] === "(" &&
                lastParen > altEnd
            ) {
                const srcEnd = findClosingParen(text, altEnd + 1);
                if (srcEnd !== -1) {
                    const alt = text.slice(i + 2, altEnd);
                    const src = text.slice(altEnd + 2, srcEnd);
                    if (isSafeUrl(src)) {
                        flush();
                        result.push(
                            el("img", {
                                src,
                                alt,
                                referrerPolicy: "no-referrer",
                            }),
                        );
                    } else {
                        buf += text.slice(i, srcEnd + 1);
                    }
                    i = srcEnd + 1;
                    continue;
                }
            }
        }

        // Link: [text](url)
        if (ch === "[" && lastBracket > i) {
            const textEnd = findClosingBracket(text, i);
            if (
                textEnd !== -1 &&
                text[textEnd + 1] === "(" &&
                lastParen > textEnd
            ) {
                const urlEnd = findClosingParen(text, textEnd + 1);
                if (urlEnd !== -1) {
                    const linkText = text.slice(i + 1, textEnd);
                    const href = text.slice(textEnd + 2, urlEnd);
                    if (isSafeUrl(href)) {
                        flush();
                        const children = parseInline(
                            linkText,
                            comps,
                            depth + 1,
                        );
                        result.push(el("a", { href }, ...children));
                    } else {
                        buf += text.slice(i, urlEnd + 1);
                    }
                    i = urlEnd + 1;
                    continue;
                }
            }
        }

        // Autolink: bare URLs
        if (
            (text.startsWith("https://", i) ||
                text.startsWith("http://", i) ||
                text.startsWith("www.", i)) &&
            (i === 0 || " \t\n(".includes(text[i - 1]))
        ) {
            autolinkRe.lastIndex = i;
            const urlMatch = autolinkRe.exec(text);
            if (urlMatch) {
                flush();
                const url = urlMatch[1];
                const href = url.startsWith("www.") ? "https://" + url : url;
                result.push(el("a", { href }, url));
                i += url.length;
                continue;
            }
        }

        // Code span
        if (ch === "`") {
            let ticks = 0;
            let j = i;
            while (j < text.length && text[j] === "`") {
                ticks++;
                j++;
            }
            const closer = text.indexOf("`".repeat(ticks), j);
            if (closer !== -1) {
                flush();
                let code = text.slice(j, closer);
                if (
                    ticks > 1 &&
                    code.length > 1 &&
                    code[0] === " " &&
                    code[code.length - 1] === " "
                )
                    code = code.slice(1, -1);
                result.push(el("code", {}, code));
                i = closer + ticks;
                continue;
            }
            // No matching closer: emit backticks as literal text and skip past them
            buf += text.slice(i, j);
            i = j;
            continue;
        }

        // Bold + Italic: ***text***
        if (text.startsWith("***", i)) {
            const end = findDel(i + 3, "***");
            if (end !== -1) {
                flush();
                const inner = parseInline(
                    text.slice(i + 3, end),
                    comps,
                    depth + 1,
                );
                result.push(
                    React.createElement(
                        "strong",
                        { key: k++ },
                        React.createElement("em", { key: k++ }, ...inner),
                    ),
                );
                i = end + 3;
                continue;
            }
        }

        // Bold: **text**
        if (text.startsWith("**", i)) {
            const end = findDel(i + 2, "**");
            if (end !== -1) {
                flush();
                const inner = parseInline(
                    text.slice(i + 2, end),
                    comps,
                    depth + 1,
                );
                result.push(
                    React.createElement("strong", { key: k++ }, ...inner),
                );
                i = end + 2;
                continue;
            }
        }

        // Strikethrough: ~~text~~
        if (text.startsWith("~~", i)) {
            const end = findDel(i + 2, "~~");
            if (end !== -1) {
                flush();
                const inner = parseInline(
                    text.slice(i + 2, end),
                    comps,
                    depth + 1,
                );
                result.push(React.createElement("del", { key: k++ }, ...inner));
                i = end + 2;
                continue;
            }
        }

        // Strikethrough: ~text~
        if (ch === "~" && !text.startsWith("~~", i)) {
            const end = findSDel(i + 1, "~");
            if (end !== -1) {
                flush();
                const inner = parseInline(
                    text.slice(i + 1, end),
                    comps,
                    depth + 1,
                );
                result.push(React.createElement("del", { key: k++ }, ...inner));
                i = end + 1;
                continue;
            }
        }

        // Italic: *text*
        if (ch === "*" && !text.startsWith("**", i)) {
            const end = findSDel(i + 1, "*");
            if (end !== -1) {
                flush();
                const inner = parseInline(
                    text.slice(i + 1, end),
                    comps,
                    depth + 1,
                );
                result.push(React.createElement("em", { key: k++ }, ...inner));
                i = end + 1;
                continue;
            }
        }

        // Italic: _text_ (only at word boundary)
        if (
            ch === "_" &&
            !text.startsWith("__", i) &&
            (i === 0 || /\s/.test(text[i - 1]))
        ) {
            const end = findSDel(i + 1, "_");
            if (
                end !== -1 &&
                (end + 1 >= text.length || /[\s.,;:!?)\]}]/.test(text[end + 1]))
            ) {
                flush();
                const inner = parseInline(
                    text.slice(i + 1, end),
                    comps,
                    depth + 1,
                );
                result.push(React.createElement("em", { key: k++ }, ...inner));
                i = end + 1;
                continue;
            }
        }

        buf += ch;
        i++;
    }

    flush();
    return result;
};

// --- Block Parsing Helpers ---

const parseCells = (line: string): string[] => {
    const trimmed = line.replace(/^\||\|$/g, "");
    const cells: string[] = [];
    let buf = "";
    for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
            buf += "|";
            i++;
        } else if (trimmed[i] === "|") {
            cells.push(buf.trim());
            buf = "";
        } else {
            buf += trimmed[i];
        }
    }
    cells.push(buf.trim());
    return cells;
};

const parseAlignments = (line: string): (Alignment | null)[] =>
    line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => {
            const c = cell.trim();
            const left = c.startsWith(":");
            const right = c.endsWith(":");
            if (left && right) return "center";
            if (right) return "right";
            if (left) return "left";
            return null;
        });

const isBlockStart = (line: string, nextLine?: string): boolean => {
    const t = line.trim();
    if (/^#{1,6}\s/.test(t)) return true;
    if (/^(?:[-*_]\s*){3,}$/.test(t)) return true;
    if (t.startsWith("```") || t.startsWith("~~~")) return true;
    if (t.startsWith(">")) return true;
    if (/^[-*+] /.test(t)) return true;
    if (/^\d+[.)] /.test(t)) return true;
    if (
        t.startsWith("|") &&
        nextLine &&
        /^\|?\s*(?:-{3,}|:-{2,}|-{2,}:|:-+:)\s*(\|\s*(?:-{3,}|:-{2,}|-{2,}:|:-+:)\s*)*\|?\s*$/.test(
            nextLine.trim(),
        )
    )
        return true;
    if (/^<details[\s>]/i.test(t)) return true;
    return false;
};

// --- Block Parser ---

const parseBlocks = (input: string, depth: number = 0): Block[] => {
    if (depth > MAX_NESTING_DEPTH)
        return input ? [{ type: "paragraph", content: input }] : [];
    const lines = input.split("\n");
    const blocks: Block[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Empty line
        if (trimmed === "") {
            i++;
            continue;
        }

        // Fenced code block
        const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)/);
        if (fenceMatch) {
            const fence = fenceMatch[1][0].repeat(fenceMatch[1].length);
            const lang = fenceMatch[2].trim();
            const codeLines: string[] = [];
            i++;
            const fenceCloseRe =
                fence[0] === "`"
                    ? new RegExp(`^\`{${fence.length},}$`)
                    : new RegExp(`^~{${fence.length},}$`);
            while (i < lines.length) {
                if (fenceCloseRe.test(lines[i].trim())) {
                    i++;
                    break;
                }
                codeLines.push(lines[i]);
                i++;
            }
            blocks.push({ type: "code", lang, content: codeLines.join("\n") });
            continue;
        }

        // ATX heading
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
        if (headingMatch) {
            blocks.push({
                type: "heading",
                level: headingMatch[1].length,
                content: headingMatch[2],
            });
            i++;
            continue;
        }

        // Horizontal rule
        if (/^(?:[-*_]\s*){3,}$/.test(trimmed) && !/^[-*+] \S/.test(trimmed)) {
            blocks.push({ type: "hr" });
            i++;
            continue;
        }

        // Table
        if (trimmed.includes("|") && i + 1 < lines.length) {
            const nextTrimmed = lines[i + 1]?.trim() || "";
            if (
                /^\|?\s*(?:-{3,}|:-{2,}|-{2,}:|:-+:)\s*(\|\s*(?:-{3,}|:-{2,}|-{2,}:|:-+:)\s*)*\|?\s*$/.test(
                    nextTrimmed,
                )
            ) {
                const headers = parseCells(line).slice(0, MAX_TABLE_COLUMNS);
                const aligns = parseAlignments(lines[i + 1]).slice(
                    0,
                    MAX_TABLE_COLUMNS,
                );
                const rows: string[][] = [];
                i += 2;
                while (
                    i < lines.length &&
                    lines[i].trim() !== "" &&
                    lines[i].includes("|") &&
                    rows.length < MAX_TABLE_ROWS
                ) {
                    rows.push(parseCells(lines[i]).slice(0, MAX_TABLE_COLUMNS));
                    i++;
                }
                blocks.push({ type: "table", headers, aligns, rows });
                continue;
            }
        }

        // Blockquote
        if (trimmed.startsWith(">")) {
            const quoteLines: string[] = [];
            while (i < lines.length) {
                const t = lines[i].trim();
                if (t.startsWith("> ")) quoteLines.push(t.slice(2));
                else if (t === ">") quoteLines.push("");
                else if (t.startsWith(">")) quoteLines.push(t.slice(1));
                else break;
                i++;
            }
            blocks.push({
                type: "blockquote",
                blocks: parseBlocks(quoteLines.join("\n"), depth + 1),
            });
            continue;
        }

        // List
        const listMatch = line.match(/^(\s*)([-*+]|\d+[.)]) /);
        if (listMatch) {
            const ordered = /\d/.test(listMatch[2]);
            const startNum = ordered ? parseInt(listMatch[2]) : 1;
            const baseIndent = listMatch[1].length;
            const markerLen = listMatch[2].length + 1;
            const continuationRe = new RegExp(
                `^\\s{${baseIndent}}([-*+]|\\d+[.)]) `,
            );
            const items: string[][] = [];
            let currentItem: string[] = [];

            while (i < lines.length && items.length < MAX_LIST_ITEMS) {
                const li = lines[i];
                const itemMatch = li.match(/^(\s*)([-*+]|\d+[.)]) (.*)/);
                if (itemMatch && itemMatch[1].length === baseIndent) {
                    if (currentItem.length) items.push([...currentItem]);
                    currentItem = [itemMatch[3]];
                    i++;
                } else if (li.trim() === "") {
                    if (
                        i + 1 < lines.length &&
                        continuationRe.test(lines[i + 1])
                    ) {
                        currentItem.push("");
                        i++;
                        continue;
                    }
                    break;
                } else if (
                    li.length > baseIndent + markerLen &&
                    /^\s+/.test(li) &&
                    li.search(/\S/) >= baseIndent + markerLen
                ) {
                    currentItem.push(li.slice(baseIndent + markerLen));
                    i++;
                } else {
                    break;
                }
            }
            if (currentItem.length) items.push(currentItem);
            blocks.push({
                type: "list",
                ordered,
                start: startNum,
                items: items.map((ls) => parseBlocks(ls.join("\n"), depth + 1)),
            });
            continue;
        }

        // Details/Summary
        if (/^<details[\s>]/i.test(trimmed)) {
            const contentLines: string[] = [trimmed];
            i++;
            while (i < lines.length) {
                contentLines.push(lines[i]);
                if (/<\/details\s*>/i.test(lines[i])) {
                    i++;
                    break;
                }
                i++;
            }
            const raw = contentLines.join("\n");
            const summaryMatch = raw.match(
                /<summary[^>]*>([\s\S]*?)<\/summary\s*>/i,
            );
            const summary = summaryMatch ? summaryMatch[1].trim() : "";
            let inner = raw
                .replace(/<\/?details[^>]*>/gi, "")
                .replace(/<summary[^>]*>[\s\S]*?<\/summary\s*>/i, "")
                .trim();
            blocks.push({
                type: "details",
                summary,
                blocks: parseBlocks(inner, depth + 1),
            });
            continue;
        }

        // Paragraph
        const paraLines: string[] = [];
        while (
            i < lines.length &&
            lines[i].trim() !== "" &&
            !isBlockStart(lines[i], lines[i + 1])
        ) {
            paraLines.push(lines[i]);
            i++;
        }
        if (paraLines.length) {
            blocks.push({
                type: "paragraph",
                content: paraLines.join("\n"),
            });
        } else {
            i++;
        }
    }

    return blocks;
};

// --- Block Renderer ---

const renderBlock = (
    block: Block,
    comps: Components,
    key: number,
): React.ReactNode => {
    const el = (
        tag: string,
        props: Record<string, any>,
        ...children: React.ReactNode[]
    ) => {
        const Comp = comps[tag];
        if (Comp)
            return children.length > 0
                ? React.createElement(
                      Comp,
                      { key, node: undefined, ...props },
                      ...children,
                  )
                : React.createElement(Comp, {
                      key,
                      node: undefined,
                      ...props,
                  });
        return children.length > 0
            ? React.createElement(tag, { key, ...props }, ...children)
            : React.createElement(tag, { key, ...props });
    };

    switch (block.type) {
        case "heading": {
            const tag = `h${block.level}` as string;
            const children = parseInline(block.content, comps);
            return el(tag, {}, ...children);
        }
        case "paragraph": {
            const children = parseInline(block.content, comps);
            return el("p", {}, ...children);
        }
        case "code":
            return React.createElement(
                "pre",
                { key },
                React.createElement(
                    "code",
                    block.lang
                        ? {
                              className: `language-${block.lang.replace(/[^a-zA-Z0-9_-]/g, "")}`,
                          }
                        : undefined,
                    block.content,
                ),
            );
        case "blockquote":
            return el(
                "blockquote",
                {},
                ...block.blocks.map((b, i) => renderBlock(b, comps, i)),
            );
        case "hr":
            return el("hr", {});
        case "list": {
            const tag = block.ordered ? "ol" : "ul";
            const listProps: any = {};
            if (block.ordered && block.start !== 1)
                listProps.start = block.start;
            return React.createElement(
                tag,
                { key, ...listProps },
                block.items.map((itemBlocks, i) => {
                    // Task list detection
                    const first = itemBlocks[0];
                    let taskChecked: boolean | null = null;
                    let adjustedBlocks = itemBlocks;
                    if (first && first.type === "paragraph") {
                        const cbMatch =
                            first.content.match(/^\[([ xX])\]\s(.*)/s);
                        if (cbMatch) {
                            taskChecked = cbMatch[1] !== " ";
                            adjustedBlocks = [
                                {
                                    type: "paragraph" as const,
                                    content: cbMatch[2],
                                },
                                ...itemBlocks.slice(1),
                            ];
                        }
                    }
                    const liChildren = adjustedBlocks.map((b, j) => {
                        if (
                            adjustedBlocks.length === 1 &&
                            b.type === "paragraph"
                        )
                            return React.createElement(
                                React.Fragment,
                                { key: j },
                                ...parseInline(b.content, comps),
                            );
                        return renderBlock(b, comps, j);
                    });
                    if (taskChecked !== null) {
                        liChildren.unshift(
                            React.createElement("input", {
                                key: "cb",
                                type: "checkbox",
                                checked: taskChecked,
                                disabled: true,
                                readOnly: true,
                            }),
                            " ",
                        );
                    }
                    return React.createElement("li", { key: i }, ...liChildren);
                }),
            );
        }
        case "details":
            return React.createElement(
                "details",
                { key },
                React.createElement(
                    "summary",
                    null,
                    ...parseInline(block.summary, comps),
                ),
                ...block.blocks.map((b, i) => renderBlock(b, comps, i)),
            );
        case "table":
            return React.createElement(
                "table",
                { key },
                React.createElement(
                    "thead",
                    null,
                    React.createElement(
                        "tr",
                        null,
                        block.headers.map((h, i) =>
                            React.createElement(
                                "th",
                                {
                                    key: i,
                                    style: block.aligns[i]
                                        ? { textAlign: block.aligns[i]! }
                                        : undefined,
                                },
                                ...parseInline(h, comps),
                            ),
                        ),
                    ),
                ),
                React.createElement(
                    "tbody",
                    null,
                    block.rows.map((row, ri) =>
                        React.createElement(
                            "tr",
                            { key: ri },
                            row.map((cell, ci) =>
                                React.createElement(
                                    "td",
                                    {
                                        key: ci,
                                        style: block.aligns[ci]
                                            ? { textAlign: block.aligns[ci]! }
                                            : undefined,
                                    },
                                    ...parseInline(cell, comps),
                                ),
                            ),
                        ),
                    ),
                ),
            );
    }
};

// --- Component ---

const Markdown = ({
    children,
    components = EMPTY_COMPONENTS,
}: MarkdownProps) => {
    try {
        const blocks = parseBlocks(children || "");
        return (
            <>{blocks.map((block, i) => renderBlock(block, components, i))}</>
        );
    } catch {
        return <pre>{children}</pre>;
    }
};

export default Markdown;
