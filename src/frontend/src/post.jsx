import * as React from "react";
import { Form } from "./form";
import { Content, CUT } from "./content";
import { Poll } from "./poll";
import {
    isRoot,
    BurgerButton,
    timeAgo,
    ToggleButton,
    NotFound,
    applyPatch,
    loadPostBlobs,
    ShareButton,
    commaSeparated,
    Loading,
    objectReduce,
    reactionCosts,
    loadPosts,
    ReactionToggleButton,
    RealmRibbon,
    setTitle,
    ButtonWithLoading,
    bigScreen,
    UserLink,
    FlagButton,
    ReportBanner,
    icp,
    currentRealm,
} from "./common";
import { PostFeed } from "./post_feed";
import {
    reaction2icon,
    Edit,
    Save,
    Unsave,
    Repost,
    Coin,
    New,
    CommentArrow,
    CarretRight,
    Trash,
    Comment,
    Close,
    Bell,
    BellOff,
} from "./icons";
import { Proposal } from "./proposals";

export const Post = ({
    id,
    data,
    version,
    isFeedItem,
    repost,
    prime,
    classNameArg,
    isCommentView,
    isThreadView,
    isJournalView,
    focused,
    highlighted = [],
    level = 0,
}) => {
    const [post, setPost] = React.useState(data);
    const [notFound, setNotFound] = React.useState(false);
    const [blobs, setBlobs] = React.useState({});
    const [showComments, toggleComments] = React.useState(
        !isFeedItem && !repost,
    );
    const [showInfo, toggleInfo] = React.useState(false);
    const [expanded, toggleExpansion] = React.useState(
        focused || (!isFeedItem && !repost) || isThreadView,
    );
    const [fullTreeIsLoading, setFullTreeIsLoading] = React.useState(false);
    const [rendering, setRendering] = React.useState(true);
    const [safeToOpen, setSafeToOpen] = React.useState(false);
    const [commentIncoming, setCommentIncoming] = React.useState(false);
    const [reactionTimer, setReactionTimer] = React.useState(null);

    const refPost = React.useRef();

    const loadData = async (preloadedData) => {
        const data = preloadedData || (await loadPosts([id])).pop();
        if (!data) {
            setNotFound(true);
            return;
        }
        if (post) {
            // This is needed, becasue reactions are updated optimistically and we might have new ones in-flight.
            data.reactions = post.reactions;
        }
        setPost(data);
        setBlobs(await loadPostBlobs(data.files));
    };

    React.useEffect(() => {
        loadData(data);
    }, [id, version]);
    React.useEffect(() => {
        setRendering(false);
    }, []);

    if (!post) {
        if (notFound) return <NotFound />;
        return <Loading />;
    }

    post.effBody = post.body;
    if (!isNaN(version)) {
        for (let i = post.patches.length - 1; i >= version; i--) {
            const [_timestamp, patch] = post.patches[i];
            post.effBody = applyPatch(post.effBody, patch)[0];
        }
    }

    const commentSubmissionCallback = async (comment, blobs) => {
        const result = await api.add_post(comment, blobs, [post.id], [], []);
        if (result.Err) {
            alert(`Error: ${result.Err}`);
            return false;
        }
        await loadData();
        toggleInfo(false);
        toggleComments(true);
        return true;
    };

    const showCarret = level > (refPost.current?.clientWidth > 900 ? 13 : 3);
    const goInside = (e, force) => {
        if (
            !force &&
            // Selected text is clicked
            (window.getSelection().toString().length > 0 ||
                prime ||
                ["A", "IMG", "INPUT"].includes(e.target.tagName) ||
                skipClicks(e.target))
        )
            return;
        location.href = `#/post/${post.id}`;
    };

    const react = (id) => {
        if (!window.user) return;
        let userId = window.user?.id;
        if (!(id in post.reactions)) {
            post.reactions[id] = [];
        }
        let users = post.reactions[id];
        if (
            Object.values(post.reactions)
                .reduce((acc, users) => acc.concat(users), [])
                .includes(userId)
        ) {
            if (reactionTimer) {
                clearTimeout(reactionTimer);
                post.reactions[id] = users.filter((id) => id != userId);
                setPost({ ...post });
            }
            return;
        }
        clearTimeout(reactionTimer);
        const timer = setTimeout(
            () =>
                api.call("react", post.id, parseInt(id)).then((response) => {
                    if ("Err" in response) alert(`Error: ${response.Err}`);
                    window.reloadUser();
                }),
            4000,
        );
        setReactionTimer(timer);
        users.push(userId);
        setPost({ ...post });
        toggleInfo(commentIncoming);
    };

    const costTable = reactionCosts();
    const isInactive =
        objectReduce(
            post.reactions,
            (acc, id, users) => acc + costTable[parseInt(id)] * users.length,
            0,
        ) < 0 || post.user.karma < 0;
    const user = window.user;
    const showReport =
        post.report && !post.report.closed && user && user.stalwart;
    const deleted = post.hashes.length > 0;
    const deletedByModeration =
        post.report &&
        post.report.closed &&
        post.report.confirmed_by.length > post.report.rejected_by.length;
    const isComment = !isRoot(post);
    const commentAsPost = isComment && !isCommentView;
    const realmPost =
        (!isComment || !isCommentView) &&
        post.realm &&
        post.realm != currentRealm();
    const isGallery = post.effBody.startsWith("![");
    const postCreated =
        post.patches.length > 0 ? post.patches[0][0] : post.timestamp;
    const isNSFW =
        post.effBody.toLowerCase().includes("#nsfw") &&
        isFeedItem &&
        !safeToOpen;
    const versionSpecified = !isNaN(version);
    version =
        isNaN(version) && post.patches.length > 0
            ? post.patches.length
            : version;

    if (prime)
        setTitle(`Post #${post.id} by @${backendCache.users[post.user.id]}`);

    if (deletedByModeration)
        return <h4 className="banner">DELETED VIA MODERATION</h4>;

    let cls = "";
    if (!deleted && !isNSFW && !showReport) {
        if (realmPost) cls = "realm_post";
        cls += isGallery ? " gallery_post" : " text_post";
    }

    const showExtension = !isNSFW && post.extension && !repost;

    return (
        <div
            ref={(post) => {
                if (post && focused && rendering)
                    post.scrollIntoView({ behavior: "smooth" });
            }}
            className={classNameArg || null}
            data-testid="post-body"
        >
            <div
                ref={refPost}
                className={`post_box ${
                    isInactive ? "inactive" : ""
                } ${cls} clickable`}
                style={{ position: "relative" }}
            >
                {showReport && (
                    <ReportBanner
                        id={post.id}
                        reportArg={post.report}
                        domain="post"
                    />
                )}
                {isNSFW && (
                    <div
                        className="post_head banner2 x_large_text"
                        onClick={() => setSafeToOpen(true)}
                    >
                        #NSFW
                    </div>
                )}
                {deleted && (
                    <div className="post_head banner3 small_text monospace">
                        <h3>Post deleted</h3>
                        <ol>
                            {post.hashes.map((hash) => (
                                <li key={hash}>
                                    <code>
                                        {bigScreen() ? hash : hash.slice(0, 16)}
                                    </code>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
                {realmPost && <RealmRibbon name={post.realm} />}
                {commentAsPost && (
                    <a
                        className="reply_tag external monospace"
                        href={`#/thread/${post.id}`}
                    >
                        {post.parent} &#8592;
                    </a>
                )}
                {isComment && !commentAsPost && (
                    <span
                        className="thread_button clickable"
                        onClick={() => (location.href = `#/thread/${post.id}`)}
                    >
                        <CommentArrow classNameArg="action" />
                    </span>
                )}
                {!isNSFW && (
                    <article
                        onClick={goInside}
                        className={prime ? "prime" : null}
                    >
                        {/* The key is needed to render different content for different versions to avoid running into diffrrent
                 number of memorized pieces inside content */}
                        <Content
                            key={post.effBody}
                            post={true}
                            value={post.effBody}
                            blobs={blobs}
                            collapse={!expanded}
                            primeMode={isRoot(post) && !repost}
                        />
                    </article>
                )}
                {showExtension && "Poll" in post.extension && (
                    <Poll
                        poll={post.extension.Poll}
                        post_id={post.id}
                        created={postCreated}
                    />
                )}
                {showExtension && "Repost" in post.extension && (
                    <Post
                        id={post.extension.Repost}
                        repost={true}
                        classNameArg="post_extension repost"
                    />
                )}
                {showExtension && "Proposal" in post.extension && (
                    <Proposal postId={post.id} id={post.extension.Proposal} />
                )}
                <PostBar
                    post={post}
                    react={react}
                    repost={repost}
                    highlighted={highlighted}
                    showComments={showComments}
                    toggleComments={toggleComments}
                    postCreated={postCreated}
                    showCarret={showCarret}
                    showInfo={showInfo}
                    toggleInfo={toggleInfo}
                    isThreadView={isThreadView}
                    isJournalView={isJournalView}
                    goInside={goInside}
                />
            </div>
            {showInfo && (
                <div className="left_half_spaced right_half_spaced top_half_spaced">
                    {user && (
                        <>
                            <ReactionsPicker
                                user={user}
                                post={post}
                                react={react}
                            />
                            {post.realm &&
                                !user.realms.includes(post.realm) && (
                                    <div className="text_centered framed">
                                        JOIN REALM{" "}
                                        <a href={`#/realm/${post.realm}`}>
                                            {post.realm}
                                        </a>{" "}
                                        TO COMMENT
                                    </div>
                                )}
                            {(!post.realm ||
                                user.realms.includes(post.realm)) && (
                                <Form
                                    submitCallback={commentSubmissionCallback}
                                    postId={post.id}
                                    writingCallback={() =>
                                        setCommentIncoming(true)
                                    }
                                    comment={true}
                                />
                            )}
                        </>
                    )}
                    {
                        <PostInfo
                            post={post}
                            version={version}
                            versionSpecified={versionSpecified}
                            postCreated={postCreated}
                            callback={async () => await loadData()}
                        />
                    }
                </div>
            )}
            {(showComments || prime) && post.children.length > 0 && (
                <PostFeed
                    heartbeat={`${post.id}_${
                        Object.keys(post.children).length
                    }_${showComments}`}
                    comments={true}
                    level={level + 1}
                    feedLoader={async () =>
                        Object.values(await api.query("posts", post.children))
                    }
                    highlighted={highlighted}
                    classNameArg="left_spaced"
                />
            )}
        </div>
    );
};

const PostInfo = ({
    post,
    version,
    postCreated,
    callback,
    versionSpecified,
}) => {
    const postAuthor = window.user?.id == post.user.id;
    const realmController = post.realm && backendCache.realms[post.realm][1];
    return (
        <>
            {window.user && (
                <div className="row_container top_half_spaced">
                    <ShareButton
                        classNameArg="max_width_col"
                        url={`${post.parent ? "thread" : "post"}/${post.id}${
                            versionSpecified ? "/" + version : ""
                        }`}
                        title={`Post ${post.id} on ${backendCache.config.name}`}
                    />
                    {!postAuthor && <FlagButton id={post.id} domain="post" />}
                    <ToggleButton
                        onTitle="Unwatch post"
                        offTitle="Watch post"
                        classNameArg="max_width_col"
                        offLabel={<Bell />}
                        onLabel={<BellOff />}
                        currState={() =>
                            post.watchers.includes(window.user?.id)
                        }
                        toggler={() =>
                            api.call("toggle_following_post", post.id)
                        }
                    />
                    <button
                        title="Repost"
                        className="max_width_col"
                        onClick={() => {
                            api.call("toggle_following_post", post.id);
                            location.href = `/#/new/repost/${post.id}`;
                        }}
                    >
                        <Repost />
                    </button>
                    <ToggleButton
                        offTitle="Bookmark post"
                        onTitle="Remove from bookmarks"
                        classNameArg="max_width_col"
                        offLabel={<Save />}
                        onLabel={<Unsave />}
                        currState={() =>
                            window.user.bookmarks.includes(post.id)
                        }
                        toggler={() =>
                            api
                                .call("toggle_bookmark", post.id)
                                .then(window.reloadUser)
                        }
                        testId="bookmark-post"
                    />
                    <ButtonWithLoading
                        title="Tip"
                        classNameArg="max_width_col"
                        onClick={async () => {
                            const amount = prompt(
                                `Tip @${post.user.name} with ICP:`,
                            );
                            if (
                                amount == null ||
                                !confirm(
                                    `Transfer ${amount} ICP to @${post.user.name} as a tip?`,
                                )
                            )
                                return;
                            let response = await api.call(
                                "tip",
                                post.id,
                                amount,
                            );
                            if ("Err" in response) {
                                alert(`Error: ${response.Err}`);
                            } else await callback();
                        }}
                        label={<Coin />}
                    />
                    {realmController && isRoot(post) && (
                        <ButtonWithLoading
                            title="Remove from realm"
                            classNameArg="max_width_col"
                            onClick={async () => {
                                if (
                                    !confirm(
                                        "Do you want to remove the post from this realm?",
                                    )
                                )
                                    return;
                                await api.call("realm_clean_up", post.id);
                                alert("This post was removed from this realm.");
                            }}
                            label={<Close />}
                        />
                    )}
                    {postAuthor && (
                        <>
                            {post.hashes.length == 0 && (
                                <ButtonWithLoading
                                    title="Delete post"
                                    classNameArg="max_width_col"
                                    onClick={async () => {
                                        const {
                                            post_cost,
                                            post_deletion_penalty_factor,
                                        } = backendCache.config;
                                        const cost =
                                            objectReduce(
                                                post.reactions,
                                                (acc, id, users) => {
                                                    const costTable =
                                                        reactionCosts();
                                                    let cost =
                                                        costTable[parseInt(id)];
                                                    return (
                                                        acc +
                                                        (cost > 0 ? cost : 0) *
                                                            users.length
                                                    );
                                                },
                                                0,
                                            ) +
                                            post_cost +
                                            post.tree_size *
                                                post_deletion_penalty_factor;
                                        if (
                                            !confirm(
                                                `Please confirm the post deletion: it will costs ${cost} cycles.`,
                                            )
                                        )
                                            return;
                                        let current = post.body;
                                        const versions = [current];
                                        for (
                                            let i = post.patches.length - 1;
                                            i >= 0;
                                            i--
                                        ) {
                                            const [_timestamp, patch] =
                                                post.patches[i];
                                            current = applyPatch(
                                                current,
                                                patch,
                                            )[0];
                                            versions.push(current);
                                        }
                                        versions.reverse();
                                        let response = await api.call(
                                            "delete_post",
                                            post.id,
                                            versions,
                                        );
                                        if ("Err" in response) {
                                            alert(`Error: ${response.Err}`);
                                        } else await callback();
                                    }}
                                    label={<Trash />}
                                />
                            )}
                            <button
                                title="Edit"
                                className="max_width_col"
                                onClick={() =>
                                    (location.href = `/#/edit/${post.id}`)
                                }
                            >
                                <Edit />
                            </button>
                        </>
                    )}
                </div>
            )}
            <div className="small_text top_spaced bottom_spaced">
                <div>
                    <b>CREATED</b>:{" "}
                    {new Date(parseInt(postCreated) / 1000000).toLocaleString()}
                </div>
                {post.patches.length > 0 && (
                    <div>
                        <b>VERSIONS</b>:{" "}
                        {commaSeparated(
                            post.patches
                                .concat([[post.timestamp, ""]])
                                .map(([timestamp, _], v) =>
                                    version == v ? (
                                        `${version} (${timeAgo(timestamp)})`
                                    ) : (
                                        <span key={v}>
                                            <a
                                                href={`/#/post/${post.id}/${v}`}
                                            >{`${v}`}</a>{" "}
                                            ({timeAgo(timestamp)})
                                        </span>
                                    ),
                                ),
                        )}
                    </div>
                )}
                {post.watchers.length > 0 && (
                    <div>
                        <b>WATCHERS</b>:{" "}
                        {commaSeparated(
                            post.watchers.map((id) => (
                                <UserLink key={id} id={id} />
                            )),
                        )}
                    </div>
                )}
                {post.tips.length > 0 && (
                    <div>
                        <b>ICP TIPS</b>:{" "}
                        {commaSeparated(
                            post.tips.map(([id, tip]) => (
                                <span key={id + tip}>
                                    <code>{icp(tip, "with_decimals")}</code>{" "}
                                    from {<UserLink id={id} />}
                                </span>
                            )),
                        )}
                    </div>
                )}
                {Object.keys(post.reactions).length > 0 && (
                    <div className="top_spaced">
                        {Object.entries(post.reactions).map(
                            ([reactId, users]) => (
                                <div
                                    key={reactId}
                                    className="bottom_half_spaced"
                                >
                                    {reaction2icon(reactId)}{" "}
                                    {commaSeparated(
                                        users.map((id) => (
                                            <UserLink key={id} id={id} />
                                        )),
                                    )}
                                </div>
                            ),
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

const PostBar = ({
    post,
    react,
    highlighted,
    repost,
    showInfo,
    toggleInfo,
    showComments,
    toggleComments,
    postCreated,
    isThreadView,
    goInside,
    showCarret,
    isJournalView,
}) => {
    const time = timeAgo(postCreated, null, isJournalView ? "long" : "short");
    const replies = post.tree_size;
    const createdRecently =
        Number(new Date()) - parseInt(postCreated) / 1000000 < 30 * 60 * 1000;
    const updatedRecently =
        Number(new Date()) - parseInt(post.tree_update) / 1000000 <
        30 * 60 * 1000;
    const newPost =
        (window.user && highlighted.includes(post.id)) ||
        postCreated > window.lastVisit ||
        createdRecently;
    const newComments =
        window.user && (post.tree_update > window.lastVisit || updatedRecently);
    return (
        <div className="post_bar vcentered smaller_text flex_ended">
            <div className="row_container" style={{ alignItems: "center" }}>
                {!isJournalView && (
                    <a href={`#/user/${post.user.id}`}>{`${post.user.name}`}</a>
                )}
                <div className="left_half_spaced no_wrap vcentered">
                    {time}
                    {newPost && <New classNameArg="left_half_spaced accent" />}
                    {post.tips.length > 0 && (
                        <Coin classNameArg="accent left_half_spaced" />
                    )}
                </div>
            </div>
            <div className="vcentered max_width_col flex_ended">
                {!repost && (
                    <>
                        <Reactions
                            reactionsMap={post.reactions}
                            react={react}
                        />
                        {replies > 0 && !isThreadView && (
                            <ReactionToggleButton
                                pressed={showComments}
                                testId="post-comments-toggle"
                                onClick={
                                    showCarret
                                        ? (event) => goInside(event, "force")
                                        : () => {
                                              toggleInfo(false);
                                              toggleComments(!showComments);
                                          }
                                }
                                icon={
                                    <>
                                        <Comment
                                            classNameArg={
                                                newComments ? "accent" : null
                                            }
                                        />
                                        &nbsp;{`${replies}`}
                                    </>
                                }
                            />
                        )}
                        {!isThreadView && !showCarret && (
                            <BurgerButton
                                onClick={() => {
                                    toggleInfo(!showInfo);
                                    toggleComments(false);
                                }}
                                pressed={showInfo}
                                testId="post-info-toggle"
                            />
                        )}
                        {(isThreadView || showCarret) && (
                            <button
                                className="reaction_button unselected"
                                onClick={goInside}
                            >
                                <CarretRight />
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export const ReactionsPicker = ({ react, post, user }) => {
    if (!user || post.user.id == user.id) return null;
    // Don't show reactions picker if the user reacted already
    if (
        Array.prototype.concat
            .apply([], Object.values(post.reactions))
            .includes(user.id)
    )
        return;
    return (
        <div className="framed vcentered bottom_spaced top_spaced row_container">
            {backendCache.config.reactions.map(([id, cost]) => (
                <ReactionToggleButton
                    title={`Karma points: ${cost}`}
                    key={id}
                    classNameArg="max_width_col centered"
                    onClick={() => react(id)}
                    testId={"give-" + id + "-reaction"}
                    icon={reaction2icon(id)}
                />
            ))}
        </div>
    );
};

export const Reactions = ({ reactionsMap, react }) => {
    if (Object.keys(reactionsMap).length == 0) return null;
    return (
        <div className="vcentered flex_ended">
            {Object.entries(reactionsMap).map(([reactId, users]) => {
                if (users.length == 0) return null;
                const reacted = users.includes(window.user?.id);
                return (
                    <button
                        data-meta="skipClicks"
                        key={reactId}
                        className={
                            "reaction_button " +
                            (reacted ? "selected" : "unselected")
                        }
                        onClick={() => react(reactId)}
                        data-testid={reactId + "-reaction"}
                    >
                        {reaction2icon(reactId)}&nbsp;{`${users.length}`}
                    </button>
                );
            })}
        </div>
    );
};

const skipClicks = (elem) =>
    elem &&
    (elem.dataset["meta"] == "skipClicks" || skipClicks(elem.parentElement));
