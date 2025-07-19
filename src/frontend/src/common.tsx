import * as React from "react";
// @ts-ignore
import DiffMatchPatch from "diff-match-patch";
import {
    CarretDown,
    Clipboard,
    ClipboardCheck,
    Close,
    Flag,
    Menu,
    Share,
} from "./icons";
import { loadFile } from "./form";
import {
    Meta,
    Post,
    PostId,
    Realm,
    Report,
    User,
    UserFilter,
    UserId,
} from "./types";
import { createRoot } from "react-dom/client";
import { Principal } from "@dfinity/principal";
import { IcrcAccount } from "@dfinity/ledger-icrc";
import { Content } from "./content";
import { MAINNET_MODE } from "./env";

export const REPO = "https://github.com/TaggrNetwork/taggr";

export const USD_PER_XDR = 1.39;

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
}) => {
    if (ids.length == 0) return null;
    const [realmsData, setRealmsData] = React.useState<Realm[]>([]);
    const [loaded, setLoaded] = React.useState(false);

    const loadData = async () => {
        setRealmsData((await window.api.query("realms", ids)) || []);
        setLoaded(true);
    };

    React.useEffect(() => {
        loadData();
    }, []);

    if (!loaded) return <Loading />;

    return (
        <div
            className={`row_container ${classNameArg || ""}`}
            style={{ alignItems: "center" }}
        >
            {realmsData.map((data, i) => (
                <RealmSpan
                    key={i}
                    name={ids[i]}
                    background={data.label_color}
                    classNameArg="clickable padded_rounded right_half_spaced top_half_spaced"
                />
            ))}
        </div>
    );
};

export const hex = (arr: number[]) =>
    Array.from(arr, (byte) =>
        ("0" + (byte & 0xff).toString(16)).slice(-2),
    ).join("");

export const MoreButton = ({
    callback,
    label = "MORE",
}: {
    callback: () => Promise<any>;
    label?: string;
}) => (
    <div style={{ display: "flex", justifyContent: "center" }}>
        <ButtonWithLoading
            classNameArg="top_spaced"
            onClick={callback}
            label={label}
        />
    </div>
);

