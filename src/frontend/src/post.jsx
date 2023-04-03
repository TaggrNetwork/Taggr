import * as React from "react";
import { Form } from './form';
import { Content } from './content';
import { Poll } from './poll';
import { isRoot, BurgerButton, reactions, timeAgo, ToggleButton, NotFound, applyPatch, loadPostBlobs, ShareButton, commaSeparated, Loading, objectReduce, reactionCosts, postUserToPost, loadPost,
    ReactionToggleButton, RealmRibbon, setTitle, ButtonWithLoading, bigScreen, UserLink, FlagButton, ReportBanner } from './common';
import {PostFeed} from "./post_feed";
import {reaction2icon, Edit, Save, Unsave, Watch, Unwatch, Repost, Coin, New, CommentArrow, CarretRight, Trash, Comment } from "./icons";
import {Proposal} from "./proposals";

export const postDataProvider = (id, preloadedData = null, rootOnly = false) => {
    const provider = { root: id, source: {} };
    const load = async () => {
        if (rootOnly) {
            const post = await loadPost(api, id);
            if (!post) provider.notFound = true;
            else provider.source[id] = post;
            return
        }
        const tree = await api.query("tree", id);
        if (Object.keys(tree).length == 0) {
            provider.notFound = true;
            return;
        }
        Object.keys(tree).forEach(id => tree[id] = postUserToPost(tree[id]));
        provider.source = tree;
    }
    provider.load = load;
    if (preloadedData) provider.source[id] = preloadedData;
    return provider;
};

