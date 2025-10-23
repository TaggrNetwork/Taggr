import * as React from "react";
import { domain, RealmSpan, timeAgo } from "./common";
import { BlogTitle } from "./types";
import { previewImg } from "./image_preview";

/**
 * Props for the Markdown component
 * @property classNameArg - Optional CSS class name to apply to the container
 * @property children - The markdown text to parse and render
 * @property urls - Map of blob IDs to their actual URLs for internal images
 * @property blogTitle - Optional blog metadata to render with the first H1
 * @property preview - Whether to render in preview mode (affects YouTube embeds)
 */
interface MarkdownProps {
    classNameArg?: string;
    children: string;
    urls?: { [id: string]: string };
    blogTitle?: BlogTitle;
    preview?: boolean;
}

/**
 * Represents a node in the inline parsing tree - either plain text or a JSX element
 */
type InlineNode = string | JSX.Element;

/**
 * Tiny transparent placeholder image used when actual image data isn't loaded yet
 */
const fillerImg =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAQAAAAe/WZNAAAAEElEQVR42mNkMGYAA0YMBgAJ4QCdD/t7zAAAAABJRU5ErkJggg==";

/**
 * Extracts and sets image dimensions from the alt text or uses defaults
 * Expected alt text format: "description 300x200" where 300x200 are width x height
 * @param props - Image props object to modify with width and height
 */
const setDimensions = (props: any) => {
    const maxHeight = Math.ceil(window.innerHeight / 3);
    const [width, height] = (props.alt.match(/\d+x\d+/) || [
        `${window.innerWidth}x${maxHeight}`,
    ])[0].split("x");
    props.width = parseInt(width);
    props.height = Math.min(maxHeight, parseInt(height));
};

/**
 * YouTube video embed component with lazy loading support
 * In preview mode, shows a clickable "YouTube" label that expands to the full iframe
 * @param id - YouTube video ID (e.g., "dQw4w9WgXcQ")
 * @param preview - If true, starts collapsed and requires click to load iframe
 */
const YouTube = ({ id, preview }: { id: string; preview?: boolean }) => {
    const [open, setOpen] = React.useState(!preview);
    if (open)
        return (
            <span className="video-container" style={{ display: "block" }}>
                <iframe
                    loading="lazy"
                    allowFullScreen={true}
                    referrerPolicy="origin"
                    src={`https://youtube.com/embed/${id}`}
                ></iframe>
            </span>
        );
    return (
        <span
            data-meta="skipClicks"
            className="yt_preview"
            onClick={() => setOpen(true)}
        >
            YouTube
        </span>
    );
};

/**
 * Gallery component for displaying multiple images with thumbnail navigation
 * Separates image elements from non-image content and renders:
 * - First image in full size gallery view
 * - Thumbnails of all images for navigation (if more than one)
 * - Any non-image content in a paragraph below
 * @param children - Array of child elements (mix of images and other content)
 */
const Gallery = React.memo(({ children }: any) => {
    let pictures = children.filter((c: any) => c.type && c.type.name == "img");
    if (pictures.length === 0) return null;

    const urls = pictures.map((pic: any) =>
        pic.props.src.replace("/blob/", ""),
    );
    const nonPictures = children.filter(
        (c: any) => !c.type || c.type.name != "img",
    );
    return (
        <>
            <div className="gallery">
                {React.cloneElement(pictures[0], { gallery: urls })}
            </div>
            {pictures.length > 1 && (
                <div
                    data-meta="skipClicks"
                    className="thumbnails row_container"
                >
                    {pictures.map((picture: JSX.Element, idx: number) =>
                        React.cloneElement(picture, {
                            key: idx,
                            thumbnail: "true",
                            gallery: urls,
                            alt: "",
                        }),
                    )}
                </div>
            )}
            {nonPictures.length > 0 && <p>{nonPictures}</p>}
        </>
    );
});

/**
 * Splits a mixed array of elements into separate paragraphs and images
 * Images that appear mid-paragraph will be extracted and rendered separately,
 * with text before and after split into separate paragraph elements
 * @param elems - Array of JSX elements to split
 * @param isPic - Predicate function to identify image elements
 * @returns Array with images separated from text paragraphs
 */
const splitParagraphsAndPics = (
    elems: JSX.Element[],
    isPic: (arg: JSX.Element) => boolean,
) => {
    const result = [];
    let chunk = [];
    for (let i = 0; i < elems.length; i++) {
        const elem = elems[i];
        if (isPic(elem)) {
            if (chunk.length) result.push(<p key={i}>{chunk}</p>);
            result.push(elem);
            chunk = [];
        } else {
            chunk.push(elem);
        }
    }
    if (chunk.length) result.push(<p key={"last"}>{chunk}</p>);
    return result;
};

