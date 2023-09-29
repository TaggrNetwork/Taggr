import * as React from "react";
// @ts-ignore
import DiffMatchPatch from "diff-match-patch";
import { Clipboard, ClipboardCheck, Flag, Menu, Share } from "./icons";
import { loadFile } from "./form";
import { Post, PostId, Report, User, UserId } from "./types";

export const MAX_POST_SIZE_BYTES = Math.ceil(1024 * 1024 * 1.9);

export const percentage = (n: number | BigInt, total: number) => {
    let p = Math.ceil((Number(n) / (total || 1)) * 10000) / 100;
    return `${p}%`;
};

export const hex = (arr: number[]) =>
    Array.from(arr, (byte) =>
        ("0" + (byte & 0xff).toString(16)).slice(-2),
    ).join("");

export const FileUploadInput = ({
    classNameArg,
    callback,
}: {
    classNameArg?: string;
    callback: (arg: Uint8Array) => void;
}) => (
    <input
        type="file"
        className={classNameArg}
        style={{ maxWidth: "90%" }}
        onChange={async (ev) => {
            const files = (
                (ev as unknown as DragEvent).dataTransfer || ev.target
            )?.files;
            if (!files) return;
            const file = files[0];
            const content = new Uint8Array(await loadFile(file));
            if (content.byteLength > MAX_POST_SIZE_BYTES) {
                alert(
                    `Error: the binary cannot be larger than ${MAX_POST_SIZE_BYTES} bytes.`,
                );
                return;
            }
            callback(content);
        }}
    />
);

export const microSecsSince = (timestamp: BigInt) =>
    Number(new Date()) - Number(timestamp) / 1000000;

export const hoursTillNext = (interval: number, last: BigInt) =>
    Math.ceil(interval / 1000000 / 3600000 - microSecsSince(last) / 3600000);

export const commaSeparated = (items: (JSX.Element | string)[] = []) =>
    items.length == 0 ? [] : interleaved(items, <span>, </span>);

export const interleaved = (
    items: (JSX.Element | string)[],
    link: JSX.Element,
) =>
    items.reduce((prev, curr) => (
        <>
            {prev}
            {link}
            {curr}
        </>
    ));

export const NotFound = () => (
    <div className="text_centered vertically_spaced">
        <h1 style={{ fontSize: "4em" }}>
            <code>404</code>
        </h1>
        Not found
    </div>
);

export const Unauthorized = () => (
    <div className="text_centered vertically_spaced">
        <h1 style={{ fontSize: "4em" }}>
            <code>401</code>
        </h1>
        Unauthorized
    </div>
);

export const bigScreen = () => window.innerWidth >= 1024;

export const RealmRibbon = ({ col, name }: { col?: string; name: string }) => (
    <RealmSpan
        name={name}
        col={col}
        classNameArg="realm_tag monospace"
        onClick={() => (location.href = `/#/realm/${name}`)}
    />
);

export const HeadBar = ({
    title,
    shareLink,
    shareTitle,
    button1,
    button2,
    content,
    menu,
    styleArg,
    burgerTestId = null,
}: {
    title: string;
    shareLink?: string;
    shareTitle?: string;
    button1?: JSX.Element;
    button2?: JSX.Element;
    content?: JSX.Element;
    menu?: boolean;
    styleArg?: any;
    burgerTestId?: any;
}) => {
    const [showMenu, setShowMenu] = React.useState(false);
    const effStyle = { ...styleArg } || {};
    effStyle.flex = 0;
    return (
        <div
            className="column_container stands_out bottom_spaced"
            style={styleArg}
        >
            <div className="vcentered">
                <h1
                    className={`max_width_col ${
                        bigScreen() ? "x_large_text" : "larger_text"
                    }`}
                >
                    {title}
                </h1>
                <div className="vcentered flex_ended">
                    {shareLink && (
                        <ShareButton
                            styleArg={effStyle}
                            url={shareLink}
                            title={shareTitle}
                            classNameArg="right_half_spaced"
                        />
                    )}
                    {button1}
                    {button2}
                    {menu && (
                        <BurgerButton
                            styleArg={effStyle}
                            onClick={() => setShowMenu(!showMenu)}
                            pressed={showMenu}
                            testId={burgerTestId}
                        />
                    )}
                    {!menu && content}
                </div>
            </div>
            {menu && showMenu && <div className="top_spaced">{content}</div>}
        </div>
    );
};

