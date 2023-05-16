import * as React from "react";
import { Content } from './content';
import DiffMatchPatch from 'diff-match-patch';
import { Clipboard, ClipboardCheck, Flag, Menu, Share} from "./icons";
import {loadFile, MAX_POST_SIZE_BYTES} from "./form";

export const percentage = (n, total) => {
    let p = Math.ceil(parseInt(n) / (total || 1) * 10000) / 100;
    return `${p}%`;
}

export const hex = arr => Array.from(arr, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');

export const FileUploadInput = ({classNameArg, callback}) =>
    <input type="file" className={classNameArg} style={{maxWidth: "90%"}} onChange={async ev => {
        const file = (ev.dataTransfer || ev.target).files[0];
        const content = new Uint8Array(await loadFile(file));
        if (content.byteLength > MAX_POST_SIZE_BYTES) {
            alert(`Error: the binary cannot be larger than ${MAX_POST_SIZE_BYTES} bytes.`);
            return;
        }
        callback(content);
    }} />;

export const microSecsSince = timestamp => Number(new Date()) - parseInt(timestamp) / 1000000;

export const hoursTillNext = (interval, last) => Math.ceil(interval / 1000000 / 3600000 - microSecsSince(last) / 3600000);

export const commaSeparated = items => interleaved(items, ', ');

export const interleaved = (items, link) => items.length ? items.reduce((prev, curr) => [prev, link, curr]) : [];

export const NotFound = () => <Content classNameArg="spaced" value="# 404 Not found" />;

export const Unauthorized = () => <Content classNameArg="spaced" value="# 401 Unauthorized" />;

export const bigScreen = () => window.screen.availWidth >= 1024;

export const RealmRibbon = ({col, name}) => 
    <RealmSpan name={name} col={col} classNameArg="realm_tag monospace" onClick={() => location.href = `/#/realm/${name}`} />;

export const HeadBar = ({title, shareLink, shareTitle, content, menu, styleArg}) => {
    const [showMenu, setShowMenu] = React.useState(false);
    return <div className="column_container stands_out bottom_spaced" style={styleArg}>
        <div className="vcentered">
            <div className={`max_width_col ${bigScreen() ? "x_large_text" : "larger_text"}`}>{title}</div>
            <div className="vcentered flex_ended">
                {shareLink && <ShareButton styleArg={styleArg} url={shareLink} title={shareTitle} classNameArg="right_half_spaced" />}
                {menu && <BurgerButton onClick={() => setShowMenu(!showMenu)} pressed={showMenu} />}
                {!menu && content}
            </div>
        </div>
        {menu && showMenu && <div className="top_spaced">{content}</div>}
    </div>;
}

export const realmColors = (name, col) => {
    const light = col => {
        const hex = col.replace('#', '');
        const c_r = parseInt(hex.substring(0, 0 + 2), 16);
        const c_g = parseInt(hex.substring(2, 2 + 2), 16);
        const c_b = parseInt(hex.substring(4, 4 + 2), 16);
        const brightness = ((c_r * 299) + (c_g * 587) + (c_b * 114)) / 1000;
        return brightness > 155;
    };
    const effCol = col || (backendCache.realms[name] || [])[0] || "#ffffff";
    return [effCol, light(effCol) ? "black" : "white"];
};

export const RealmSpan = ({col, name, classNameArg, onClick}) => {
    if (!name) return null;
    const [background, color] = realmColors(name, col);
    return <span className={classNameArg || null} onClick={onClick} style={{background, color, whiteSpace: "nowrap"}}>{name}</span>;
};


export const ShareButton = ({classNameArg = null, title = "Check this out", url, styleArg}) => {
    const effStyle = styleArg || {};
    effStyle.flex = 0;
    effStyle.fill = effStyle.color;
    return <button className={classNameArg} style={effStyle}
        onClick={async _ => { 
            const fullUlr = `https://${backendCache.config.domains[0]}/${url}`;
            if (navigator.share) navigator.share({title, url: fullUlr});
            else {
                await navigator.clipboard.writeText(fullUlr);
                alert(`Copied to clipboard: ${fullUlr}`);
            } 
        }}><Share styleArg={effStyle} />
    </button>;
};

const regexp = /[\p{Letter}\p{Mark}|\d|\-|_]+/gu;
export const getTokens = (prefix, value) => {
    const tokens = value.split(/\s+/g)
        .filter(token => {
            const postfix = token.slice(1);
            if (!postfix.match(regexp) || !isNaN(postfix)) return false;
            for (let c of prefix) if (c == token[0]) return true;
            return false;
        })
        .map(token => token.match(regexp)[0]);
    const list = [...new Set(tokens)];
    list.sort((b, a) => a.length - b.length);
    return list;
};

export const setTitle = value => document.getElementsByTagName("title")[0].innerText = `TAGGR: ${value}`;

export const ButtonWithLoading = ({label, onClick, classNameArg, styleArg}) => {
    let [loading, setLoading] = React.useState(false);
    if (loading) return <Loading spaced={false} />;
    return <button className={`${classNameArg}`} style={styleArg || null} onClick={async e => {
        e.preventDefault();
        setLoading(true);
        await onClick();
        setLoading(false);
    }}>
        {label}
    </button>;
};

export const ToggleButton = ({toggler, classNameArg, currState, offLabel = "FOLLOW", onLabel = "UNFOLLOW"}) => {
    // -1: not following, 0: unknown, 1: following
    let [status, setStatus] = React.useState(0);
    let on = status == 1 || status == 0 && currState();
    return <button className={`${classNameArg}`} onClick={e => {
        e.preventDefault();
        setStatus(on ? -1 : 1);
        toggler();
    }}>
        {on ? onLabel: offLabel}
    </button>;
};

export const timeAgo = (timestamp, absolute) => {
    timestamp = parseInt(timestamp) / 1000000;
    const diff = Number(new Date()) - timestamp;
    const minute = 60 * 1000;
    const hour = minute * 60;
    const day = hour * 24;
    switch (true) {
        case !absolute && diff < minute:
            const seconds = Math.round(diff / 1000);
            return `${seconds}s ago`
        case !absolute && diff < hour:
            return Math.round(diff / minute) + 'm ago';
        case !absolute && diff < day:
            return Math.round(diff / hour) + 'h ago';
        case diff < 90 * day:
            return `${new Intl.DateTimeFormat('default', {
                month: 'short',
                day: 'numeric',
            }).format(timestamp)}`;
        default:
            return `${new Intl.DateTimeFormat('default', {
                year: '2-digit',
                month: 'short',
                day: 'numeric',
            }).format(timestamp)}`;
    }
};

export const tokenBalance = balance => (balance / Math.pow(10, backendCache.config.token_decimals)).toLocaleString();

export const icpCode = (e8s, decimals, units = true) => <code className="xx_large_text">{icp(e8s, decimals)}{units && " ICP"}</code>;

export const icp = (e8s, decimals = false) => {
    let n = parseInt(e8s);
    let base = Math.pow(10, 8);
    let v = n / base;
    return (decimals ? v : Math.floor(v)).toLocaleString()
}

export const ICPAccountBalance = ({address, decimals, units, heartbeat}) => {
    const [e8s, setE8s] = React.useState(0);
    React.useEffect(() => { api.account_balance(address).then(setE8s); }, [address, heartbeat])
    return icpCode(e8s, decimals, units);
}

export const IcpAccountLink = ({address, label}) => 
    <a target="_blank" href={`https://dashboard.internetcomputer.org/account/${address}`}>{label}</a>;

export const Loading = ({classNameArg, spaced = true}) => {
    const [dot, setDot] = React.useState(0);
    const md = <span> ■ </span>;
    React.useEffect(() => { setTimeout(() => setDot(dot+1), 200); }, [dot]);
    return <div className={`${classNameArg} ${spaced ? "vertically_spaced" : ""} accent small_text text_centered left_spaced right_spaced`}>
        {[md, md, md].map((v, i) => i == dot % 3
            ? <span key={i} style={{opacity: 0.5}}>{v}</span>
            : v)}
    </div>;
};

export const loadPost = async (api, id) => {
    const posts = (await api.query("posts", [id])).map(postUserToPost);
    return posts[0] || null;
};

export const postUserToPost = post => {
    const id = post.user;
    const { users, karma } = window.backendCache;
    post.user = { id, name: users[id], karma: karma[id] };
    return post;
};

export const blobToUrl = blob => URL.createObjectURL(new Blob([new Uint8Array(blob).buffer], { type: 'image/png' }));

export const isRoot = post => post.parent == null;

export const UserLink = ({id}) => <a href={`#/user/${id}`}>{backendCache.users[id] || "?"}</a>;

export const userList = (ids = []) => commaSeparated(ids.map(id => <UserLink key={id} id={id} />));

export const token = n => Math.ceil(n / Math.pow(10, backendCache.config.token_decimals)).toLocaleString();

export const ReactionToggleButton = ({icon, onClick, pressed, classNameArg, testId = null}) => 
    <button data-meta="skipClicks" onClick={e => { e.preventDefault(); onClick(e)}}
        data-testid={testId}
        className={`${pressed ? "" : "un"}selected reaction_button vcentered ${classNameArg}`}>
        {icon}
    </button>;

export const BurgerButton = ({onClick, pressed, testId = null}) => <ReactionToggleButton onClick={onClick} pressed={pressed} icon={<Menu />} testId={testId} />

export const loadPostBlobs = async (files) => {
    const ids = Object.keys(files);
    const blobs = await Promise.all(ids.map(async id => {
        const [blobId, bucket_id] = id.split("@");
        const [offset, len] = files[id];
        const arg = Buffer.from(intToBEBytes(offset).concat(intToBEBytes(len)));
        // This allows us to see the bucket pics in dev mode.
        const api = backendCache.stats.buckets.every(([id, ]) => id != bucket_id) ? window.mainnet_api : window.api;
        return api.query_raw(bucket_id, "read", arg).then(blob => [blobId, blob]);
    }));
    return blobs.reduce((acc, [blobId, blob]) => {
        acc[blobId] = blob;
        return acc;
    }, {});
};

export const objectReduce = (obj, f, initVal) => Object.keys(obj).reduce((acc, key) => f(acc, key, obj[key]), initVal);

const dmp = new DiffMatchPatch();
export const getPatch = (A, B) => dmp.patch_toText(dmp.patch_make(A, B));
export const applyPatch = (text, patch) => dmp.patch_apply(dmp.patch_fromText(patch), text);

export const reactionCosts = () => backendCache.config.reactions.reduce((acc, [id, cost, _]) => { acc[id] = cost; return acc }, {});

export const CopyToClipboard = ({value, 
    pre = value => <span><code>{value}</code> <Clipboard /></span>, 
    post = value => <span><code>{value}</code> <ClipboardCheck /></span>,
    displayMap = e => e,
    map = e => e,
    testId = null
}) => {
    const [copied, setCopied] = React.useState(false)
    return <span onClick={async () => {
        const cb = navigator.clipboard;
        await cb.writeText(map(value));
        setCopied(true);
    }} data-testid={testId}>{copied ? post(displayMap(value)) : pre(displayMap(value))}</span>;
}

export const intFromBEBytes = bytes => bytes.reduce((acc, value) => acc * 256 + value, 0);

export const intToBEBytes = val => {
    const bytes = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let index = bytes.length-1; index >= 0; index--) {
        bytes[index] = val & 0xff;
        val = val >> 8;
    }
    return bytes;
};