const URL_REGEX = /^https?:\/\/.+$/;
const WWW_REGEX = /^www\..+$/;
const YOUTUBE_REGEX =
    /https:\/\/(www\.)?(youtu.be\/|youtube.com\/watch\?v=)([a-zA-Z0-9\-_]+)/;

/**
 * Checks if a string looks like a URL
 * @param val - String to test
 * @returns true if string starts with http://, https://, or www.
 */
const isALink = (val: string) => URL_REGEX.test(val) || WWW_REGEX.test(val);

/**
 * Creates a link renderer function with preview mode support
 * Handles special cases:
 * - YouTube links -> converts to YouTube component
 * - Internal domain links -> converts to hash routes
 * - External links -> adds nofollow/noopener and shows hostname
 * - Relative links -> prefixes with #
 * @param preview - Whether to render in preview mode
 * @returns Function that renders link elements
 */
const createLinkRenderer =
    (preview?: boolean) => (props: { href: string; children: any }) => {
        let className: string | undefined = undefined;
        let label: string = props.children;
        let child: string = props.children;
        let href = props.href;

        if (typeof child == "string") {
            const matches = child.match(YOUTUBE_REGEX);
            if (matches) {
                const id = matches[3];
                return id ? <YouTube id={id} preview={preview} /> : null;
            }

            if (isALink(child) || isALink(href)) {
                try {
                    const url = new URL(href);

                    if (
                        url.hostname == domain() ||
                        Object.keys(window.backendCache.domains).includes(
                            url.hostname,
                        )
                    ) {
                        const nonMarkdownLink = label == url.href;
                        let link = url.href.replace(url.origin + "/", "");
                        href = (link.startsWith("#") ? "" : "#/") + link;
                        if (nonMarkdownLink) label = href.replace("#", "");
                    } else if (child == href.replace(/&amp;/g, "&")) {
                        className = "external";
                        label = url.hostname.toUpperCase() as any;
                        return (
                            <a
                                className={className}
                                href={href}
                                rel="nofollow noopener noreferrer"
                                target="_blank"
                            >
                                {label}
                            </a>
                        );
                    } else {
                        label = child;
                    }
                } catch (e) {}
            } else if (href.startsWith("/")) {
                href = "#" + href.replace("/#/", "/");
            }
        }

        return (
            <a className={className} href={href}>
                {label}
            </a>
        );
    };

/**
 * Creates an image renderer function
 * Handles two types of images:
 * - Internal images (/blob/ID) -> looks up actual URL from urls map
 * - External images (full URLs) -> wraps in container with URL bar showing source
 * @param urls - Map of blob IDs to actual image URLs
 * @returns Function that renders image elements with click-to-preview support
 */
const createImageRenderer =
    (urls: { [id: string]: string }) =>
    (props: { src: string; alt: string; [key: string]: any }) => {
        let src = props.src.replace(/&amp;/g, "&");
        let srcUrl;
        let id: string = src;
        let internal = false;
        const imgProps = { ...props };

        if (src.startsWith("/blob/")) {
            internal = true;
            id = src.replace("/blob/", "");
            if (id in urls) {
                src = urls[id];
            } else {
                setDimensions(imgProps);
                src = fillerImg;
            }
        } else {
            try {
                srcUrl = new URL(src);
            } catch (_) {
                return null;
            }
        }

        imgProps.src = src;

        const element = (
            <img
                {...imgProps}
                onClick={() => previewImg(src, id, imgProps.gallery, urls)}
            />
        );

        return internal || props.thumbnail == "true" ? (
            element
        ) : (
            <div className="text_centered">
                {element}
                <span className="external_image_bar">
                    URL:{" "}
                    <a rel="nofollow noopener noreferrer" href={src}>
                        {srcUrl?.host}
                    </a>
                </span>
            </div>
        );
    };

/**
 * Creates a paragraph renderer that handles image galleries
 * Logic:
 * - If paragraph starts with image(s) -> render as Gallery
 * - If paragraph contains mixed content -> split images from text
 * - Otherwise -> render as normal paragraph
 * @returns Function that renders paragraph elements with smart image handling
 */
const createParagraphRenderer = () => (props: { children: any }) => {
    const isPic = (c: any) => c.type && c.type.name == "img";

    if (Array.isArray(props.children)) {
        const pics = props.children.filter(isPic).length;
        if (pics >= 1 && isPic(props.children[0]))
            return <Gallery children={props.children} />;
        else return <>{splitParagraphsAndPics(props.children, isPic)}</>;
    } else if (isPic(props.children))
        return <Gallery children={[props.children]} />;

    return <p>{props.children}</p>;
};

