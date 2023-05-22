import * as React from "react";
import { Content, CUT } from './content';
import { bigScreen, blobToUrl, ButtonWithLoading, getTokens, Loading, ReactionToggleButton } from './common';
import {Poll} from './poll';
import {Bars, Code, Cycles, Pic, Link, List, ListNumbered, Paperclip, Quote, Table} from "./icons";
import {postDataProvider, Post} from "./post";

const MAX_IMG_SIZE = 16777216;
const MAX_SUGGESTED_TAGS = 5;
export const MAX_POST_SIZE_BYTES = Math.ceil(1024 * 1024 * 1.9);

export const Form = ({postId = null, comment, realmArg = "", expanded, submitCallback, writingCallback = () => {}, repost = null, blobs, content}) => {
    const draftKey = `draft_for_${comment? "comment" : "post"}_${postId}`;
    const [value, setValue] = React.useState("");
    const [realm, setRealm] = React.useState(realmArg);
    const [submitting, setSubmitting] = React.useState(false);
    const [lines, setLines] = React.useState(3);
    const [dragAndDropping, setDragAndDropping] = React.useState(false);
    const [tmpBlobs, setTmpBlobs] = React.useState([]);
    const [busy, setBusy] = React.useState(false);
    const [poll, setPoll] = React.useState(null);
    const [showTextField, setShowTextField] = React.useState(!!localStorage.getItem(draftKey) || expanded);
    const [suggestedTags, setSuggestedTags] = React.useState([]);
    const [suggestedUsers, setSuggestedUsers] = React.useState([]);
    const [choresTimer, setChoresTimer] = React.useState(null);
    const [cursor, setCursor] = React.useState(0);
    const textarea = React.useRef();
    const tags = window.backendCache.recent_tags;
    const users = Object.values(window.backendCache.users); 
    const { max_post_length, max_blob_size_bytes } = backendCache.config;

    const handleSubmit = async () => {
        if (ref.current?.clientHeight > window.innerHeight && !value.trim().includes(CUT)) {
            alert("Your post does not fit on screen without scrolling.\n\nPlease add a cut line (three empty lines) after the introductory part.");
            return false;
        }
        let parts = value.trim().split(CUT);
        if (parts.length > 1 && parts[0].length > parts[1].length) {
            alert("The cut is not placed after the introductory part.");
            return false;
        }
        if (value.length == 0 || value.length > max_post_length) {
            alert(`Post length should be larger than 0 and shorter than ${max_post_length} characters.`);
            return false;
        }
        setSubmitting(true);
        const blobArrays = Object.keys(tmpBlobs).reduce((acc, id) => {
            if (value.includes(`(/blob/${id})`)) {
                acc.push([id, [...tmpBlobs[id]]]);
            }
            return acc;
        }, []);
        const postSize = value.length + blobArrays.reduce((acc, [_, blob]) => acc + blob.length, 0);
        if(postSize > MAX_POST_SIZE_BYTES) {
            alert("Currently a single post cannot be larger than 2MB to be submitted.");
        } else if ((value.match(/!\[.*?\]\(\/blob\/.*?\)/g) || []).length != blobArrays.length) {
            alert("You're referencing pictures that are not attached anymore. Please re-upload.");
        } else {
            let extension;
            if (poll) {
                extension = { Poll: poll };
            } else if (repost) {
                extension = { Repost: repost }
            };
            await submitCallback(value, blobArrays, extension, realm);
            setValue("");
            localStorage.removeItem(draftKey); 
        }
        setLines(3);
        setShowTextField(false);
        setSubmitting(false);
    };

    const dragOverHandler = ev => {
        setDragAndDropping(true);
        ev.preventDefault();
    };

    const dropHandler = async ev => {
        ev.preventDefault();
        setBusy(true);
        const files = (ev.dataTransfer || ev.target).files;
        let fileLinks = "";
        for (let i = 0; i < files.length; i++){
            let file = files[i];
            let content = await loadFile(file);
            let image = await loadImage(content);
            if (iOS() && image.height * image.width > MAX_IMG_SIZE) {
                alert("Image resolution should be under 16 megapixels.");
                setBusy(false);
                return;
            }
            let resized_content = content, low = 0, high = 100;
            if (content.byteLength > max_blob_size_bytes)
                while (true) {
                    const scale = (low + high) / 2;
                    resized_content = await resize(content, scale / 100);
                    const ratio = resized_content.byteLength / max_blob_size_bytes;
                    if (ratio < 1 && (0.92 < ratio || low > 99)) {
                        break;
                    } else if (ratio > 1) {
                        content = resized_content;
                        high = 100;
                    } else {
                        low = scale;
                    }
                }
            const size = Math.ceil(resized_content.byteLength / 1024);
            resized_content = new Uint8Array(resized_content);
            let key = await hash(resized_content);
            tmpBlobs[key] = resized_content;
            setTmpBlobs(tmpBlobs);
            image = await loadImage(resized_content);
            fileLinks += `![${image.width}x${image.height}, ${size}kb](/blob/${key})\n`;
            setDragAndDropping(false);
        }
        setValue(value.slice(0, cursor) + "\n" + fileLinks + "\n" + value.slice(cursor));
        setBusy(false);
    };

    const onValueChange = value => {
        setValue(value);
        clearTimeout(choresTimer);
        const cursor = textarea.current?.selectionStart-1;
        const suggestedTags = suggestTokens(cursor, value, tags, "#");
        setSuggestedTags(suggestedTags);
        const suggestedUsers = suggestTokens(cursor, value, users, "@");
        setSuggestedUsers(suggestedUsers);
        setChoresTimer(setTimeout(() => localStorage.setItem(draftKey, value), 1500));
        writingCallback(value);
    };

    const maybeInsertSuggestion = event => {
        let pos = textarea.current?.selectionStart;
        setCursor(pos);
        if (event.charCode == 13) {
            const cursor = pos - 1;
            const suggestedTags = suggestTokens(cursor, value, tags, "#");
            const suggestedUsers = suggestTokens(cursor, value, users, "@");
            if (suggestedTags.length) {
                insertSuggestion(event, "#", suggestedTags[0]);
            } else if (suggestedUsers.length) {
                insertSuggestion(event, "@", suggestedUsers[0]);
            }
        }
    };

    const insertSuggestion = (event, trigger, token) => {
        event.preventDefault();
        const cursor = textarea.current?.selectionStart;
        let i;
        for (i = cursor; value[i] != trigger; i--) {};
        setValue(value.slice(0, i+1) + token + value.slice(cursor) + " ");
        setSuggestedTags([]);
        setSuggestedUsers([]);
        setFocus();
    }

    const setFocus = () => {
        if(textarea.current && !content) textarea.current.focus(); 
    };

    const id = `form_${postId}_${lines}`;

    React.useEffect(() => setTmpBlobs(blobs || []), [blobs]);
    React.useEffect(() => setRealm(realmArg), [realmArg]);
    React.useEffect(() => {
        const effContent = content || localStorage.getItem(draftKey) || "";
        setValue(effContent);
        setLines(effContent.split('\n').length + 2);
    }, [content]);
    React.useEffect(() => setFocus(), [showTextField, focus]);
    const ref = React.useRef();

    const self = document.getElementById(id);
    if (self && self.clientHeight < self.scrollHeight) setLines(lines + 2);

    let trigger = "", completionList = [];
    if (suggestedTags.length) {
        trigger = "#";
        completionList = suggestedTags;
    } else {
        trigger = "@";
        completionList = suggestedUsers;
    }

    const previewAtLeft = bigScreen() && !comment;
    const isRepost = repost != null && !isNaN(repost);
    const showPreview = value || isRepost;

    const preview = <article ref={ref} className={`bottom_spaced max_width_col ${postId == null ? "prime" : ""} framed`}>
        <Content post={true} blobs={tmpBlobs} value={value} preview={true} primeMode={postId == null} />
        {poll && <Poll poll={poll} created={Number(new Date()) * 1000000} />}
        {isRepost && React.useMemo(() => <Post id={repost} data={postDataProvider(repost, null, "post_only")} repost={true} classNameArg="repost" />, [repost])}
    </article>;

    const formButton = (content, map) => <button className="max_width_col"
        onClick={e => {
            e.preventDefault();
            const element = textarea.current;
            const start = element.selectionStart;
            const end = element.selectionEnd;
            const selection = element.value.substring(start, end);
            setValue(value.slice(0, start) + map(selection) + value.slice(end));
            element.focus();
        }}>
        {content}
    </button>;

    return <div onDrop={dropHandler} onDragOver={dragOverHandler} className="column_container">
        {!showTextField && <input type="text" className="bottom_half_spaced"
            placeholder="Reply here..."
            onFocus={() => setShowTextField(true)} /> }
        {showTextField && 
            <form className={`${submitting ? "inactive" : ""} column_container bottom_spaced`} autoFocus>
                <div className="row_container">
                    {previewAtLeft && showPreview ? preview : null}
                    <div className={`column_container max_width_col ${previewAtLeft && showPreview ? "left_half_spaced" : ""}`}>
                        <div className="row_container bottom_half_spaced">
                            {formButton(<b>B</b>, v => `**${v}**`)}
                            {formButton(<i>I</i>, v => `_${v}_`)}
                            {formButton(<s>S</s>, v => `~${v}~`)}
                            {formButton(<List />, v => v.split('\n').map(line => "- " + line).join('\n'))}
                            {formButton(<ListNumbered />, v => v.split('\n').map((line, i) => (i+1) + ". " + line).join('\n'))}
                            {formButton(<Quote />, v => `> ${v}`)}
                            {formButton(<Link />, v => `[${v}](${prompt("URL:")})`)}
                            {formButton(<Pic />, v => `![${prompt("Image name")}](${prompt("URL")})`)}
                            {formButton(<Code />, v => `\`${v}\``)}
                            {formButton(<Table />, _ => tableTemplate)}
                        </div>
                        <textarea id={id} ref={textarea} rows={lines} disabled={submitting} value={value}
                        onKeyPress={maybeInsertSuggestion} 
                        onKeyUp={() => setCursor(textarea.current?.selectionStart)}
                        onFocus={() => setCursor(textarea.current?.selectionStart)}
                        className={`max_width_col ${dragAndDropping ? "active_element" : null}`}
                        onChange={event => onValueChange(event.target.value)}></textarea>
                    </div>
                </div>
                {busy && <Loading classNameArg="top_spaced" spaced={false} />}
                {!busy && completionList.length > 0 && <div className="monospace small_text top_spaced">
                    {completionList.map((token, i) => 
                    <button key={token} className={`right_spaced bottom_half_spaced ${i ? "" : "active"}`}
                        onClick={e =>  insertSuggestion(e, trigger, token)}>{`${trigger}${token}`}</button>)}
                </div>}
                {!busy && completionList.length == 0 &&
                    <div className="spaced vcentered top_half_spaced">
                        <div className="vcentered max_width_col flex_ended">
                            <div className="max_width_col"></div>
                            <Cycles /><code className="left_half_spaced" data-testid="cycle-cost">{`${costs(value, poll ? 1 : 0)}`}</code>
                            <label id="file_picker_label" htmlFor="file-picker" className="action left_spaced clickable" data-testid="file-picker"><Paperclip /></label>
                            <input id="file-picker" style={{display: "none"}} type="file" multiple accept="image/*" onChange={dropHandler} />
                            {postId == null && !isRepost && <ReactionToggleButton classNameArg="left_spaced" icon={<Bars />} pressed={!!poll}
                                onClick={() => setPoll(poll && confirm("Delete the poll?") 
                                    ? null 
                                    : (poll || { options: ["Option 1", "Option 2"], votes: {}, deadline: 24 }))} />}
                            {!comment && api._user.realms.length > 0 && <select value={realm || ""}
                                className="small_text left_spaced"
                                onChange={event => setRealm(event.target.value)}>
                                <option value="">{backendCache.config.name.toUpperCase()}</option>
                                {api._user.realms.map(name => <option key={name} value={name}>{name}</option>)}
                            </select>}
                            <ButtonWithLoading classNameArg="active left_spaced" label="SEND" onClick={handleSubmit} />
                        </div>
                    </div>}
            </form>}
        {poll && <div className="monospace column_container bottom_spaced">
            <h2>Poll</h2>
            VARIANTS (ONE PER LINE):
            <textarea rows={poll.options.length+2} className="monospace bottom_spaced" value={poll.options.join("\n")}
                onChange={e => setPoll({ ...poll, options: e.target.value.split("\n") })}></textarea>
            EXPIRATION:
            <select value={poll.deadline} onChange={e => setPoll({...poll, deadline: parseInt(e.target.value) })}>
                {[1,2,3,4,5,6,7].map(d => <option key={d} value={`${d * 24}`}>{`${d} DAY${d == 1 ? "" : "S"}`}</option>)}
            </select>
        </div>}
        {!previewAtLeft && showPreview && preview}
    </div>;
}