export const realmColors = (name: string, col?: string) => {
    const light = (col: string) => {
        const hex = col.replace("#", "");
        const c_r = parseInt(hex.substring(0, 0 + 2), 16);
        const c_g = parseInt(hex.substring(2, 2 + 2), 16);
        const c_b = parseInt(hex.substring(4, 4 + 2), 16);
        const brightness = (c_r * 299 + c_g * 587 + c_b * 114) / 1000;
        return brightness > 155;
    };
    const effCol =
        col || (window.backendCache.realms[name] || [])[0] || "#ffffff";
    const color = light(effCol) ? "black" : "white";
    return { background: effCol, color, fill: color };
};

export const RealmSpan = ({
    col,
    name,
    classNameArg,
    onClick,
    styleArg,
}: {
    col?: string;
    name: string;
    classNameArg?: string;
    onClick: () => void;
    styleArg?: any;
}) => {
    if (!name) return null;
    const { background, color } = realmColors(name, col);
    return (
        <span
            className={`${classNameArg} realm_span`}
            onClick={onClick}
            style={{ background, color, whiteSpace: "nowrap", ...styleArg }}
        >
            {name}
        </span>
    );
};

export const currentRealm = () => window.realm || "";

export const ShareButton = ({
    classNameArg,
    title = "Check this out",
    url,
    styleArg,
    text,
}: {
    classNameArg?: string;
    title?: string;
    url: string;
    styleArg?: any;
    text?: boolean;
}) => {
    const fullUlr = `https://${window.backendCache.config.domains[0]}/${url}`;
    return (
        <button
            title={`Share link to ${fullUlr}`}
            className={classNameArg}
            style={styleArg}
            onClick={async (_) => {
                if (navigator.share) navigator.share({ title, url: fullUlr });
                else {
                    await navigator.clipboard.writeText(fullUlr);
                    alert(`Copied to clipboard: ${fullUlr}`);
                }
            }}
        >
            {text ? "SHARE" : <Share styleArg={styleArg} />}
        </button>
    );
};

const regexp = /[\p{Letter}\p{Mark}|\d|\-|_]+/gu;
export const getTokens = (prefix: string, value: string) => {
    const tokens = value
        .split(/\s+/g)
        .filter((token) => {
            const postfix = token.slice(1);
            if (!postfix.match(regexp) || !isNaN(parseInt(postfix)))
                return false;
            for (let c of prefix) if (c == token[0]) return true;
            return false;
        })
        .map((token) => (token.match(regexp) || [])[0]);
    const list = [...new Set(tokens)];
    list.sort((b = "", a = "") => a.length - b.length);
    return list;
};

export const setTitle = (value: string) => {
    const titleElement = document.getElementsByTagName("title")[0];
    if (titleElement) titleElement.innerText = `TAGGR: ${value}`;
};

export const ButtonWithLoading = ({
    label,
    title,
    onClick,
    classNameArg,
    styleArg,
    testId,
}: {
    label: any;
    title?: string;
    onClick: () => Promise<void>;
    classNameArg?: string;
    styleArg?: any;
    testId?: any;
}) => {
    let [loading, setLoading] = React.useState(false);
    return (
        <button
            title={title}
            disabled={loading}
            className={`${
                loading ? classNameArg?.replaceAll("active", "") : classNameArg
            }`}
            style={styleArg || null}
            data-testid={testId}
            onClick={async (e) => {
                e.preventDefault();
                setLoading(true);
                await onClick();
                setLoading(false);
            }}
        >
            {loading ? <Loading spaced={false} /> : label}
        </button>
    );
};

