import * as React from "react";
// @ts-ignore
import DiffMatchPatch from "diff-match-patch";
import { Clipboard, ClipboardCheck, Close, Flag, Menu, Share } from "./icons";
import { loadFile } from "./form";
import { Post, PostId, Report, User, UserFilter, UserId } from "./types";
import { createRoot } from "react-dom/client";
import { Principal } from "@dfinity/principal";
import { IcrcAccount } from "@dfinity/ledger-icrc";
import { Content } from "./content";

export const USD_PER_XDR = 1.33;

export const MAX_POST_SIZE_BYTES = Math.ceil(1024 * 1024 * 1.9);

export const percentage = (n: number | BigInt, total: number) => {
    let p = Math.ceil((Number(n) / (total || 1)) * 10000) / 100;
    return `${p}%`;
};

export const RealmList = ({
    ids = [],
    classNameArg,
}: {
    ids?: string[];
    classNameArg?: string;
}) => (
    <div
        className={`row_container ${classNameArg || ""}`}
        style={{ alignItems: "center" }}
    >
        {ids.map((name) => (
            <RealmSpan
                key={name}
                name={name}
                classNameArg="clickable padded_rounded right_half_spaced top_half_spaced"
            />
        ))}
    </div>
);

export const hex = (arr: number[]) =>
    Array.from(arr, (byte) =>
        ("0" + (byte & 0xff).toString(16)).slice(-2),
    ).join("");

export const MoreButton = ({ callback }: { callback: () => Promise<any> }) => (
    <div style={{ display: "flex", justifyContent: "center" }}>
        <ButtonWithLoading
            classNameArg="top_spaced"
            onClick={callback}
            label="MORE"
        />
    </div>
);

export const getRealmsData = (id: string) =>
    window.backendCache.realms_data[id] || ["#ffffff", false, {}];

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
    title: JSX.Element | string;
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
        <div className="column_container stands_out" style={styleArg}>
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
    const effCol = col || getRealmsData(name)[0] || "#FFFFFF";
    const color = light(effCol) ? "black" : "white";
    return { background: effCol, color, fill: color };
};

export const RealmSpan = ({
    col,
    name,
    classNameArg,
    styleArg,
}: {
    col?: string;
    name: string;
    classNameArg?: string;
    styleArg?: any;
}) => {
    if (!name) return null;
    const { background, color } = realmColors(name, col);
    return (
        <span
            className={`realm_span ${classNameArg}`}
            onClick={() => (location.href = `/#/realm/${name}`)}
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
    const fullUlr = `https://${location.host}/${url}`;
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
            if (!postfix.match(regexp) || !isNaN(Number(postfix))) return false;
            for (let c of prefix) if (c == token[0]) return true;
            return false;
        })
        .map((token) => (token.match(regexp) || [])[0]);
    const list = [...new Set(tokens)];
    list.sort((b = "", a = "") => a.length - b.length);
    return list;
};

export const setTitle = (value: string) => {
    const name = window.backendCache.config.name;
    const titleElement = document.getElementsByTagName("title")[0];
    if (titleElement)
        titleElement.innerText = (
            value ? `${name}: ${value}` : name
        ).toUpperCase();
};

export const HASH_ITERATIONS = 15000;