const costs = (value, poll) => {
    const tags = getTokens("#$", value).length;
    const images = (value.match(/\(\/blob\/.+\)/g) || []).length;
    const paid_tags = Math.max(0, tags);
    const { post_cost, tag_cost, blob_cost, poll_cost } = backendCache.config;
    return Math.max(post_cost, paid_tags * tag_cost) + images * blob_cost + poll * poll_cost;
}

export const loadFile = file => {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
        reader.onerror = () => {
            reader.abort();
            reject(alert("Couldn't upload file!"));
        };
        reader.onload = () => resolve(reader.result);
        reader.readAsArrayBuffer(file);
    });
};

const loadImage = blob => {
    const image = new Image();
    return new Promise((resolve) => {
        image.onload = () => resolve(image);
        image.src = blobToUrl(blob);
    });
};

const canvasToBlob = canvas => new Promise(
    resolve => canvas.toBlob(
        blob => blob.arrayBuffer().then(resolve),'image/jpeg', 0.5
    )
);

const hash = async buffer => {
    const result = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(result)).slice(0, 4);
    return hashArray
        .map(bytes => bytes.toString(16).padStart(2, '0'))
        .join('')
}

const resize = async (blob, scale) => {
    const image = await loadImage(blob);
    const canvas = downScaleImage(image, scale);
    return await canvasToBlob(canvas);
};

