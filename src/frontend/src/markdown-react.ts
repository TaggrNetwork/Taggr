// React binding for the framework-agnostic parser in `markdown.ts`. Maps the
// AST to React elements and applies caller-provided component overrides.
import * as React from "react";
import { parseMarkdown } from "#markdown";
import type { Block, Inline } from "#markdown";

export interface Components {
    [key: string]: React.ComponentType<any>;
}

interface MarkdownProps {
    children: string;
    components?: Components;
}

const EMPTY_COMPONENTS: Components = {};

type El = (
    tag: string,
    props: Record<string, any>,
    key: React.Key,
    ...children: React.ReactNode[]
) => React.ReactNode;

// Builds an element for `tag`, honouring a caller-provided component override.
// `node: undefined` keeps the react-markdown-style `{ node, ...props }` handler
// signature used by consumers.
const makeEl =
    (comps: Components): El =>
    (tag, props, key, ...children) => {
        const Comp = comps[tag];
        if (Comp)
            return children.length > 0
                ? React.createElement(
                      Comp,
                      { key, node: undefined, ...props },
                      ...children,
                  )
                : React.createElement(Comp, { key, node: undefined, ...props });
        return children.length > 0
            ? React.createElement(tag, { key, ...props }, ...children)
            : React.createElement(tag, { key, ...props });
    };

const renderInline = (nodes: Inline[], el: El): React.ReactNode[] =>
    nodes.map((node, i) => {
        switch (node.type) {
            case "text":
                return node.value;
            case "br":
                return el("br", {}, i);
            case "code":
                return el("code", {}, i, node.value);
            case "strong":
                return el("strong", {}, i, ...renderInline(node.children, el));
            case "em":
                return el("em", {}, i, ...renderInline(node.children, el));
            case "del":
                return el("del", {}, i, ...renderInline(node.children, el));
            case "link":
                return el(
                    "a",
                    { href: node.href },
                    i,
                    ...renderInline(node.children, el),
                );
            case "image":
                return el(
                    "img",
                    {
                        src: node.src,
                        alt: node.alt,
                        referrerPolicy: "no-referrer",
                    },
                    i,
                );
            default:
                return null;
        }
    });

const renderItem = (item: Block[], el: El, key: React.Key): React.ReactNode => {
    const first = item[0];
    let taskChecked: boolean | null = null;
    let adjusted = item;
    if (first && first.type === "paragraph" && first.content.length > 0) {
        const head = first.content[0];
        if (head.type === "text") {
            const cbMatch = head.value.match(/^\[([ xX])\]\s(.*)/s);
            if (cbMatch) {
                taskChecked = cbMatch[1] !== " ";
                const rest = cbMatch[2];
                const content: Inline[] = rest
                    ? [{ type: "text", value: rest }, ...first.content.slice(1)]
                    : first.content.slice(1);
                adjusted = [{ ...first, content }, ...item.slice(1)];
            }
        }
    }
    const children = adjusted.map((b, j) => {
        if (adjusted.length === 1 && b.type === "paragraph")
            return React.createElement(
                React.Fragment,
                { key: j },
                ...renderInline(b.content, el),
            );
        return renderBlock(b, el, j);
    });
    if (taskChecked !== null) {
        children.unshift(
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
    return React.createElement("li", { key }, ...children);
};

const renderBlock = (block: Block, el: El, key: React.Key): React.ReactNode => {
    switch (block.type) {
        case "heading":
            return el(
                `h${block.level}`,
                {},
                key,
                ...renderInline(block.content, el),
            );
        case "paragraph":
            return el("p", {}, key, ...renderInline(block.content, el));
        case "code":
            if (block.lang === "pgp")
                return el(
                    "div",
                    { className: "pgp_block" },
                    key,
                    el("code", { className: "language-pgp" }, 0, block.content),
                );
            return el(
                "pre",
                {},
                key,
                el(
                    "code",
                    block.lang
                        ? {
                              className: `language-${block.lang.replace(/[^a-zA-Z0-9_-]/g, "")}`,
                          }
                        : {},
                    0,
                    block.content,
                ),
            );
        case "blockquote":
            return el(
                "blockquote",
                {},
                key,
                ...block.blocks.map((b, i) => renderBlock(b, el, i)),
            );
        case "hr":
            return el("hr", {}, key);
        case "list": {
            const tag = block.ordered ? "ol" : "ul";
            const listProps: Record<string, any> = {};
            if (block.ordered && block.start !== 1)
                listProps.start = block.start;
            return el(
                tag,
                listProps,
                key,
                ...block.items.map((item, i) => renderItem(item, el, i)),
            );
        }
        case "details":
            return el(
                "details",
                {},
                key,
                el(
                    "summary",
                    {},
                    "summary",
                    ...renderInline(block.summary, el),
                ),
                ...block.blocks.map((b, i) => renderBlock(b, el, i)),
            );
        case "table":
            return el(
                "table",
                {},
                key,
                el(
                    "thead",
                    {},
                    "thead",
                    el(
                        "tr",
                        {},
                        0,
                        ...block.headers.map((h, i) =>
                            el(
                                "th",
                                block.aligns[i]
                                    ? { style: { textAlign: block.aligns[i]! } }
                                    : {},
                                i,
                                ...renderInline(h, el),
                            ),
                        ),
                    ),
                ),
                el(
                    "tbody",
                    {},
                    "tbody",
                    ...block.rows.map((row, ri) =>
                        el(
                            "tr",
                            {},
                            ri,
                            ...row.map((cell, ci) =>
                                el(
                                    "td",
                                    block.aligns[ci]
                                        ? {
                                              style: {
                                                  textAlign: block.aligns[ci]!,
                                              },
                                          }
                                        : {},
                                    ci,
                                    ...renderInline(cell, el),
                                ),
                            ),
                        ),
                    ),
                ),
            );
        default:
            return null;
    }
};

const Markdown = ({
    children,
    components = EMPTY_COMPONENTS,
}: MarkdownProps) => {
    try {
        const blocks = parseMarkdown(children || "");
        const el = makeEl(components);
        return React.createElement(
            React.Fragment,
            null,
            ...blocks.map((block, i) => renderBlock(block, el, i)),
        );
    } catch {
        return React.createElement("pre", null, children);
    }
};

export default Markdown;
