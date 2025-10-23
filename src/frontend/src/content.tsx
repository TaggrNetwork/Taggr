import * as React from "react";
import { ArrowDown } from "./common";
import { BlogTitle } from "./types";
import { Markdown } from "./markdown";

export const CUT = "\n\n\n\n";

const linkOrImageExp = /(!?\[.*?\]\(.*?\)|```.+?```|`.+?`)/gs;
const linkTagsAndUsers = (mdString: string) =>
    mdString
        .split(linkOrImageExp)
        .map((part) => {
            if (part.match(linkOrImageExp)) return part;
            return linkTagsAndUsersPart(part);
        })
        .join("");

const linkTokenExp =
    /(?<=\s|\(|^)(\/|\$[\p{Letter}\p{Mark}]|#|@)[\p{Letter}\p{Mark}|\d|\-|_|\.]*[\p{Letter}\p{Mark}|\d]/gu;
const linkTagsAndUsersPart = (value: string) => {
    const result = [];
    let match;
    let lastPos = 0;

    const tokenToHandle: { [token: string]: string } = {
        "@": "user",
        "#": "feed",
        $: "feed",
        "/": "realm",
    };

    while ((match = linkTokenExp.exec(value)) !== null) {
        result.push(value.slice(lastPos, match.index));
        let token = match[0];
        result.push(
            `[${token}](#/${tokenToHandle[token[0]]}/${token.slice(1)})`,
        );
        lastPos = linkTokenExp.lastIndex;
    }
    result.push(value.slice(lastPos));
    return result.join("");
};

export const Content = ({
    post,
    blogTitle,
    value = "",
    urls,
    collapse,
    preview,
    primeMode,
    classNameArg,
}: {
    post?: boolean;
    blogTitle?: BlogTitle;
    value: string;
    urls?: { [id: string]: string };
    collapse?: boolean;
    preview?: boolean;
    primeMode?: boolean;
    classNameArg?: string;
}) => {
    const linkedValue = React.useMemo(() => linkTagsAndUsers(value), [value]);

    if (!post)
        return (
            <Markdown
                classNameArg={`selectable ${classNameArg}`}
                preview={preview}
            >
                {linkedValue}
            </Markdown>
        );

    let cutPos = linkedValue.indexOf(CUT);
    let shortened = cutPos >= 0;
    let extValue: string = "";
    let processedValue = linkedValue;

    if (shortened) {
        extValue = linkedValue.slice(cutPos + CUT.length);
        processedValue = linkedValue.slice(0, cutPos);
        if (preview) processedValue += "\n\n- - -\n\n";
    }
    const complexPost = ["# ", "## ", "!["].some((pref) =>
        processedValue.startsWith(pref),
    );
    const lines = processedValue.split("\n");
    const words = processedValue.split(" ").length;
    let className = classNameArg || "";
    if (primeMode && lines.length < 10 && !complexPost) {
        if (words < 50) className += " x_large_text";
        else if (words < 100) className += " enlarged_text";
    }
    const multipleHeaders =
        lines.filter((line) => line.startsWith("# ")).length > 1;

    return React.useMemo(
        () => (
            <>
                <Markdown
                    classNameArg={`selectable ${className}`}
                    urls={urls || {}}
                    blogTitle={multipleHeaders ? undefined : blogTitle}
                    preview={preview}
                >
                    {processedValue}
                </Markdown>
                {shortened &&
                    (collapse ? (
                        <ArrowDown />
                    ) : (
                        <Markdown
                            classNameArg="selectable"
                            urls={urls || {}}
                            preview={preview}
                        >
                            {extValue}
                        </Markdown>
                    ))}
            </>
        ),
        [
            processedValue,
            extValue,
            urls,
            collapse,
            blogTitle,
            multipleHeaders,
            preview,
            className,
            shortened,
        ],
    );
};