export const ToggleButton = ({
    toggler,
    offTitle,
    onTitle,
    classNameArg,
    currState,
    offLabel,
    onLabel,
    testId = null,
}: {
    toggler: () => void;
    offTitle?: string;
    onTitle?: string;
    classNameArg?: string;
    currState: () => boolean;
    offLabel: JSX.Element | string;
    onLabel: JSX.Element | string;
    testId?: any;
}) => {
    // -1: not following, 0: unknown, 1: following
    let [status, setStatus] = React.useState(0);
    let on = status == 1 || (status == 0 && currState());
    return (
        <button
            title={on ? onTitle : offTitle}
            className={`${classNameArg}`}
            onClick={(e) => {
                e.preventDefault();
                setStatus(on ? -1 : 1);
                toggler();
            }}
            data-testid={testId}
        >
            {on ? onLabel : offLabel}
        </button>
    );
};

export const timeAgo = (
    originalTimestamp: BigInt | number,
    absolute?: boolean,
    format: "short" | "long" = "short",
) => {
    const timestamp = Number(originalTimestamp) / 1000000;
    const diff = Number(new Date()) - timestamp;
    const minute = 60 * 1000;
    const hour = minute * 60;
    const day = hour * 24;
    switch (true) {
        case !absolute && diff < minute:
            const seconds = Math.round(diff / 1000);
            return `${seconds}s ago`;
        case !absolute && diff < hour:
            return Math.round(diff / minute) + "m ago";
        case !absolute && diff < day:
            return Math.round(diff / hour) + "h ago";
        case diff < 90 * day:
            return `${new Intl.DateTimeFormat("default", {
                month: format,
                day: "numeric",
            }).format(timestamp)}`;
        default:
            return `${new Intl.DateTimeFormat("default", {
                year: "2-digit",
                month: format,
                day: "numeric",
            }).format(timestamp)}`;
    }
};

export const tokenBalance = (balance: number) =>
    (
        balance / Math.pow(10, window.backendCache.config.token_decimals)
    ).toLocaleString();

export const icpCode = (e8s: BigInt, decimals: number, units = true) => (
    <code className="xx_large_text">
        {icp(e8s, decimals)}
        {units && " ICP"}
    </code>
);

export const icp = (e8s: BigInt, decimals: number = 2) => {
    let n = Number(e8s);
    let base = Math.pow(10, 8);
    let v = n / base;
    return (decimals ? v : Math.floor(v)).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
    });
};

export const ICPAccountBalance = ({
    address,
    decimals,
    units,
    heartbeat,
}: {
    address: string;
    decimals: number;
    units: boolean;
    heartbeat: any;
}) => {
    const [e8s, setE8s] = React.useState(0 as unknown as BigInt);
    React.useEffect(() => {
        window.api.account_balance(address).then((n) => setE8s(n));
    }, [address, heartbeat]);
    return icpCode(e8s, decimals, units);
};

export const IcpAccountLink = ({
    address,
    label,
}: {
    address: string;
    label: string;
}) => (
    <a
        target="_blank"
        href={`https://dashboard.internetcomputer.org/account/${address}`}
    >
        {label}
    </a>
);

export const Loading = ({
    classNameArg,
    spaced = true,
}: {
    classNameArg?: string;
    spaced?: boolean;
}) => {
    const [dot, setDot] = React.useState(0);
    const md = <span> ■ </span>;
    React.useEffect(() => {
        setTimeout(() => setDot(dot + 1), 200);
    }, [dot]);
    return (
        <div
            className={`${classNameArg} ${
                spaced ? "vertically_spaced" : ""
            } accent small_text text_centered left_spaced right_spaced`}
            data-testid="loading-spinner"
        >
            {[md, md, md].map((v, i) =>
                i == dot % 3 ? (
                    <span key={i} style={{ opacity: 0.5 }}>
                        {v}
                    </span>
                ) : (
                    v
                ),
            )}
        </div>
    );
};

export const loadPosts = async (ids: PostId[]) =>
    ((await window.api.query<Post[]>("posts", ids)) || []).map(expandUser);

export const expandUser = (post: Post) => {
    const id = post.user;
    const { users, karma } = window.backendCache;
    post.userObject = { id, name: users[id], karma: karma[id] };
    return post;
};