/**
 * Creates an H1 renderer with optional blog metadata
 * If blogTitle is provided, adds a metadata line below the heading with:
 * - Author name with link to their journal
 * - Publication timestamp
 * - Realm tag (if assigned)
 * - Estimated reading time (400 words per minute)
 * @param blogTitle - Optional blog metadata to display
 * @returns Function that renders H1 elements with optional metadata
 */
const createH1Renderer =
    (blogTitle?: BlogTitle) => (props: { children: any }) => {
        if (!blogTitle) return <h1>{props.children}</h1>;

        let { author, created, length, realm, background } = blogTitle;
        return (
            <>
                <h1>{props.children}</h1>
                <p className="blog_title medium_text vertically_spaced">
                    By <a href={`#/journal/${author}`}>{author}</a>
                    &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                    <b>{timeAgo(created, true, "long")}</b>
                    {realm && (
                        <>
                            &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                            <RealmSpan
                                name={realm}
                                background={background}
                                classNameArg="realm_tag"
                                styleArg={{
                                    borderRadius: "5px",
                                }}
                            />
                        </>
                    )}
                    &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                    {Math.ceil(length / 400)} minutes read
                </p>
            </>
        );
    };

const INLINE_CODE_REGEX = /^`([^`]+)`/;
const BOLD_REGEX = /^\*\*([^*]+)\*\*/;
const ITALIC_REGEX = /^_([^_]+)_/;
const STRIKETHROUGH_REGEX = /^~([^~]+)~/;
const IMAGE_REGEX = /^!\[([^\]]*)\]\(([^)]+)\)/;
const LINK_REGEX = /^\[([^\]]+)\]\(([^)]+)\)/;
const PLAIN_URL_REGEX = /^(https?:\/\/[^\s]+)/;
const PLAIN_WWW_REGEX = /^(www\.[^\s]+)/;

/**
 * Parses inline markdown syntax (within a line) into React elements
 * Supported syntax (in order of precedence):
 * - `code` -> <code>
 * - **bold** -> <strong>
 * - _italic_ -> <em>
 * - ~strikethrough~ -> <del>
 * - ![alt](src) -> <img>
 * - [text](url) -> <a>
 * - Plain URLs (http://, https://, www.) -> <a>
 * - Plain text
 *
 * Uses a single-pass greedy parser that processes the string from left to right
 * @param text - The text to parse
 * @param urls - Map of blob IDs to image URLs
 * @param preview - Whether to render in preview mode
 * @returns Array of text strings and JSX elements
 */
const parseInline = (
    text: string,
    urls: { [id: string]: string },
    preview?: boolean,
): InlineNode[] => {
    const result: InlineNode[] = [];
    let current = text;
    let key = 0;

    const linkRenderer = createLinkRenderer(preview);
    const imageRenderer = createImageRenderer(urls);

    while (current.length > 0) {
        let match;

        if ((match = current.match(INLINE_CODE_REGEX))) {
            result.push(<code key={key++}>{match[1]}</code>);
            current = current.slice(match[0].length);
            continue;
        }

        if ((match = current.match(BOLD_REGEX))) {
            result.push(
                <strong key={key++}>
                    {parseInline(match[1], urls, preview)}
                </strong>,
            );
            current = current.slice(match[0].length);
            continue;
        }

        if ((match = current.match(ITALIC_REGEX))) {
            result.push(
                <em key={key++}>{parseInline(match[1], urls, preview)}</em>,
            );
            current = current.slice(match[0].length);
            continue;
        }

        if ((match = current.match(STRIKETHROUGH_REGEX))) {
            result.push(
                <del key={key++}>{parseInline(match[1], urls, preview)}</del>,
            );
            current = current.slice(match[0].length);
            continue;
        }

        if ((match = current.match(IMAGE_REGEX))) {
            const element = imageRenderer({ src: match[2], alt: match[1] });
            if (element)
                result.push(React.cloneElement(element, { key: key++ }));
            current = current.slice(match[0].length);
            continue;
        }

        if ((match = current.match(LINK_REGEX))) {
            const element = linkRenderer({
                href: match[2],
                children: parseInline(match[1], urls, preview),
            });
            if (element)
                result.push(React.cloneElement(element, { key: key++ }));
            current = current.slice(match[0].length);
            continue;
        }

        if ((match = current.match(PLAIN_URL_REGEX))) {
            const element = linkRenderer({
                href: match[1],
                children: match[1],
            });
            if (element)
                result.push(React.cloneElement(element, { key: key++ }));
            current = current.slice(match[0].length);
            continue;
        }

        if ((match = current.match(PLAIN_WWW_REGEX))) {
            const element = linkRenderer({
                href: match[1],
                children: match[1],
            });
            if (element)
                result.push(React.cloneElement(element, { key: key++ }));
            current = current.slice(match[0].length);
            continue;
        }

        result.push(current[0]);
        current = current.slice(1);
    }

    return result;
};

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const UNORDERED_LIST_REGEX = /^[-*+]\s/;
const ORDERED_LIST_REGEX = /^\d+\.\s/;
const HR_REGEX = /^(---+|\*\*\*+|___+)$/;
const TABLE_ROW_REGEX = /^\|(.+)\|$/;
const TABLE_SEPARATOR_REGEX = /^\|[\s:|-]+\|$/;

/**
 * Parses table alignment from separator row
 * @param separator - The separator cell content (e.g., "---", ":---:", "---:")
 * @returns CSS text-align value
 */
const parseTableAlignment = (separator: string): string => {
    const trimmed = separator.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return "left";
};

/**
 * Parses block-level markdown syntax into React elements
 * Supported blocks (in order of precedence):
 * - ``` code blocks -> <pre><code>
 * - # Headers (1-6 levels) -> <h1> through <h6>
 * - | Tables -> <table><thead><tbody>
 * - - / * / + Lists -> <ul><li>
 * - 1. Numbered lists -> <ol><li>
 * - > Blockquotes -> <blockquote>
 * - --- / *** / ___ Horizontal rules -> <hr>
 * - <details> Collapsible sections -> <details><summary>
 * - Paragraphs -> <p> (with smart image gallery handling)
 *
 * Uses a line-by-line parser that consumes related lines for multi-line blocks
 * @param text - The markdown text to parse
 * @param urls - Map of blob IDs to image URLs
 * @param blogTitle - Optional blog metadata for the first H1
 * @param preview - Whether to render in preview mode
 * @returns Array of block-level JSX elements
 */
