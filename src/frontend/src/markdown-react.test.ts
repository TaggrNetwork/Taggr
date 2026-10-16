import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "./markdown-react.ts";

const render = (md: string): string =>
    renderToStaticMarkup(React.createElement(Markdown, { children: md }));

test("spaced markers render as a thematic break", () => {
    assert.match(render("---"), /<hr\s*\/?>/);
    assert.match(render("* * *"), /<hr\s*\/?>/);
});

test("underscore emphasis is detected after punctuation", () => {
    assert.match(render("(_hi_)"), /\(<em>hi<\/em>\)/);
});

test("underscore inside a word stays literal", () => {
    assert.equal(render("foo_bar_baz"), "<p>foo_bar_baz</p>");
});

test("emphasis delimiter search skips multi-backtick code spans", () => {
    assert.equal(
        render("*a ``x*y`` b*"),
        "<p><em>a <code>x*y</code> b</em></p>",
    );
});

test("link destination entities are decoded before rendering", () => {
    assert.equal(
        render("[x](https://e.com/?a&#38;b)"),
        '<p><a href="https://e.com/?a&amp;b">x</a></p>',
    );
});

test("entity-encoded javascript URL is rejected", () => {
    const html = render("[x](&#106;avascript:alert&#40;1&#41;)");
    assert.doesNotMatch(html, /<a[\s>]/);
    assert.match(html, /javascript:alert\(1\)/);
});

test("table columns are parsed consistently", () => {
    assert.match(render("| a | b |\n| --- | :---: |\n| 1 | 2 |"), /<table>/);
});

test("component overrides receive props and children", () => {
    const html = renderToStaticMarkup(
        React.createElement(Markdown, {
            children: "hi [there](https://e.com)",
            components: {
                a: ({ node, children, ...props }: any) =>
                    React.createElement(
                        "a",
                        { ...props, "data-x": "1" },
                        children,
                    ),
            },
        }),
    );
    assert.equal(
        html,
        '<p>hi <a href="https://e.com" data-x="1">there</a></p>',
    );
});