export const blobToUrl = (blob: number[]) =>
    URL.createObjectURL(
        new Blob([new Uint8Array(blob).buffer], { type: "image/png" }),
    );

export const isRoot = (post: Post) => post.parent == null;

export const UserLink = ({ id }: { id: UserId }) => (
    <a href={`#/user/${id}`}>{window.backendCache.users[id] || "?"}</a>
);

export const realmList = (ids: string[] = []) =>
    ids.map((name) => (
        <RealmSpan
            key={name}
            name={name}
            onClick={() => (location.href = `/#/realm/${name}`)}
            classNameArg="clickable padded_rounded right_half_spaced top_half_spaced"
        />
    ));

export const userList = (ids: UserId[] = []) =>
    commaSeparated(ids.map((id) => <UserLink key={id} id={id} />));

export const token = (n: number) =>
    Math.ceil(
        n / Math.pow(10, window.backendCache.config.token_decimals),
    ).toLocaleString();

export const ReactionToggleButton = ({
    title,
    icon,
    onClick,
    pressed,
    classNameArg,
    testId = null,
}: {
    title?: string;
    icon: any;
    onClick: (arg: any) => void;
    pressed?: boolean;
    classNameArg?: string;
    testId?: any;
}) => (
    <button
        title={title}
        data-meta="skipClicks"
        onClick={(e) => {
            e.preventDefault();
            onClick(e);
        }}
        data-testid={testId}
        className={`${
            pressed ? "" : "un"
        }selected reaction_button vcentered ${classNameArg}`}
    >
        {icon}
    </button>
);

export const BurgerButton = ({
    onClick,
    pressed,
    testId = null,
    styleArg,
}: {
    onClick: () => void;
    pressed: boolean;
    testId?: any;
    styleArg?: { [name: string]: string };
}) => {
    const effStyle = { ...styleArg };
    if (pressed) {
        const color = effStyle.color;
        effStyle.color = effStyle.background;
        effStyle.fill = effStyle.background;
        effStyle.background = color;
    }
    return (
        <ReactionToggleButton
            title="Menu"
            onClick={onClick}
            pressed={pressed}
            // @ts-ignore
            icon={<Menu styleArg={effStyle} />}
            testId={testId}
        />
    );
};

export const loadPostBlobs = async (files: {
    [id: string]: [number, number];
}) => {
    const ids = Object.keys(files);
    const blobs: [string, ArrayBuffer][] = await Promise.all(
        ids.map(async (id) => {
            const [blobId, bucket_id] = id.split("@");
            const [offset, len] = files[id];
            const arg = Buffer.from(
                intToBEBytes(offset).concat(intToBEBytes(len)),
            );
            // This allows us to see the bucket pics in dev mode.
            const api = window.backendCache.stats.buckets.every(
                ([id]) => id != bucket_id,
            )
                ? window.mainnet_api
                : window.api;
            return api
                .query_raw(bucket_id, "read", arg)
                .then((blob) => [blobId, blob || new ArrayBuffer(0)]);
        }),
    );
    return blobs.reduce(
        (acc, [blobId, blob]) => {
            acc[blobId] = blob;
            return acc;
        },
        {} as { [id: string]: ArrayBuffer },
    );
};

const dmp = new DiffMatchPatch();

export const getPatch = (A: string, B: string) =>
    dmp.patch_toText(dmp.patch_make(A, B));

export const applyPatch = (text: string, patch: string) =>
    dmp.patch_apply(dmp.patch_fromText(patch), text);

export const reactionCosts = () =>
    window.backendCache.config.reactions.reduce(
        (acc, [id, cost]) => {
            acc[id] = cost;
            return acc;
        },
        {} as { [id: number]: number },
    );

