import * as React from "react";
import ReactMarkdown from "react-markdown";
import { getTokens, blobToUrl, timeAgo } from "./common";
import remarkGfm from "remark-gfm";
import { CarretDown } from "./icons";

export const CUT = "\n\n\n\n";

// We need this becasue the native modulo function doesn't work on negative numbers as expected.
function mod(n, m) {
    return ((n % m) + m) % m;
}

const previewImg = (src, id, gallery, urls) => {
    const preview = document.getElementById("preview");
    while (preview.hasChildNodes()) {
        preview.removeChild(preview.firstChild);
    }
    preview.style.display = "flex";
    const pic = document.createElement("img");
    pic.src = src;
    pic.isMap = true;

    const notGallery = !gallery || gallery.length == 1;

    let slide = (next) => {
        if (notGallery) return;
        const pos = gallery.indexOf(id);
        if (pos < 0) return;
        const newId = gallery[mod(pos + (next ? 1 : -1), gallery.length)];
        pic.src = urls[newId];
        id = newId;
    };

    pic.onclick = (event) => {
        const next = pic.clientWidth / 2 < event.offsetX;
        slide(next);
    };
    preview.appendChild(pic);

    const closePreview = () => (preview.style.display = "none");

    document.onscroll = closePreview;
    preview.onclick = (event) => {
        if (event.target.id == "preview" || notGallery)
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

const linkTagsAndUsers = (value) => {
    if (!value) return value;
    const users = getTokens("@", value);
    const tags = getTokens("#$", value);
    value = tags.reduce(
        (r, tag) => r.replaceAll("$" + tag, `[\$${tag}](#/feed/${tag})`),
        value,
    );
    value = tags.reduce(
        (r, tag) => r.replaceAll("#" + tag, `[&#x23;${tag}](#/feed/${tag})`),
        value,
    );
    value = users.reduce(
        (r, handle) =>
            r.replaceAll("@" + handle, `[&commat;${handle}](#/user/${handle})`),
        value,
    );
    return value;
};

export const Content = ({
    post,
    blogTitle,
    value = "",
    blobs = [],
    collapse,
    preview,
    primeMode,
    classNameArg,
}) => {
    const [urls, setUrls] = React.useState({});

    if (!post)
        return (
            <ReactMarkdown
                components={{ a: linkRenderer(preview) }}
                children={linkTagsAndUsers(value)}
                remarkPlugins={[remarkGfm]}
                className={classNameArg}
            />
        );

    let cutPos = value.indexOf(CUT);
    let shortened = cutPos >= 0;
    let extValue;

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

    value = linkTagsAndUsers(value);
    extValue = linkTagsAndUsers(extValue);

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
                {shortened && (
                    <>
                        {collapse && <ArrowDown />}
                        {markdownizer(
                            collapse ? null : extValue,
                            urls,
                            setUrls,
                            blobs,
                            blogTitle,
                            preview,
                        )}
                    </>
                )}
            </>
        ),
        [value, extValue, blobs, collapse],
    );
};

const isALink = (val) => val.match(/^https?:\/\/.+$/) || val.match(/^www\..+$/);

const linkRenderer =
    (preview) =>
    ({ node, children = [], ...props }) => {
        let target = "_self";
        let className = null;
        let label = children;
        let child = children[0];
        if (typeof child == "string") {
            // YouTube
            let matches = child.match(
                /https:\/\/(www\.)?(youtu.be\/|youtube.com\/watch\?v=)([a-zA-Z0-9\-_]+)/,
            );
            if (matches) {
                const id = matches.pop();
                return <YouTube id={id} preview={preview} />;
            }

            matches = isALink(child) || isALink(props.href);
            if (matches) {
                try {
                    const url = new URL(props.href);
                    if (child == props.href) {
                        className = "external";
                        label = url.hostname.toUpperCase();
                    } else {
                        label = child;
                    }

                    // Internal links
                    if (
                        backendCache.config.domains.some((domain) =>
                            url.hostname.includes(domain),
                        )
                    ) {
                        let link = url.href.replace(url.origin + "/", "");
                        props.href = (link.startsWith("#") ? "" : "#/") + link;
                    }
                    // External links
                    else target = "_blank";
                } catch (e) {}
            }
            // local link
            else if (props.href.startsWith("/")) {
                props.href = "#" + props.href.replace("/#/", "/");
            }
        }
        return (
            <a target={target} className={className} {...props}>
                {label}
            </a>
        );
    };

const markdownizer = (
    value,
    urls,
    setUrls,
    blobs,
    blogTitle,
    preview = false,
    className = null,
) =>
    !value ? null : (
        <ReactMarkdown
            children={value}
            remarkPlugins={[remarkGfm]}
            className={className}
            components={{
                h1: ({ node, children, ...props }) => {
                    if (!blogTitle) return <h1 {...props}>{children}</h1>;
                    let { author, created } = blogTitle;
                    return (
                        <>
                            <h1>{children}</h1>
                            <p className="blog_title medium_text vertically_spaced">
                                By{" "}
                                <a href={`#/journal/${author}`}>
                                    @{window.backendCache.users[author]}
                                </a>{" "}
                                on <b>{timeAgo(created, true, "long")}</b>,{" "}
                                {Math.ceil(value.length / 300)} minutes read
                            </p>
                        </>
                    );
                },
                a: linkRenderer(preview),
                p: ({ node, children, ...props }) => {
                    const isPic = (c) => c.type && c.type.name == "img";
                    const pics = children.filter(isPic).length;
                    if (pics >= 1 && isPic(children[0]))
                        return <Gallery children={children} />;
                    return <p {...props}>{children}</p>;
                },
                img: ({ node, ...props }) => {
                    let id;
                    if (props.src.startsWith("/blob/")) {
                        id = props.src.replace("/blob/", "");
                        if (id in urls) {
                            props.src = urls[id];
                        } else if (id in blobs) {
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

const Gallery = ({ children }) => {
    let pictures = children.filter((c) => c.type && c.type.name == "img");
    const urls = pictures.map((pic) => pic.props.src.replace("/blob/", ""));
    pictures = pictures.map((e) => React.cloneElement(e, { gallery: urls }));
    const nonPictures = children.filter((c) => !c.type || c.type.name != "img");
    return (
        <>
            <div className="gallery">
                {pictures[0]}
                {pictures.length > 1 && (
                    <div className="thumbnails row_container">
                        {pictures.slice(1)}
                    </div>
                )}
            </div>
            {nonPictures.length > 0 && <p>{nonPictures}</p>}
        </>
    );
};

const YouTube = ({ id, preview }) => {
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

const setDimensions = (props) => {
    const maxHeight = Math.ceil(window.innerHeight / 3);
    const [width, height] = (props.alt.match(/\d+x\d+/) || [
        `${window.innerWidth}x${maxHeight}`,
    ])[0].split("x");
    props.width = parseInt(width);
    props.height = Math.min(maxHeight, parseInt(height));
};

const fillerImg =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAQAAAAe/WZNAAAAEElEQVR42mNkMGYAA0YMBgAJ4QCdD/t7zAAAAABJRU5ErkJggg==";
