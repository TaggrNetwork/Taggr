import * as React from "react";
import ReactMarkdown from "react-markdown";
import { blobToUrl, timeAgo } from "./common";
import remarkGfm from "remark-gfm";
import { CarretDown } from "./icons";
import { BlogTitle } from "./types";

export const CUT = "\n\n\n\n";

// We need this becasue the native modulo function doesn't work on negative numbers as expected.
function mod(n: number, m: number) {
    return ((n % m) + m) % m;
}

const fadeInPicture = (pic: HTMLImageElement) => {
    pic.className = "fadein";
    setTimeout(() => (pic.className = ""), 150);
};

const previewImg = (
    src: string,
    id: string,
    gallery: string[],
    urls: { [id: string]: string },
) => {
    const preview = document.getElementById("preview");
    if (!preview) return;
    while (preview.hasChildNodes()) {
        let firstChild = preview.firstChild;
        if (firstChild) preview.removeChild(firstChild);
    }
    preview.style.display = "flex";
    const pic = document.createElement("img");
    pic.src = src;
    pic.isMap = true;

    const notGallery = !gallery || gallery.length == 1;

    let slide = (next: boolean) => {
        if (notGallery) return;
        const pos = gallery.indexOf(id);
        if (pos < 0) return;
        const newId = gallery[mod(pos + (next ? 1 : -1), gallery.length)];
        id = newId;
        fadeInPicture(pic);
        let src = urls[newId];
        pic.src = src ? src : id;
    };

    pic.onclick = (event) => {
        const next = pic.clientWidth / 2 < event.offsetX;
        slide(next);
    };
    preview.appendChild(pic);
    fadeInPicture(pic);

    const closePreview = () => (preview.style.display = "none");

    document.onscroll = closePreview;
    preview.onclick = (event) => {
        let target: any = event.target;
        if (target?.id == "preview" || notGallery)
            preview.style.display = "none";
    };

    if (notGallery) return;

    const leftArrow = document.createElement("div");
    leftArrow.className = "button left_arrow";
    leftArrow.innerHTML = "&#8592;";
    leftArrow.onclick = () => slide(false);
    preview.appendChild(leftArrow);

    const rightArrow = document.createElement("div");
    rightArrow.className = "button right_arrow";
    rightArrow.innerHTML = "&#8594;";
    rightArrow.onclick = () => slide(true);
    preview.appendChild(rightArrow);

    const closeButton = document.createElement("div");
    closeButton.className = "button close";
    closeButton.innerHTML = "&#215;";
    closeButton.onclick = closePreview;
    preview.appendChild(closeButton);
};

const splitParagraphsAndPics = (
    elems: JSX.Element[],
    isPic: (arg: JSX.Element) => boolean,
) => {
    const result = [];
    let chunk = [];
    for (let i in elems) {
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
    blobs,
    collapse,
    preview,
    primeMode,
    classNameArg,
    forceCollapsing,
}: {
    post?: boolean;
    blogTitle?: BlogTitle;
    value: string;
    blobs?: { [id: string]: ArrayBuffer };
    collapse?: boolean;
    preview?: boolean;
    primeMode?: boolean;
    classNameArg?: string;
    forceCollapsing?: boolean;
}) => {
    const [urls, setUrls] = React.useState({});

    value = linkTagsAndUsers(value);

    if (!post)
        return (
            <ReactMarkdown
                components={
                    {
                        a: linkRenderer(preview),
                    } as unknown as any
                }
                children={value}
                remarkPlugins={[remarkGfm]}
                className={classNameArg}
            />
        );

    if (forceCollapsing) {
        const lines = value.split("\n");
        value =
            (lines[0].length < 256
                ? lines[0]
                : lines[0].slice(0, 256) + " ...") +
            CUT +
            lines.slice(1).join("\n");
    }

    let cutPos = value.indexOf(CUT);
    let shortened = cutPos >= 0;
    let extValue: string = "";

    if (shortened) {
        extValue = value.slice(cutPos + CUT.length);
        value = value.slice(0, cutPos);
        if (preview) value += "\n\n- - -\n\n";
    }
    const complexPost = ["# ", "## ", "!["].some((pref) =>
        value.startsWith(pref),
    );
    const words = value.split(" ").length;
    const lines = value.split("\n").length;
    let className = classNameArg || "";
    if (primeMode && lines < 10 && !complexPost) {
        if (words < 50) className += " x_large_text";
        else if (words < 100) className += " enlarged_text";
    }

    return React.useMemo(
        () => (
            <>
                {markdownizer(
                    value,
                    urls,
                    setUrls,
                    blobs,
                    blogTitle,
                    preview,
                    className,
                )}
                {shortened &&
                    (collapse ? (
                        <ArrowDown />
                    ) : (
                        markdownizer(
                            extValue,
                            urls,
                            setUrls,
                            blobs,
                            undefined,
                            preview,
                        )
                    ))}
            </>
        ),
        [value, extValue, blobs, collapse],
    );
};

const isALink = (val: string) =>
    val.match(/^https?:\/\/.+$/) || val.match(/^www\..+$/);