export function CopyToClipboard({
    value,
    pre = (value) => (
        <span>
            <code>{value}</code> <Clipboard />
        </span>
    ),
    post = (value) => (
        <span>
            <code>{value}</code> <ClipboardCheck />
        </span>
    ),
    displayMap = (e) => e,
    map = (e) => e,
    testId,
}: {
    value: string;
    testId?: any;
    map?: (arg: string) => string;
    displayMap?: (arg: any) => any;
    pre?: (arg: JSX.Element) => JSX.Element;
    post?: (arg: JSX.Element) => JSX.Element;
}): JSX.Element {
    const [copied, setCopied] = React.useState(false);
    return (
        <span
            title="Copy to clipboard"
            className="no_wrap clickable"
            onClick={async () => {
                const cb = navigator.clipboard;
                await cb.writeText(map(value));
                setCopied(true);
            }}
            data-testid={testId}
        >
            {copied ? post(displayMap(value)) : pre(displayMap(value))}
        </span>
    );
}

export const intFromBEBytes = (bytes: number[]) =>
    bytes.reduce((acc, value) => acc * 256 + value, 0);

export const intToBEBytes = (val: number) => {
    const bytes = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let index = bytes.length - 1; index >= 0; index--) {
        bytes[index] = val & 0xff;
        val = val >> 8;
    }
    return bytes;
};

export const FlagButton = ({
    id,
    domain,
    text,
}: {
    id: number;
    domain: string;
    text?: boolean;
}) => (
    <ButtonWithLoading
        title="Flag post"
        classNameArg="max_width_col"
        onClick={async () => {
            let reason = prompt(
                `You are reporting this ${
                    domain == "post" ? "post" : "user"
                } to stalwarts. ` +
                    `If the report gets rejected, you'll lose ` +
                    window.backendCache.config[
                        domain == "post"
                            ? "reporting_penalty_post"
                            : "reporting_penalty_misbehaviour"
                    ] +
                    ` cycles and karma. If you want to continue, please justify the report.`,
            );
            if (reason) {
                let response = await window.api.call<{ [name: string]: any }>(
                    "report",
                    domain,
                    id,
                    reason,
                );
                if (response && "Err" in response) {
                    alert(`Error: ${response.Err}`);
                    return;
                }
                alert("Report accepted! Thank you!");
            }
        }}
        label={text ? "REPORT" : <Flag />}
    />
);

export const ReportBanner = ({
    id,
    reportArg,
    domain,
}: {
    id: number;
    reportArg: Report;
    domain: string;
}) => {
    const [report, setReport] = React.useState(reportArg);
    const { reporter, confirmed_by, rejected_by } = report;
    let tookAction =
        window.user?.id == report.reporter ||
        rejected_by.concat(confirmed_by).includes(window.user.id);
    let buttons: [string, boolean][] = [
        ["🛑 DISAGREE", false],
        ["✅ AGREE", true],
    ];
    return (
        <div className="post_head banner">
            <h3>
                This {domain == "post" ? "post" : "user"} was <b>REPORTED</b>{" "}
                by&nbsp;
                <a href={`/#/user/${reporter}`}>
                    {window.backendCache.users[reporter]}
                </a>
                . Please confirm the deletion or reject the report.
            </h3>
            <h4>Reason: {report.reason}</h4>
            {tookAction && (
                <div className="monospace medium_text">
                    {confirmed_by.length > 0 && (
                        <div>CONFIRMED BY {userList(confirmed_by)}</div>
                    )}
                    {rejected_by.length > 0 && (
                        <div>REJECTED BY {userList(rejected_by)}</div>
                    )}
                </div>
            )}
            {!tookAction && (
                <div
                    className="row_container"
                    style={{ justifyContent: "center" }}
                >
                    {buttons.map(([label, val]) => (
                        <ButtonWithLoading
                            title={label}
                            key={label}
                            onClick={async () => {
                                let result = await window.api.call<{
                                    [name: string]: any;
                                }>("vote_on_report", domain, id, val);
                                if (result && "Err" in result) {
                                    alert(`Error: ${result.Err}`);
                                    return;
                                }
                                const updatedReport =
                                    domain == "post"
                                        ? (await loadPosts([id]))[0].report
                                        : (
                                              await window.api.query<User>(
                                                  "user",
                                                  [id.toString()],
                                              )
                                          )?.report;
                                if (updatedReport) setReport(updatedReport);
                            }}
                            label={label}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