export const FileUploadInput = ({
    classNameArg,
    callback,
}: {
    classNameArg?: string;
    callback: (arg: Uint8Array) => void;
}) => (
    <input
        type="file"
        data-testid="bin-file-picker"
        className={classNameArg}
        onChange={async (ev) => {
            const files = (
                (ev as unknown as DragEvent).dataTransfer || ev.target
            )?.files;
            if (!files) return;
            const file = files[0];
            const content = new Uint8Array(await loadFile(file));
            if (content.byteLength > MAX_POST_SIZE_BYTES) {
                showPopUp(
                    "error",
                    `The binary cannot be larger than ${MAX_POST_SIZE_BYTES} bytes.`,
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

export const NotAllowed = () => (
    <div className="text_centered vertically_spaced">
        <h1 style={{ fontSize: "4em" }}>
            <code>403</code>
        </h1>
        Not available on {domain()}
    </div>
);

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
    content?: JSX.Element | false;
    menu?: boolean;
    styleArg?: any;
    burgerTestId?: any;
}) => {
    const [showMenu, setShowMenu] = React.useState(false);
    const effStyle = { ...styleArg };
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
                            classNameArg="right_half_spaced"
                        />
                    )}
                    {button1}
                    {button2}
                    {menu && content && (
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

export const foregroundColor = (background: string) => {
    const light = (col: string) => {
        const hex = col.replace("#", "");
        const c_r = parseInt(hex.substring(0, 0 + 2), 16);
        const c_g = parseInt(hex.substring(2, 2 + 2), 16);
        const c_b = parseInt(hex.substring(4, 4 + 2), 16);
        const brightness = (c_r * 299 + c_g * 587 + c_b * 114) / 1000;
        return brightness > 155;
    };
    return light(background) ? "black" : "white";
};

export const RealmSpan = ({
    background,
    name,
    classNameArg,
    styleArg,
}: {
    background: string;
    name: string;
    classNameArg?: string;
    styleArg?: any;
}) => {
    if (!name) return null;
    const color = foregroundColor(background);
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
    if (styleArg) styleArg.fill = styleArg.color;
    return (
        <button
            title={`Share link to ${fullUlr}`}
            className={`medium_text ${classNameArg}`}
            style={styleArg}
            onClick={async (_) => {
                await navigator.clipboard.writeText(fullUlr);
                showPopUp("info", `Link copied to clipboard: ${fullUlr}`);
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
    disabled,
}: {
    id?: string;
    label: any;
    title?: string;
    onClick: () => Promise<any>;
    classNameArg?: string;
    styleArg?: any;
    testId?: any;
    disabled?: boolean;
}) => {
    let [loading, setLoading] = React.useState(false);
    return (
        <button
            id={id}
            title={title}
            disabled={disabled || loading}
            className={`medium_text ${
                loading || disabled
                    ? classNameArg?.replaceAll("active", "")
                    : classNameArg
            } ${disabled ? "inactive" : ""}`}
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
            className={`medium_text ${classNameArg}`}
            onClick={(e) => {
                e.preventDefault();
                setStatus(on ? -1 : 1);
                if (onTitle && offTitle)
                    showPopUp("success", on ? onTitle : offTitle);
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

export const tokenBase = () =>
    Math.pow(10, window.backendCache.config.token_decimals);

export const tokenBalance = (balance: number) =>
    (balance / tokenBase()).toLocaleString();

export const icpCode = (e8s: BigInt, decimals?: number, units = true) => (
    <code className="xx_large_text">
        {tokens(Number(e8s), decimals || 8, decimals == 0)}
        {units && " ICP"}
    </code>
);

export const shortenAccount = (account: string) =>
    `${account.slice(0, 6)}..${account.substr(account.length - 6)}`;

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
            {[md, md, md].map((v, i) => (
                <span key={i} style={{ opacity: i == dot % 3 ? 0.6 : 1 }}>
                    {v}
                </span>
            ))}
        </div>
    );
};

export const expandMeta = ([post, meta]: [Post, Meta]) => {
    post.meta = meta;
    return post;
};

export const loadFeed = async (ids: PostId[]) =>
    await window.api.query<[Post, Meta][]>("posts", ids);

export const loadPosts = async (ids: PostId[]) =>
    ((await loadFeed(ids)) || []).map(expandMeta);

export const blobToUrl = (blob: Uint8Array) =>
    URL.createObjectURL(
        new Blob([new Uint8Array(blob).buffer], { type: "image/png" }),
    );

export const isRoot = (post: Post) => post.parent == null;

export const token = (n: number) => Math.ceil(n / tokenBase()).toLocaleString();

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
        className={`button_text ${
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
    onClick: (event: React.MouseEvent) => void;
    pressed: boolean;
    testId?: any;
    styleArg?: { [name: string]: string };
}) => {
    const effStyle = { ...styleArg };
    effStyle.fill = effStyle.color;
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
                    showPopUp(
                        "error",
                        `The report has ${reason.length} characters, but has to have between 0 and ${max_size}. Please adjust accordingly.`,
                        5,
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
                    showPopUp("error", response.Err);
                    return;
                }
                showPopUp("success", "Report accepted! Thank you!");
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
                                    showPopUp("error", result.Err);
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

export function popUp<T>(content: JSX.Element): null | Promise<T | null> {
    const preview = document.getElementById("preview");
    if (!preview) return null;
    while (preview.hasChildNodes()) {
        let firstChild = preview.firstChild;
        if (firstChild) preview.removeChild(firstChild);
    }
    preview.style.display = "flex";
    preview.style.flexDirection = "column";
    preview.style.justifyContent = "center";

    const root = document.createElement("div");
    root.className = "popup_body";
    preview.appendChild(root);

    const promise = new Promise((resolve: (arg: T | null) => void) => {
        const closePreview = (arg: T | null) => {
            preview.style.display = "none";
            resolve(arg);
        };

        preview.onclick = (event) => {
            let target: any = event.target;
            if (target?.id == "preview") closePreview(null);
        };

        createRoot(root).render(
            <>
                <div
                    data-testid="popup-close-button"
                    className="clickable row_container bottom_spaced"
                    onClick={() => closePreview(null)}
                >
                    <div style={{ marginLeft: "auto" }}>
                        <Close classNameArg="action" size={18} />
                    </div>
                </div>
                {React.cloneElement(content, {
                    parentCallback: (arg: T) => {
                        closePreview(arg);
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
            : "You cannot interact with this user";
    return err ? (
        <div className="banner vertically_spaced">{`${prefix}: ${err}`}</div>
    ) : null;
};

const daysOld = (timestamp: bigint, days: number) =>
    (Number(new Date()) - Number(timestamp) / 1000000) / DAY < days;

const recently_confirmed = (report: Report | undefined) =>
    report &&
    report.closed &&
    report.confirmed_by.length > report.rejected_by.length &&
    daysOld(
        report.timestamp,
        window.backendCache.config.user_report_validity_days,
    );

const controversialUser = (profile: User) =>
    recently_confirmed(profile.report) ||
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
    const { age_days, safe, balance, num_followers } = filter;
    const { user_report_validity_days } = window.backendCache.config;
    if (daysOld(user.timestamp, age_days)) {
        return "account age is too low";
    }
    if (safe && controversialUser(user)) {
        return `a report is pending or was confirmed in the last ${user_report_validity_days} days`;
    }
    if (balance * tokenBase() > user.balance + user.cold_balance) {
        return "token balance too low";
    }
    if (num_followers > user.followers.length) {
        return "number of followers insufficient";
    }

    return null;
};

export const hash = async (value: string, iterations: number) => {
    let hash = new TextEncoder().encode(value);
    for (let i = 0; i < iterations; i++)
        hash = new Uint8Array(await crypto.subtle.digest("SHA-256", hash));
    return hash;
};

export const ArrowDown = ({ onClick }: { onClick?: () => void }) => (
    <div onClick={onClick} className="text_centered bottom_spaced top_spaced">
        <CarretDown classNameArg="action" />
    </div>
);

export function pfpUrl(userId: UserId) {
    const canisterId = window.backendCache?.stats?.canister_id;
    const host = MAINNET_MODE
        ? `https://${canisterId}.raw.icp0.io`
        : `http://127.0.0.1:8080`;
    return (
        `${host}/pfp/${userId}` +
        (MAINNET_MODE ? "" : `?canisterId=${canisterId}`)
    );
}

export const InfoPopup = ({
    type,
    message,
    duration,
}: {
    type: string;
    message: string;
    duration: number;
}) => {
    const [expiration, setExpiration] = React.useState(0);
    const [visible, setVisible] = React.useState(true);

    React.useEffect(() => {
        const interval = setInterval(() => {
            setExpiration((prev) => {
                const newValue = prev + 100 / (duration / 100);
                return newValue > 100 ? 100 : newValue;
            });
        }, 100);

        const timeout = setTimeout(() => {
            setVisible(false);
        }, duration);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [duration]);

    if (!visible) return null;

    let typeIcon;

    switch (type) {
        case "success":
            typeIcon = "✅";
            break;
        case "error":
            typeIcon = "⛔️";
            break;
        case "warning":
            typeIcon = "⚠️";
            break;
        default:
            typeIcon = "ℹ️";
    }

    // Capitalize the message and add punctation if needed.
    let formattedMessage = message[0].toUpperCase() + message.slice(1);
    if (
        ![".", "!", "?"].includes(formattedMessage[formattedMessage.length - 1])
    )
        formattedMessage += ".";

    return (
        <div className="info_popup">
            <div className="info_popup_content">
                <div className="info_popup_message vcentered">
                    <span className="xx_large_text right_spaced">
                        {typeIcon}
                    </span>{" "}
                    {formattedMessage}
                </div>
                <button
                    className="info_popup_close"
                    onClick={() => setVisible(false)}
                >
                    <Close size={14} />
                </button>
            </div>
            <div className="info_popup_timer">
                <div
                    className="info_popup_timer_indicator"
                    style={{ width: `${expiration}%` }}
                ></div>
            </div>
        </div>
    );
};

export const showPopUp = (
    type: string = "info",
    message: string,
    duration_secs: number = 3,
) => {
    const duration = duration_secs * 1000;
    let domElem = document.getElementById("info_popup_container");
    if (domElem)
        // Another pop up is in progress.
        return;

    domElem = document.createElement("div");
    domElem.id = "info_popup_container";
    document.body.appendChild(domElem);

    const root = createRoot(
        document.getElementById("info_popup_container") as HTMLElement,
    );
    root.render(
        <InfoPopup type={type} message={message} duration={duration} />,
    );

    // Clean up after the popup closes
    setTimeout(() => {
        root.unmount();
        domElem.parentNode?.removeChild(domElem);
    }, duration + 100); // Add a little buffer time
};

export const signOut = async () => {
    localStorage.clear();
    sessionStorage.clear();
    window.authClient.logout();
    restartApp();
    return true;
};

export const restartApp = async () => {
    location.reload();
};

export function bucket_image_url(
    bucket_id: string,
    offset: number,
    len: number,
) {
    // Fall back to the mainnet if the local config doesn't contain the bucket.
    let fallback_to_mainnet = !window.backendCache.stats?.buckets?.find(
        ([id, _y]) => id == bucket_id,
    );
    let host =
        MAINNET_MODE || fallback_to_mainnet
            ? `https://${bucket_id}.raw.icp0.io`
            : `http://127.0.0.1:8080`;
    return (
        `${host}/image?offset=${offset}&len=${len}` +
        (MAINNET_MODE ? "" : `&canisterId=${bucket_id}`)
    );
}

export function createChunks<T>(arr: T[], size: number) {
    return [...Array(Math.ceil(arr.length / size))].map((_, i) =>
        arr.slice(size * i, size + size * i),
    );
}

export const DropDown = ({
    children,
    // absolute x-offset in the viewport
    offset,
}: {
    children: React.ReactNode;
    offset: number;
}) => {
    if (
        !children ||
        (Array.isArray(children) && children.filter(Boolean).length == 0)
    )
        return null;

    let localOffset = 0;
    const rect = document.getElementById("header")?.getBoundingClientRect();
    if (rect) {
        localOffset =
            offset - rect.left - 3 /* no idea why these 3px are needed */;
    }

    return (
        <div
            className="drop_down"
            style={{
                position: "relative",
            }}
        >
            {localOffset > 0 && (
                <div
                    className="triangle"
                    style={{
                        position: "absolute",
                        top: "-8px", // Move it up to stick out from the top
                        left: `${localOffset}px`,
                        width: "20px",
                        height: "20px",
                        transform: `rotate(45deg)`,
                        transformOrigin: "center center",
                    }}
                />
            )}
            {children}
        </div>
    );
};

export const domain = () => window.location.hostname;

// Checks if the post is supported on the current domain
export function postAllowed(post: Post) {
    const config = window.backendCache.domains[domain()];
    if (!config) return true;

    const downvoteId = 1;
    const downvotes = post.reactions[downvoteId]?.length;
    if (downvotes > config.max_downvotes) return false;

    if (!post.realm) return true;

    if ("WhiteListedRealms" in config.sub_config) {
        return config.sub_config.WhiteListedRealms.includes(post.realm);
    }

    if ("BlackListedRealms" in config.sub_config) {
        return !config.sub_config.BlackListedRealms.includes(post.realm);
    }

    return true;
}

export const UnavailableOnCustomDomains = ({
    component = "This functionality",
    classNameArg,
}: {
    component?: string;
    classNameArg?: string;
}) => (
    <div className={`banner ${classNameArg}`}>
        {component} is unavailable on {domain()}. Please switch to the{" "}
        <a href={`https://${getCanonicalDomain()}`}>canonical domain</a>.
    </div>
);

export const getCanonicalDomain = () =>
    `${window.backendCache.stats.canister_id}.icp0.io`;

export const onCanonicalDomain = () =>
    !MAINNET_MODE || domain() == getCanonicalDomain();
