import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown } from "./markdown.ts";

test("emphasis nests inside strong", () => {
    assert.deepEqual(parseInline("***x***"), [
        {
            type: "strong",
            children: [
                { type: "em", children: [{ type: "text", value: "x" }] },
            ],
        },
    ]);
});

test("links carry href and parsed children", () => {
    assert.deepEqual(parseInline("[a *b*](https://e.com)"), [
        {
            type: "link",
            href: "https://e.com",
            children: [
                { type: "text", value: "a " },
                { type: "em", children: [{ type: "text", value: "b" }] },
            ],
        },
    ]);
});

test("unsafe URL stays literal text", () => {
    assert.deepEqual(parseInline("[x](javascript:alert(1))"), [
        { type: "text", value: "[x](javascript:alert(1))" },
    ]);
});

test("link and text entities are decoded", () => {
    assert.deepEqual(parseInline("[x](https://e.com/?a&#38;b) &amp; y"), [
        {
            type: "link",
            href: "https://e.com/?a&b",
            children: [{ type: "text", value: "x" }],
        },
        { type: "text", value: " & y" },
    ]);
});

test("block content is parsed into inline nodes", () => {
    assert.deepEqual(parseMarkdown("hello *world*"), [
        {
            type: "paragraph",
            content: [
                { type: "text", value: "hello " },
                { type: "em", children: [{ type: "text", value: "world" }] },
            ],
        },
    ]);
});

test("table cells become inline nodes", () => {
    assert.deepEqual(parseMarkdown("| a |\n| --- |\n| *b* |"), [
        {
            type: "table",
            headers: [[{ type: "text", value: "a" }]],
            aligns: [null],
            rows: [
                [[{ type: "em", children: [{ type: "text", value: "b" }] }]],
            ],
        },
    ]);
});