const parseBlock = (
    text: string,
    urls: { [id: string]: string },
    blogTitle?: BlogTitle,
    preview?: boolean,
): JSX.Element[] => {
    const lines = text.split("\n");
    const blocks: JSX.Element[] = [];
    let i = 0;
    let key = 0;

    const h1Renderer = createH1Renderer(blogTitle);
    const paragraphRenderer = createParagraphRenderer();

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === "") {
            i++;
            continue;
        }

        if (line.startsWith("```")) {
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            i++;
            const code = codeLines.join("\n");
            blocks.push(
                <pre key={key++}>
                    <code>{code}</code>
                </pre>,
            );
            continue;
        }

        let match;
        if ((match = line.match(HEADING_REGEX))) {
            const level = match[1].length;
            const content = match[2];

            if (level === 1) {
                blocks.push(
                    <React.Fragment key={key++}>
                        {h1Renderer({
                            children: parseInline(content, urls, preview),
                        })}
                    </React.Fragment>,
                );
            } else {
                const Tag = `h${level}` as keyof JSX.IntrinsicElements;
                blocks.push(
                    <Tag key={key++}>
                        {parseInline(content, urls, preview)}
                    </Tag>,
                );
            }
            i++;
            continue;
        }

        if (UNORDERED_LIST_REGEX.test(line)) {
            const items: JSX.Element[] = [];
            let itemKey = 0;
            while (
                i < lines.length &&
                (UNORDERED_LIST_REGEX.test(lines[i]) || lines[i].trim() === "")
            ) {
                if (lines[i].trim() === "") {
                    i++;
                    continue;
                }
                const content = lines[i].replace(UNORDERED_LIST_REGEX, "");
                items.push(
                    <li key={itemKey++}>
                        {parseInline(content, urls, preview)}
                    </li>,
                );
                i++;
            }
            blocks.push(<ul key={key++}>{items}</ul>);
            continue;
        }

        if (ORDERED_LIST_REGEX.test(line)) {
            const items: JSX.Element[] = [];
            let itemKey = 0;
            while (
                i < lines.length &&
                (ORDERED_LIST_REGEX.test(lines[i]) || lines[i].trim() === "")
            ) {
                if (lines[i].trim() === "") {
                    i++;
                    continue;
                }
                const content = lines[i].replace(ORDERED_LIST_REGEX, "");
                items.push(
                    <li key={itemKey++}>
                        {parseInline(content, urls, preview)}
                    </li>,
                );
                i++;
            }
            blocks.push(<ol key={key++}>{items}</ol>);
            continue;
        }

        if (line.startsWith("> ")) {
            const quoteLines: string[] = [];
            while (
                i < lines.length &&
                (lines[i].startsWith("> ") || lines[i].trim() === "")
            ) {
                if (lines[i].trim() === "") {
                    i++;
                    continue;
                }
                quoteLines.push(lines[i].replace(/^>\s?/, ""));
                i++;
            }
            blocks.push(
                <blockquote key={key++}>
                    {parseBlock(
                        quoteLines.join("\n"),
                        urls,
                        undefined,
                        preview,
                    )}
                </blockquote>,
            );
            continue;
        }

        if (HR_REGEX.test(line)) {
            blocks.push(<hr key={key++} />);
            i++;
            continue;
        }

        if (
            TABLE_ROW_REGEX.test(line) &&
            i + 1 < lines.length &&
            TABLE_SEPARATOR_REGEX.test(lines[i + 1])
        ) {
            const headerCells = line
                .slice(1, -1)
                .split("|")
                .map((cell) => cell.trim());
            i++;

            const separatorCells = lines[i]
                .slice(1, -1)
                .split("|")
                .map((cell) => cell.trim());
            const alignments = separatorCells.map(parseTableAlignment);
            i++;

            const rows: string[][] = [];
            while (i < lines.length && TABLE_ROW_REGEX.test(lines[i])) {
                const cells = lines[i]
                    .slice(1, -1)
                    .split("|")
                    .map((cell) => cell.trim());
                rows.push(cells);
                i++;
            }

            blocks.push(
                <table key={key++}>
                    <thead>
                        <tr>
                            {headerCells.map((cell, idx) => (
                                <th
                                    key={idx}
                                    style={{
                                        textAlign: alignments[idx] as any,
                                    }}
                                >
                                    {parseInline(cell, urls, preview)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                                {row.map((cell, cellIdx) => (
                                    <td
                                        key={cellIdx}
                                        style={{
                                            textAlign: alignments[
                                                cellIdx
                                            ] as any,
                                        }}
                                    >
                                        {parseInline(cell, urls, preview)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>,
            );
            continue;
        }

        if (line.startsWith("<details>")) {
            const detailsLines: string[] = [];
            let summaryContent = "";
            i++;

            if (i < lines.length && lines[i].startsWith("<summary>")) {
                summaryContent = lines[i].replace(/<\/?summary>/g, "").trim();
                i++;
            }

            while (i < lines.length && !lines[i].startsWith("</details>")) {
                detailsLines.push(lines[i]);
                i++;
            }
            i++;

            blocks.push(
                <details key={key++}>
                    <summary>
                        {parseInline(summaryContent, urls, preview)}
                    </summary>
                    {parseBlock(
                        detailsLines.join("\n"),
                        urls,
                        undefined,
                        preview,
                    )}
                </details>,
            );
            continue;
        }

        const paragraphLines: string[] = [];
        while (
            i < lines.length &&
            lines[i].trim() !== "" &&
            !HEADING_REGEX.test(lines[i]) &&
            !UNORDERED_LIST_REGEX.test(lines[i]) &&
            !ORDERED_LIST_REGEX.test(lines[i]) &&
            !TABLE_ROW_REGEX.test(lines[i]) &&
            !lines[i].startsWith("> ") &&
            !lines[i].startsWith("```") &&
            !lines[i].startsWith("<details>")
        ) {
            paragraphLines.push(lines[i]);
            i++;
        }

        if (paragraphLines.length > 0) {
            const content = paragraphLines.join(" ");
            blocks.push(
                <React.Fragment key={key++}>
                    {paragraphRenderer({
                        children: parseInline(content, urls, preview),
                    })}
                </React.Fragment>,
            );
        }
    }

    return blocks;
};

/**
 * Main Markdown component that parses and renders markdown text
 *
 * This is a custom markdown parser built specifically for Taggr that supports:
 * - Standard markdown syntax (headers, lists, bold, italic, code, links, images)
 * - Special features: YouTube embeds, image galleries, collapsible sections
 * - Internal vs external link/image handling
 * - Blog post metadata rendering
 * - Preview mode for lazy loading
 *
 * @example
 * <Markdown urls={blobUrlMap} blogTitle={metadata}>
 *   # My Post
 *   This is **bold** text
 *   ![Image](/blob/abc123)
 * </Markdown>
 */
export const Markdown: React.FC<MarkdownProps> = React.memo(
    ({ classNameArg, children, urls = {}, blogTitle, preview }) => (
        <div className={classNameArg}>
            {parseBlock(children, urls, blogTitle, preview)}
        </div>
    ),
);