const suggestTokens = (cursor, value, tokens, trigger) => {
    let currentTag = ""
    let i;
    for (i = cursor; i >= 0 && value[i].match(/(\p{L}|-|\d)/gu); i--) {
        currentTag = value[i] + currentTag;
    }
    if (value[i] == trigger) {
        const result = tokens
            .filter(tag => tag.length > currentTag.length)
            .filter(tag => tag.toLowerCase().startsWith(currentTag.toLowerCase()))
            .map(tag => currentTag + tag.slice(currentTag.length, tag.length));
        result.sort((a, b) => { if (a.length != b.length) { return a.length - b.length} else { return a < b } });
        return result.slice(0, MAX_SUGGESTED_TAGS);
    }
    return []
};

// scales the image by (float) scale < 1
// returns a canvas containing the scaled image.
function downScaleImage(img, scale) {
    let width = img.width;
    let height = img.height;
    const MAX_WIDTH = width * scale;
    const MAX_HEIGHT = height * scale;
    // Change the resizing logic
    if (width > height) {
        if (width > MAX_WIDTH) {
            height = height * (MAX_WIDTH / width);
            width = MAX_WIDTH;
        }
    } else {
        if (height > MAX_HEIGHT) {
            width = width * (MAX_HEIGHT / height);
            height = MAX_HEIGHT;
        }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}

const iOS = () => [ 'iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod' ].includes(navigator.platform);

const tableTemplate = "\n| XXX | YYY | ZZZ |\n"
    + "|-----|:---:|----:|\n"
    + "|  A  |  B  |  C  |\n"
    + "|  D  |  E  |  F  |\n";