const linkRenderer =
    (preview?: boolean) =>
    ({ node, children, ...props }: any) => {
        let className = null;
        let label: string = children;
        let child: string = children;
        if (typeof child == "string") {
            // YouTube
            let matches = child.match(
                /https:\/\/(www\.)?(youtu.be\/|youtube.com\/watch\?v=)([a-zA-Z0-9\-_]+)/,
            );
            if (matches) {
                const id = matches.pop();
                return id ? <YouTube id={id} preview={preview} /> : null;
            }

            matches = isALink(child) || isALink(props.href);
            if (matches) {
                try {
                    const url = new URL(props.href);
                    if (child == props.href.replace(/&amp;/g, "&")) {
                        className = "external";
                        label = url.hostname.toUpperCase();
                        props.rel = "nofollow noopener noreferrer";
                        props.target = "_blank";
                    } else {
                        label = child;
                    }

                    // Internal links
                    if (
                        window.backendCache.config.domains.some((domain) =>
                            url.hostname.includes(domain),
                        )
                    ) {
                        let link = url.href.replace(url.origin + "/", "");
                        props.href = (link.startsWith("#") ? "" : "#/") + link;
                    }
                } catch (e) {}
            }
            // local link
            else if (props.href.startsWith("/")) {
                props.href = "#" + props.href.replace("/#/", "/");
            }
        }
        return (
            <a className={className} {...props}>
                {label}
            </a>
        );
    };

const markdownizer = (
    value: string,
    urls: { [id: string]: string },
    setUrls: (arg: { [id: string]: string }) => void,
    blobs?: { [id: string]: ArrayBuffer },
    blogTitle?: BlogTitle,
    preview?: boolean,
    className?: string,
) =>
    !value ? null : (
        <ReactMarkdown
            children={value}
            remarkPlugins={[remarkGfm]}
            className={className}
            components={{
                h1: ({ node, children, ...props }) => {
                    if (!blogTitle) return <h1 {...props}>{children}</h1>;
                    let { author, created, length } = blogTitle;
                    return (
                        <>
                            <h1>{children}</h1>
                            <p className="blog_title medium_text vertically_spaced">
                                By <a href={`#/journal/${author}`}>{author}</a>
                                &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                                <b>{timeAgo(created, true, "long")}</b>
                                &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                                {Math.ceil(length / 400)} minutes read
                            </p>
                        </>
                    );
                },
                a: linkRenderer(preview),
                p: ({ node, children, ...props }) => {
                    const isPic = (c: any) => c.type && c.type.name == "img";
                    if (Array.isArray(children)) {
                        const pics = children.filter(isPic).length;
                        if (pics >= 1 && isPic(children[0]))
                            return <Gallery children={children} />;
                        else
                            return (
                                <>{splitParagraphsAndPics(children, isPic)}</>
                            );
                    } else if (isPic(children))
                        return <Gallery children={[children]} />;
                    return <p {...props}>{children}</p>;
                },
                img: ({ node, ...props }: any) => {
                    try {
                        if (!props.src.startsWith("/blob/")) new URL(props.src);
                    } catch (_) {
                        return null;
                    }
                    let id: string = props.src;
                    if (props.src.startsWith("/blob/")) {
                        id = props.src.replace("/blob/", "");
                        if (id in urls) {
                            props.src = urls[id];
                        } else if (blobs && id in blobs) {
                            const url = blobToUrl(blobs[id]);
                            urls[id] = url;
                            setUrls(urls);
                            props.src = url;
                        } else {
                            setDimensions(props);
                            props.src = fillerImg;
                        }
                    }
                    return (
                        <img
                            {...props}
                            onClick={() =>
                                previewImg(props.src, id, props.gallery, urls)
                            }
                        />
                    );
                },
            }}
        />
    );

const Gallery = ({ children }: any) => {
    let pictures = children.filter((c: any) => c.type && c.type.name == "img");
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
                    {pictures}
                </div>
            )}
            {nonPictures.length > 0 && <p>{nonPictures}</p>}
        </>
    );
};

const YouTube = ({ id, preview }: { id: string; preview?: boolean }) => {
    const [open, setOpen] = React.useState(!preview);
    if (open)
        return (
            <span className="video-container" style={{ display: "block" }}>
                <iframe
                    loading="lazy"
                    allowFullScreen={true}
                    referrerPolicy="origin"
                    frameBorder="0"
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

const ArrowDown = () => (
    <div className="text_centered bottom_spaced top_spaced">
        <CarretDown classNameArg="action" />
    </div>
);

const setDimensions = (props: any) => {
    const maxHeight = Math.ceil(window.innerHeight / 3);
    const [width, height] = (props.alt.match(/\d+x\d+/) || [
        `${window.innerWidth}x${maxHeight}`,
    ])[0].split("x");
    props.width = parseInt(width);
    props.height = Math.min(maxHeight, parseInt(height));
};

const fillerImg =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAQAAAAe/WZNAAAAEElEQVR42mNkMGYAA0YMBgAJ4QCdD/t7zAAAAABJRU5ErkJggg==";