export const Post = ({id, data, version, isFeedItem, repost, classNameArg, isCommentView, isThreadView, focused, highlighted = [], level = 0}) => {
    const [post, setPost] = React.useState(data.source[id]);
    const [blobs, setBlobs] = React.useState({});
    const [showComments, toggleComments] = React.useState(!isFeedItem && !repost);
    const [showInfo, toggleInfo] = React.useState(false);
    const [expanded, toggleExpansion] = React.useState(!isFeedItem && !repost);
    const [fullTreeIsLoading, setFullTreeIsLoading] = React.useState(false);
    const [rendering, setRendering] = React.useState(true);
    const [safeToOpen, setSafeToOpen] = React.useState(false);
    const [commentIncoming, setCommentIncoming] = React.useState(false);
    const [reactionTimer, setReactionTimer] = React.useState(null);

    const refPost = React.useRef();

    const loadData = async (force) => {
        const fullTreeLoadRequired = id in data.source && showComments && data.source[id].children.length + 1 > Object.keys(data.source).length;
        if (force || !(id in data.source) || fullTreeLoadRequired) {
            setFullTreeIsLoading(true);
            await data.load();
            setFullTreeIsLoading(false);
            if (data.notFound) {
                setPost(null);
                return;
            }
        }
        const newData = data.source[id];
        if (post) {
            // This is needed, becasue reactions are updated optimistically and we might have new ones in-flight.
            newData.reactions = post.reactions;
        }
        setPost(newData);
        setBlobs(await loadPostBlobs(newData.files));
    };

    React.useEffect(() => { loadData(); }, [version, data, showComments]);
    React.useEffect(() => { setRendering(false); }, []);

    if (!post) {
        if (data.notFound) return <NotFound />;
        return <Loading />;
    }

    post.effBody = post.body;
    if (!isNaN(version)) {
        for (let i = post.patches.length-1; i >= version; i--) {
            const [_timestamp, patch] = post.patches[i]
            post.effBody = applyPatch(post.effBody, patch)[0];
        }
    }

    const commentSubmissionCallback = async (comment, blobs) => {
        const result = await api.add_post(comment, blobs, [post.id], [], []);
        if (result.Err) {
            return alert(`Error: ${result.Err}`);
        }
        // delete outdated root post data
        delete data.source[id];
        await loadData();
        toggleInfo(false);
        toggleComments(true);
    };

    const showCarret = level > (refPost.current?.clientWidth > 900 ? 13 : 3);
    const goInside = () => location.href = `#/post/${post.id}`;

    const expand = e => {
        if (repost) location.href = `/#/post/${id}`;
        if(!isFeedItem || window.getSelection().toString().length > 0) return;
        if (["A", "IMG", "INPUT"].includes(e.target.tagName) || skipClicks(e.target)) return;
        toggleInfo(false);
        if (showCarret) goInside();
        else toggleComments(!expanded);
        toggleExpansion(!expanded);
    };

    const react = id => {
        if (!api._user) return;
        let userId = api._user?.id;
        if (!(id in post.reactions)) {
            post.reactions[id] = [];
        };
        let users = post.reactions[id];
        if (Object.values(post.reactions).reduce((acc, users) => acc.concat(users), []).includes(userId)) {
            if (reactionTimer) {
                clearTimeout(reactionTimer);
                post.reactions[id] = users.filter(id => id != userId);
                setPost({...post});
            }
            return;
        }
        clearTimeout(reactionTimer);
        const timer = setTimeout(() =>
            api.call("react", post.id, parseInt(id)).then(response => { 
                if ("Err" in response) alert(`Error: ${response.Err}`);
                api._reloadUser();
            }), 4000);
        setReactionTimer(timer);
        users.push(userId);
        setPost({...post});
        toggleInfo(commentIncoming);
    };

    const costTable = reactionCosts();
    const isInactive = objectReduce(post.reactions, (acc, id, users) => acc + costTable[parseInt(id)] * users.length, 0) < 0 || post.user.karma < 0;
    const treeLoaded = Object.keys(data.source).length > 1;
    const highlightOp = treeLoaded && post.user.id == data.source[data.root]?.user.id;
    const user = api._user;
    const showReport = post.report && !post.report.closed && user && user.stalwart;
    const deleted = post.hashes.length > 0;
    const deletedByModeration = post.report && post.report.closed && post.report.confirmed_by.length > post.report.rejected_by.length;
    const isComment = !isRoot(post);
    const commentAsPost = isComment && !isCommentView;
    const realmPost = (!isComment || !isCommentView) && post.realm && (!user || user.current_realm != post.realm);
    const isGallery = post.effBody.startsWith("![");
    const postCreated = post.patches.length > 0 ? post.patches[0][0] : post.timestamp;
    const isPrime = !isCommentView && !isFeedItem && !repost;
    const isNSFW = post.effBody.toLowerCase().includes("#nsfw") && isFeedItem && !safeToOpen;
    version = isNaN(version) && post.patches.length > 0 ? post.patches.length : version;

    if (isPrime) setTitle(`Post #${post.id} by @${backendCache.users[post.user.id]}`);

    if (deletedByModeration) return <h4 className="banner">DELETED VIA MODERATION</h4>;

    let cls = "";
    if (!deleted && !isNSFW && !showReport) {
        if (realmPost) cls = "realm_post";
        cls += isGallery ? " gallery_post" : " text_post";
    }

    return <div ref={post => { if(post && focused && rendering) post.scrollIntoView({ behavior: "smooth" }); }}
        className={classNameArg || null}>
        <div ref={refPost} className={`post_box ${isInactive ? "inactive" : ""} ${cls}`} style={{position: "relative"}}>
            {showReport && <ReportBanner id={post.id} reportArg={post.report} domain="post" />}
            {isNSFW && <div className="post_head banner2 x_large_text" onClick={() => setSafeToOpen(true)}>#NSFW</div>}
            {deleted && <div className="post_head banner3 small_text monospace"><h3>Post deleted</h3>
                <ol>{post.hashes.map(hash => <li key={hash}><code>{bigScreen() ? hash : hash.slice(0,16)}</code></li>)}</ol>
            </div>}
            {realmPost && <RealmRibbon name={post.realm} />}
            {commentAsPost  && <a className="reply_tag external monospace" href={`#/thread/${post.id}`}>{post.parent} &#8592;</a>}
            {isComment && !commentAsPost && <span className="thread_button clickable"
                onClick={() => location.href = `#/thread/${post.id}`}><CommentArrow classNameArg="action" /></span>}
            {!isNSFW && <article onClick={expand} className={isPrime ? "prime" : null}>
                {/* The key is needed to render different content for different versions to avoid running into diffrrent
                 number of memorized pieces inside content */}
                <Content key={post.effBody} post={true} value={post.effBody} blobs={blobs} collapse={!expanded} primeMode={isRoot(post) && !repost} />
                {post.extension && post.extension.Poll && <Poll poll={post.extension.Poll} post_id={post.id} created={postCreated} />}
                {post.extension && post.extension.Proposal && <Proposal id={post.extension.Proposal} />}
            </article>}
            <PostBar post={post} react={react} highlightOp={highlightOp} repost={repost} highlighted={highlighted}
                showComments={showComments} toggleComments={toggleComments} postCreated={postCreated} showCarret={showCarret}
                showInfo={showInfo} toggleInfo={toggleInfo} isThreadView={isThreadView} goInside={goInside} />
        </div>
        {showInfo && <div className="top_framed top_spaced">
            <div className="left_half_spaced right_half_spaced bottom_spaced top_spaced">
                <div className="vcentered bottom_spaced flex_ended">
                    <a href={`#/post/${post.id}`}>#</a>
                    <ShareButton classNameArg="left_spaced"
                        url={`${isComment ? "thread" : "post"}/${post.id}${isNaN(version) ? "" : "/" + version}`}
                        title={`Post ${post.id} on ${backendCache.config.name}`} />
                    <div className="max_width_col"></div>
                    {user && <ReactionsPicker post={post} react={react} />}
                </div>
                {user && post.realm && !user.realms.includes(post.realm) && <div className="text_centered framed">JOIN REALM <a href={`#/realm/${post.realm.toLowerCase()}`}>{post.realm}</a> TO COMMENT</div>}
                {user && (!post.realm || user.realms.includes(post.realm)) &&
                    <Form submitCallback={commentSubmissionCallback} postId={post.id}
                        writingCallback={() => setCommentIncoming(true)}
                        comment={true} />}
                {<PostInfo post={post} version={version} postCreated={postCreated} callback={async () => await loadData(true)} />}
            </div>
        </div>}
        {fullTreeIsLoading && <Loading />}
        {!fullTreeIsLoading && showComments && treeLoaded && post.children.length > 0 &&
            <PostFeed data={data} heartbeat={post.id + "_" + Object.keys(data.source).length} comments={true} level={level+1}
                feedLoader={async () => post.children.map(comment_id => { return {...data.source[comment_id]} })} highlighted={highlighted}
                classNameArg="left_spaced" />}
    </div>;
};

const PostInfo = ({post, version, postCreated, callback}) => {
    const postAuthor = api._user?.id == post.user.id;
    return <>
        {api._user && <div className="row_container top_half_spaced">
            {!postAuthor && <FlagButton id={post.id} domain="post" /> }
            <ToggleButton classNameArg="max_width_col" offLabel={<Watch />} onLabel={<Unwatch />}
                currState={() => post.watchers.includes(api._user?.id)} 
                toggler={() => api.call("toggle_following_post", post.id)} />
            <button className="max_width_col" onClick={() => location.href = `/#/new/repost/${post.id}`}><Repost /></button>
            <ToggleButton classNameArg="max_width_col"
                offLabel={<Save />} onLabel={<Unsave />}
                currState={() => api._user.bookmarks.includes(post.id)} 
                toggler={() => api.call("toggle_bookmark", post.id).then(api._reloadUser)} />
            <ButtonWithLoading classNameArg="max_width_col" onClick={async () => {
                const cycles = prompt(`Tip @${post.user.name} with cycles (tipping fee: ${backendCache.config.tipping_fee}):`, 20);
                if(cycles == null) return;
                const tip = parseInt(cycles);
                if(isNaN(tip)) alert("Couldn't parse the number of cycles.");
                let response = await api.call("tip", post.id, tip);
                if ("Err" in response) {
                    alert(`Error: ${response.Err}`);
                } else await callback();
            }} label={<Coin />} />
            {postAuthor && <>
                {post.hashes.length == 0 && <ButtonWithLoading classNameArg="max_width_col" onClick={async () => {
                    const { post_cost, post_deletion_penalty_factor } = backendCache.config;
                    const cost = objectReduce(post.reactions, (acc, id, users) => {
                        const costTable = reactionCosts();
                        let cost = costTable[parseInt(id)];
                        return acc + (cost > 0 ? cost : 0) * users.length;
                    }, 0) + post_cost + post.tree_size * post_deletion_penalty_factor;
                    if (!confirm(`Please confirm the post deletion: it will costs ${cost} cycles.`)) return;
                    let current = post.body;
                    const versions = [current];
                    for (let i = post.patches.length-1; i >= 0; i--) {
                        const [_timestamp, patch] = post.patches[i]
                        current = applyPatch(current, patch)[0];
                        versions.push(current);
                    }
                    versions.reverse();
                    let response = await api.call("delete_post", post.id, versions);
                    if ("Err" in response) {
                        alert(`Error: ${response.Err}`);
                    } else await callback();
                }} label={<Trash />} />}
                <button className="max_width_col" onClick={() => location.href=`/#/edit/${post.id}`}><Edit /></button>
            </>}
        </div>}
        <div className="small_text top_spaced">
            <div>
                <b>CREATED</b>: {new Date(parseInt(postCreated) / 1000000).toLocaleString()}
            </div>
            {post.patches.length > 0 && <div>
                <b>VERSIONS</b>: {commaSeparated((post.patches.concat([[post.timestamp, ""]])).map(([timestamp, _], v) => version == v 
                    ? `${version} (${timeAgo(timestamp)})`
                    : <span key={v}><a href={`/#/post/${post.id}/${v}`}>{`${v}`}</a> ({timeAgo(timestamp)})</span>))}</div>}
            {post.watchers.length > 0 && <div>
                <b>WATCHERS</b>: {commaSeparated(post.watchers.map(id => <UserLink key={id} id={id} />))}
            </div>}
            {post.tips.length > 0 && <div>
                <b>TIPS</b>: {commaSeparated(post.tips.map(([id, tip]) => <span key={id + tip}><code>{tip}</code> from {<UserLink id={id} />}</span>))}
            </div>}
            {Object.keys(post.reactions).length > 0 && <div className="top_spaced">
                {Object.keys(post.reactions).map(id => {
                    let users = post.reactions[id];
                    const [reactId, _cost] = reactions().find(([reaction_id, _cost, _]) => reaction_id == id);
                    return <div key={id} className="bottom_half_spaced">
                        {reaction2icon(reactId)} {commaSeparated(users.map(id => <UserLink key={id} id={id} />))}
                    </div>;
                })}</div>}
        </div>
    </>;
};

const PostBar = ({post, react, highlighted, highlightOp, repost, showInfo, toggleInfo, 
    showComments, toggleComments, postCreated, isThreadView, goInside, showCarret}) => {
    const time = timeAgo(postCreated);
    const replies = post.tree_size;
    const createdRecently = (Number(new Date()) - parseInt(postCreated) / 1000000) < 30 * 60 * 1000;
    const updatedRecently = (Number(new Date()) - parseInt(post.tree_update) / 1000000) < 30 * 60 * 1000;
    const newPost = api._user && highlighted.includes(post.id) || (postCreated > api._last_visit || createdRecently)
    const newComments = api._user && (post.tree_update > api._last_visit || updatedRecently);
    return <div className="post_bar vcentered smaller_text flex_ended">
        <div className="row_container" style={{alignItems: "center"}}>
            <a className={highlightOp ? "accent" : null} href={`#/user/${post.user.id}`}>{`${post.user.name}`}</a>
            <div className="left_spaced no_wrap vcentered">
                {time}
                {newPost && <New classNameArg="left_half_spaced accent" /> }
            </div>
        </div>
        {!repost && <div className="vcentered max_width_col flex_ended">
            <Reactions reactionsMap={post.reactions} react={react} />
            {replies > 0 && !isThreadView && <ReactionToggleButton pressed={showComments}
                onClick={showCarret ? goInside : () => { toggleInfo(false); toggleComments(!showComments) }}
                icon={<><Comment classNameArg={newComments ? "accent" : null} />&nbsp;{`${replies}`}</>}
            />}
            {!isThreadView && !showCarret && <BurgerButton onClick={() => { toggleInfo(!showInfo); toggleComments(false) }} pressed={showInfo} />}
            {(isThreadView || showCarret) && <button className="reaction_button unselected"
                onClick={goInside}><CarretRight /></button>}
        </div>}
    </div>;
}

export const ReactionsPicker = ({react}) => <>
    {reactions().map(([id, _]) => <button key={id} className="left_half_spaced" onClick={() => react(id)}>{reaction2icon(id)}</button>)}
</>;

export const Reactions = ({reactionsMap, react}) => {
    if (Object.keys(reactionsMap).length == 0) return null;
    return <div className="vcentered flex_ended">
        {Object.keys(reactionsMap).map(id => {
            const users = reactionsMap[id];
            const reacted = users.includes(api._user?.id);
            const reaction = reactions().find(([reaction_id, _cost, _]) => reaction_id == id);
            if (!reaction || users == 0) return null;
            const [reactId, _cost] = reaction;
            return <button data-meta="skipClicks" key={id} className={"reaction_button " + (reacted ? "selected" : "unselected")}
                onClick={() => react(id)}>
                {reaction2icon(reactId)}&nbsp;{`${users.length}`}
            </button>;
        })}
    </div>;
};

const skipClicks = elem => elem && (elem.dataset["meta"] == "skipClicks" || skipClicks(elem.parentElement));