export const ButtonWithLoading = ({
    id,
    label,
    title,
    onClick,
    classNameArg,
    styleArg,
    testId,
}: {
    id?: string;
    label: any;
    title?: string;
    onClick: () => Promise<any>;
    classNameArg?: string;
    styleArg?: any;
    testId?: any;
}) => {
    let [loading, setLoading] = React.useState(false);
    return (
        <button
            id={id}
            title={title}
            disabled={loading}
            className={`fat ${
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

const tokenBase = () => Math.pow(10, window.backendCache.config.token_decimals);

export const tokenBalance = (balance: number) =>
    (balance / tokenBase()).toLocaleString();

export const icpCode = (e8s: BigInt, decimals?: number, units = true) => (
    <code className="xx_large_text">
        {tokens(Number(e8s), decimals || 8, decimals == 0)}
        {units && " ICP"}
    </code>
);

export const tokens = (n: number, decimals: number, hideDecimals?: boolean) => {
    let base = Math.pow(10, decimals);
    let v = n / base;
    return (hideDecimals ? Math.floor(v) : v).toLocaleString(undefined, {
        minimumFractionDigits: hideDecimals ? 0 : decimals,
    });
};

export const ICP_LEDGER_ID = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

export const ICP_DEFAULT_FEE = 10000;

export const ICPAccountBalance = ({
    address,
    decimals,
    units,
    heartbeat,
}: {
    address: string | Principal;
    decimals?: number;
    units?: boolean;
    heartbeat?: any;
}) => {
    const [e8s, setE8s] = React.useState(0 as unknown as BigInt);
    const loadData = async () => {
        const value = await (typeof address == "string"
            ? window.api.icp_account_balance(address)
            : window.api.account_balance(ICP_LEDGER_ID, { owner: address }));
        setE8s(value);
    };

    React.useEffect(() => {
        loadData();
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

export const TokenBalance = ({
    ledgerId,
    decimals,
    account,
    symbol,
}: {
    ledgerId: Principal;
    account: IcrcAccount;
    decimals: number;
    symbol: string;
}) => {
    const [balance, setBalance] = React.useState(BigInt(0));
    React.useEffect(() => {
        window.api
            .account_balance(ledgerId, account)
            .then((n) => setBalance(n));
    }, []);
    return `${tokens(Number(balance), decimals)} ${symbol}`;
};

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
            } accent small_text no_wrap text_centered left_spaced right_spaced`}
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
    const { users, rewards } = window.backendCache;
    post.userObject = { id, name: users[id], rewards: rewards[id] };
    return post;
};

export const blobToUrl = (blob: ArrayBuffer) =>
    URL.createObjectURL(
        new Blob([new Uint8Array(blob).buffer], { type: "image/png" }),
    );

export const isRoot = (post: Post) => post.parent == null;

export const UserLink = ({
    id,
    classNameArg,
    profile,
}: {
    id: UserId;
    classNameArg?: string;
    profile?: boolean;
}) => {
    const userName = window.backendCache.users[id];
    return userName ? (
        <a
            className={`${classNameArg} user_link`}
            href={`#/${profile ? "user" : "journal"}/${id}`}
        >
            {userName}
        </a>
    ) : (
        <span>N/A</span>
    );
};

export const userList = (ids: UserId[] = []) =>
    commaSeparated(ids.map((id) => <UserLink key={id} id={id} />));

export const token = (n: number) =>
    Math.ceil(
        n / Math.pow(10, window.backendCache.config.token_decimals),
    ).toLocaleString();

export const IconToggleButton = ({
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
        <IconToggleButton
            title="Menu"
            onClick={onClick}
            pressed={pressed}
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
            let offsetBEBytes = intToBEBytes(offset);
            let lenBEBytes = intToBEBytes(len);
            let args = new Uint8Array(offsetBEBytes.length + lenBEBytes.length);
            args.set(offsetBEBytes);
            args.set(lenBEBytes, offsetBEBytes.length);
            // This allows us to see the bucket pics in dev mode.
            const api = window.backendCache.stats.buckets.every(
                ([id]) => id != bucket_id,
            )
                ? window.mainnet_api
                : window.api;
            return api
                .query_raw(bucket_id, "read", Buffer.from(args))
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
    classNameArg,
}: {
    value: string;
    testId?: any;
    map?: (arg: string) => string;
    displayMap?: (arg: any) => any;
    pre?: (arg: JSX.Element) => JSX.Element;
    post?: (arg: JSX.Element) => JSX.Element;
    classNameArg?: string;
}): JSX.Element {
    const [copied, setCopied] = React.useState(false);
    return (
        <span
            title="Copy to clipboard"
            className={`clickable ${classNameArg}`}
            onClick={async () => {
                try {
                    const cb = navigator.clipboard;
                    await cb.writeText(map(value));
                } catch (err) {
                    console.error(err);
                }
                setCopied(true);
            }}
            data-testid={testId}
        >
            {copied ? post(displayMap(value)) : pre(displayMap(value))}
        </span>
    );
}

export const intFromBEBytes = (bytes: Uint8Array) => {
    let buffer = bytes.buffer;
    let view = new DataView(buffer);
    return Number(view.getBigInt64(0, false)); // false for big endian
};

export const intToBEBytes = (val: number) => {
    let buffer = new ArrayBuffer(8);
    let view = new DataView(buffer);
    view.setBigInt64(0, BigInt(val), false); // false for big endian
    return new Uint8Array(buffer);
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
            let reason = "";
            let success = false;
            const max_size = window.backendCache.config.max_report_length;
            while (!success) {
                reason =
                    prompt(
                        `You are reporting this ${
                            domain == "post" ? "post" : "user"
                        } to stalwarts. ` +
                            (domain == "user"
                                ? `It is recommended to talk to stalwarts first. `
                                : "") +
                            `Reporting is a SERIOUS measure. ` +
                            `If there is a chance to convince a user to stop misbehaving, please do this without a report! ` +
                            `If the report gets rejected, you'll lose ` +
                            window.backendCache.config[
                                domain == "post"
                                    ? "reporting_penalty_post"
                                    : "reporting_penalty_misbehaviour"
                            ] +
                            ` credits and rewards. If you want to continue, please justify the report very well.`,
                        reason,
                    ) || "";
                if (reason.length == 0) return;
                if (reason.length > max_size) {
                    alert(
                        `The report has ${reason.length} characters, but has to have between 0 and ${max_size}. Please adjust accordingly.`,
                    );
                } else {
                    success = true;
                }
            }
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
    const { confirmed_by, rejected_by } = report;
    let tookAction =
        window.user?.id == report.reporter ||
        rejected_by.concat(confirmed_by).includes(window.user.id);
    let buttons: [string, boolean][] = [
        ["🛑 DISAGREE", false],
        ["✅ AGREE", true],
    ];
    return (
        <div className="banner">
            <strong>
                This {domain == "post" ? "post" : "user"} was REPORTED. Please
                confirm the deletion or reject the report.
            </strong>
            <Content value={report.reason} post={false} />
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

export function popUp<T>(content: JSX.Element): null | Promise<T> {
    const preview = document.getElementById("preview");
    if (!preview) return null;
    while (preview.hasChildNodes()) {
        let firstChild = preview.firstChild;
        if (firstChild) preview.removeChild(firstChild);
    }
    preview.style.display = "flex";
    preview.style.flexDirection = "column";
    preview.style.justifyContent = "center";
    const closePreview = () => (preview.style.display = "none");

    preview.onclick = (event) => {
        let target: any = event.target;
        if (target?.id == "preview") preview.style.display = "none";
    };
    const root = document.createElement("div");
    root.className = "popup_body";
    preview.appendChild(root);

    const promise = new Promise((resolve: (arg: T) => void) => {
        createRoot(root).render(
            <>
                <div
                    data-testid="popup-close-button"
                    className="clickable row_container bottom_spaced"
                    onClick={closePreview}
                >
                    <div style={{ marginLeft: "auto" }}>
                        <Close classNameArg="action" size={18} />
                    </div>
                </div>
                {React.cloneElement(content, {
                    popUpCallback: (arg: T) => {
                        closePreview();
                        resolve(arg);
                    },
                })}
            </>,
        );
    });

    return promise;
}

export function parseNumber(
    amount: string,
    tokenDecimals: number,
): number | null {
    const parse = (s: string): number | null => {
        let num = Number(s);
        if (isNaN(num)) {
            return null;
        }
        return num;
    };

    const tokens = amount.split(".");
    switch (tokens.length) {
        case 1:
            const parsedToken = parse(tokens[0]);
            return parsedToken !== null
                ? parsedToken * Math.pow(10, tokenDecimals)
                : null;
        case 2:
            let afterComma = tokens[1];
            while (afterComma.length < tokenDecimals) {
                afterComma = afterComma + "0";
            }
            afterComma = afterComma.substring(0, tokenDecimals);
            const parsedTokens = parse(tokens[0]);
            const parsedAfterComma = parse(afterComma);
            return parsedTokens !== null && parsedAfterComma !== null
                ? parsedTokens * Math.pow(10, tokenDecimals) + parsedAfterComma
                : null;
        default:
            return null;
    }
}

export const icrcTransfer = async (
    token: Principal,
    symbol: string,
    decimals: number,
    fee: number,
    to?: string,
) => {
    try {
        const input =
            to || prompt("Enter the recipient principal")?.trim() || "";
        if (!input) return;
        const recipient = Principal.fromText(input);
        const amount = parseNumber(
            prompt(
                `Enter the amount (fee: ${tokens(fee, decimals)} ${symbol})`,
            )?.trim() || "",
            decimals,
        );
        if (
            !amount ||
            !confirm(
                `You are transferring\n\n${tokens(
                    amount,
                    decimals,
                )} ${symbol}\n\nto\n\n${recipient}`,
            )
        )
            return;
        return await window.api.icrc_transfer(token, recipient, amount, fee);
    } catch (e) {
        return "Transfer failed";
    }
};

const DAY = 24 * 60 * 60 * 1000;

export const noiseControlBanner = (
    domain: "realm" | "user",
    filter: UserFilter,
    user: User,
) => {
    const err = checkUserFilterMatch(filter, user);
    const prefix =
        domain == "realm"
            ? "You cannot post to this realm"
            : "This user can't see notifications from you";
    return err ? (
        <div className="banner vertically_spaced">{`${prefix}: ${err}`}</div>
    ) : null;
};

const daysOld = (timestamp: bigint, days: number) =>
    (Number(new Date()) - Number(timestamp) / 1000000) / DAY < days;

const pending_or_recently_confirmed = (report: Report | undefined) =>
    report &&
    (!report.closed ||
        (report.confirmed_by.length > report.rejected_by.length &&
            daysOld(
                report.timestamp,
                window.backendCache.config.user_report_validity_days,
            )));

const controversialUser = (profile: User) =>
    profile.rewards < 0 ||
    pending_or_recently_confirmed(profile.report) ||
    Object.values(profile.post_reports).some((timestamp) =>
        daysOld(
            timestamp,
            window.backendCache.config.user_report_validity_days,
        ),
    );

const checkUserFilterMatch = (
    filter: UserFilter,
    user: User,
): string | null => {
    if (!filter || !user) return null;
    const { age_days, safe, balance, num_followers, downvotes } = filter;
    const { downvote_counting_period_days, user_report_validity_days } =
        window.backendCache.config;
    if (daysOld(user.timestamp, age_days)) {
        return "account age is too low";
    }
    if (safe && controversialUser(user)) {
        return `negative rewards or a report is pending or was confirmed in the last ${user_report_validity_days} days`;
    }
    if (balance * tokenBase() > user.balance) {
        return "token balance too low";
    }
    if (num_followers > user.followers.length) {
        return "number of followers insufficient";
    }
    if (downvotes > 0 && Object.entries(user.downvotes).length > downvotes) {
        return `number of downvotes on your posts in the last ${downvote_counting_period_days} days`;
    }

    return null;
};

export const hash = async (value: string, iterations: number) => {
    let hash = new TextEncoder().encode(value);
    for (let i = 0; i < iterations; i++)
        hash = new Uint8Array(await crypto.subtle.digest("SHA-256", hash));
    return hash;
};