export const FlagButton = ({id, domain}) => <ButtonWithLoading classNameArg="max_width_col"
    onClick={async () => {
        let reason = prompt(`You are reporting this ${domain == "post" ? "post" : "user"} to stalwarts. ` +
        `If the report gets rejected, you'll lose ` +
        (backendCache.config[domain == "post" ? "reporting_penalty_post" : "reporting_penalty_misbehaviour"]) +
        ` cycles and karma. If you want to continue, please justify the report.`);
        if (reason) {
            let response = await api.call("report", domain, id, reason);
            if ("Err" in response) {
                alert(`Error: ${response.Err}`);
                return;
            }
            alert("Report accepted! Thank you!")
        };
    }} label={<Flag />} />;

export const ReportBanner = ({id, reportArg, domain}) => {
    const [report, setReport] = React.useState(reportArg);
    const { reporter, confirmed_by, rejected_by} = report;
    let tookAction = rejected_by.concat(confirmed_by).includes(api._user.id) ;
    return <div className="post_head banner">
        <h3>
            This {domain == "post" ? "post" : "user"} was <b>REPORTED</b> by&nbsp;
            <a href={`/#/user/${reporter}`}>{backendCache.users[reporter]}</a>.
            Please confirm the deletion or reject the report.
        </h3>
        <h4>Reason: {report.reason}</h4>
        {tookAction && <div className="monospace medium_text">
            {confirmed_by.length > 0 && <div>CONFIRMED BY {userList(confirmed_by)}</div>}
            {rejected_by.length > 0 && <div>REJECTED BY {userList(rejected_by)}</div>}
        </div>}
        {!tookAction && <div className="row_container" style={{justifyContent: "center"}}>
            {[["🛑 DISAGREE", false], ["✅ AGREE", true]].map(([label, val]) =>
            <ButtonWithLoading key={label} onClick={async () => {
                let result = await api.call("vote_on_report", domain, id, val);
                if ("Err" in result) {
                    alert(`Error: ${result.Err}`);
                    return;
                }
                setReport((domain == "post" 
                    ? await loadPost(api, id)
                    : await api.query("user", [id.toString()])
                ).report);
            }} label={label} />)}
        </div>}
    </div>;
};
