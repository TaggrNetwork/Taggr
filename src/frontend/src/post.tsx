import * as React from "react";
import { Form } from "./form";
import { Content } from "./content";
import { PollView } from "./poll";
import {
    isRoot,
    BurgerButton,
    timeAgo,
    ToggleButton,
    NotFound,
    applyPatch,
    ShareButton,
    commaSeparated,
    Loading,
    reactionCosts,
    loadPosts,
    IconToggleButton,
    RealmSpan,
    setTitle,
    ButtonWithLoading,
    bigScreen,
    UserLink,
    FlagButton,
    ReportBanner,
    tokens,
    currentRealm,
    parseNumber,
    noiseControlBanner,
    getRealmsData,
    expandUser,
    ArrowDown,
} from "./common";
import {
    reaction2icon,
    Edit,
    Save,
    Unsave,
    Repost,
    Coin,
    New,
    CarretRight,
    Trash,
    Comment,
    Close,
    Bell,
    BellOff,
    More,
} from "./icons";
import { ProposalView } from "./proposals";
import { Post, PostId, UserId } from "./types";
import { MAINNET_MODE } from "./env";

export const PostView = ({
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
}: {
    id: PostId;
    data?: Post;
    version?: number;
    isFeedItem?: boolean;
    repost?: boolean;
    prime?: boolean;
    classNameArg?: string;
    isCommentView?: boolean;
    isThreadView?: boolean;
    isJournalView?: boolean;
    focused?: boolean;
    highlighted?: PostId[];
    level?: number;
}) => {
    const [post, setPost] = React.useState(data);
    const [body, setBody] = React.useState("");
    const [notFound, setNotFound] = React.useState(false);
    const [hidden, setHidden] = React.useState(false);
    const [showComments, toggleComments] = React.useState(!!prime);
    const [showInfo, toggleInfo] = React.useState(false);
    const [safeToOpen, setSafeToOpen] = React.useState(false);
    const [showExpandButton, setShowExpandButton] = React.useState(false);
    const [commentIncoming, setCommentIncoming] = React.useState(false);

    const refPost = React.useRef();
    const refArticle = React.useRef();

    const loadData = async (preloadedData?: Post) => {
        const data = preloadedData || (await loadPosts([id])).pop();
        if (!data) {
            setNotFound(true);
            return;
        }

        let effBody = data.body;
        if (version != undefined && !isNaN(version)) {
            for (let i = data.patches.length - 1; i >= version; i--) {
                const [_timestamp, patch] = data.patches[i];
                effBody = applyPatch(effBody, patch)[0];
            }
        }
        setBody(effBody);
        setPost(data);
    };

    React.useEffect(() => {
        loadData(data);
    }, [id, version, data]);

    React.useEffect(() => {
        const article: any = refArticle.current;
        if (!prime && article && article.scrollHeight > article.clientHeight) {
            article.classList.add("overflowing");
            setShowExpandButton(true);
        }
    }, [post]);

    if (!post) {
        if (notFound) return <NotFound />;
        return <Loading />;
    }

    const commentSubmissionCallback = async (
        comment: string,
        blobs: [string, Uint8Array][],
    ) => {
        const result: any = await window.api.add_post(
            comment,
            blobs,
            [post.id],
            [],
            [],
        );
        if (result.Err) {
            alert(`Error: ${result.Err}`);
            return false;
        }
        const commentId = result.Ok;
        post.children.push(Number(commentId));
        post.tree_size += 1;
        setPost({ ...post });
        toggleInfo(false);
        toggleComments(true);
        return true;
    };

    const showCarret =
        level > ((refPost.current as any)?.clientWidth > 900 ? 13 : 5);
    const goInside = (e: any, force?: boolean) => {
        if (
            !force &&
            // Selected text is clicked
            ((window.getSelection() || "").toString().length > 0 ||
                prime ||
                ["A", "IMG", "INPUT"].includes(e.target.tagName) ||
                skipClicks(e.target))
        )
            return;
        location.href = `#/post/${post.id}`;
    };

    const react = (id: number) => {
        if (!window.user) return;
        let userId = window.user?.id;
        if (post.user == userId) return;
        if (!(id in post.reactions)) {
            post.reactions[id] = [];
        }
        let users = post.reactions[id];
        if (
            Object.values(post.reactions)
                .reduce((acc, users) => acc.concat(users), [])
                .includes(userId)
        ) {
            return;
        }
        window.api.call<any>("react", post.id, id).then((response) => {
            if ("Err" in response) alert(`Error: ${response.Err}`);
            window.reloadUser();
        });
        users.push(userId);
        setPost({ ...post });
        toggleInfo(commentIncoming);
    };

    const expanded = focused || (!isFeedItem && !repost) || isThreadView;
    const costTable = reactionCosts();
    const isInactive =
        objectReduce(
            post.reactions,
            (acc, id, users) => acc + costTable[id as any] * users.length,
            0,
        ) < 0 || post.userObject.rewards < 0;
    const user = window.user;
    const showReport =
        post.report && !post.report.closed && user && user.stalwart;
    const deleted = post.hashes.length > 0;
    const isComment = !isRoot(post);
    const commentAsPost = isComment && !isCommentView;
    const realmPost =
        (!isComment || !isCommentView) &&
        post.realm &&
        post.realm != currentRealm();
    const realmAccessError =
        user && post.realm
            ? noiseControlBanner("realm", getRealmsData(post.realm)[2], user)
            : null;
    const postCreated =
        post.patches.length > 0 ? post.patches[0][0] : post.timestamp;
    const isNSFW =
        body.toLowerCase().includes("#nsfw") && isFeedItem && !safeToOpen;
    const versionSpecified = version != undefined && !isNaN(version);
    version =
        !versionSpecified && post.patches.length > 0
            ? post.patches.length
            : version;
    const time = timeAgo(postCreated, false, isJournalView ? "long" : "short");
    const createdRecently =
        Number(new Date()) - Number(postCreated) / 1000000 < 30 * 60 * 1000;
    const newPost =
        (window.user && highlighted.includes(post.id)) ||
        postCreated > window.lastVisit ||
        createdRecently;
    const blogTitle =
        prime && body.length > 750 && body.startsWith("# ")
            ? {
                  author: post.userObject.name,
                  realm: post.realm,
                  created: postCreated,
                  length: body.length,
              }
            : undefined;

    if (prime) setTitle(`Post #${post.id} by @${post.userObject.name}`);

    const showExtension = !isNSFW && post.extension && !repost;

    if (hidden) return null;

    return (
        <div
            ref={(post) => {
                if (post && focused)
                    post.scrollIntoView({ behavior: "smooth" });
            }}
            className={classNameArg}
            data-testid="post-body"
        >
            {showReport && post.report && (
                <ReportBanner
                    id={post.id}
                    reportArg={post.report}
                    domain="post"
                />
            )}
            <div
                ref={refPost as any}
                className={`post_box ${isInactive ? "inactive" : ""} ${
                    prime ? "prime" : "clickable"
                }`}
            >
                {!blogTitle && (
                    <div className="post_head row_container vcentered">
                        {commentAsPost && (
                            <a
                                className="reply_tag"
                                href={`#/thread/${post.id}`}
                            >
                                &#9664; REPLY
                            </a>
                        )}
                        <UserLink
                            classNameArg="left_well_spaced right_half_spaced"
                            id={post.user}
                            profile={true}
                        />
                        <span className="right_half_spaced">&middot;</span>
                        <div className="no_wrap vcentered">
                            {time}
                            {newPost && (
                                <New classNameArg="left_half_spaced accent" />
                            )}
                        </div>
                        <div className="max_width_col"></div>
                        {realmPost && post.realm && (
                            <RealmSpan
                                name={post.realm}
                                classNameArg="realm_tag"
                            />
                        )}
                    </div>
                )}
                {isNSFW && (
                    <div
                        className="nsfw x_large_text"
                        onClick={() => setSafeToOpen(true)}
                    >
                        NSFW
                    </div>
                )}
                {deleted && (
                    <div className="deleted small_text">
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
                {!isNSFW && (
                    <article
                        ref={refArticle as unknown as any}
                        onClick={(e) => goInside(e)}
                    >
                        <Content
                            blogTitle={blogTitle}
                            post={true}
                            value={body}
                            collapse={!expanded}
                            primeMode={isRoot(post) && !repost}
                            urls={filesToUrls(post.files)}
                        />
                    </article>
                )}
                {showExpandButton && (
                    <ArrowDown
                        onClick={() => (location.href = `#/post/${post.id}`)}
                    />
                )}
                {showExtension && "Poll" in post.extension && (
                    <PollView
                        poll={post.extension.Poll}
                        post_id={post.id}
                        created={postCreated}
                    />
                )}
                {showExtension && "Repost" in post.extension && (
                    <PostView
                        id={post.extension.Repost}
                        repost={true}
                        classNameArg="post_extension repost"
                    />
                )}
                {showExtension && "Proposal" in post.extension && (
                    <ProposalView
                        postId={post.id}
                        id={post.extension.Proposal}
                    />
                )}
                {!repost && (
                    <PostBar
                        post={post}
                        react={react}
                        showComments={showComments}
                        toggleComments={toggleComments}
                        showCarret={showCarret}
                        showInfo={showInfo}
                        toggleInfo={toggleInfo}
                        isThreadView={isThreadView}
                        goInside={goInside}
                    />
                )}
            </div>
            {showInfo && (
                <div className="left_half_spaced right_half_spaced top_spaced">
                    {user && (
                        <>
                            {realmAccessError}
                            {!realmAccessError && (
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
                    <PostInfo
                        post={post}
                        reactions={post.reactions}
                        version={version}
                        versionSpecified={versionSpecified}
                        postCreated={postCreated}
                        callback={async () => await loadData()}
                        realmMoveOutCallback={() => setHidden(true)}
                    />
                </div>
            )}
            {(showComments || prime) && post.children.length > 0 && (
                <Comments
                    heartbeat={`${post.id}_${
                        Object.keys(post.children).length
                    }_${showComments}`}
                    level={level + 1}
                    loader={async () =>
                        await window.api.query("posts", post.children)
                    }
                />
            )}
        </div>
    );
};

const Comments = ({
    heartbeat,
    level,
    loader,
}: {
    heartbeat: any;
    level: number;
    loader: () => Promise<Post[] | null>;
}) => {
    const [posts, setPosts] = React.useState<Post[]>([]);
    const [loading, setLoading] = React.useState(false);
    const loadPosts = async () => {
        setLoading(true);
        const comments = await loader();
        setPosts((comments || []).map(expandUser));
        setLoading(false);
    };

    React.useEffect(() => {
        loadPosts();
    }, [heartbeat]);

    if (loading) return <Loading />;

    return (
        <ul
            style={{ marginLeft: level == 1 ? "0.5em" : undefined }}
            className="comments top_framed"
        >
            {posts.map((post) => (
                <li key={post.id}>
                    <PostView
                        id={post.id}
                        level={level + 1}
                        data={post}
                        classNameArg="comment"
                        isCommentView={true}
                    />
                </li>
            ))}
        </ul>
    );
};

const PostInfo = ({
    post,
    reactions,
    version,
    postCreated,
    callback,
    versionSpecified,
    realmMoveOutCallback,
}: {
    post: Post;
    reactions: { [id: number]: UserId[] };
    version?: number;
    postCreated: BigInt;
    callback: () => Promise<void>;
    realmMoveOutCallback: () => void;
    versionSpecified?: boolean;
}) => {
    const postAuthor = window.user?.id == post.userObject.id;
    const realmController = post.realm && getRealmsData(post.realm)[1];
    const { token_symbol, token_decimals } = window.backendCache.config;
    return (
        <>
            <div className="row_container top_spaced">
                <ShareButton
                    text={!window.user}
                    classNameArg="max_width_col"
                    url={`${post.parent ? "thread" : "post"}/${post.id}${
                        versionSpecified ? "/" + version : ""
                    }`}
                    title={`Post ${post.id} on ${window.backendCache.config.name}`}
                />
                {window.user && (
                    <>
                        <ToggleButton
                            onTitle="Unwatch post"
                            offTitle="Watch post"
                            classNameArg="max_width_col"
                            offLabel={<Bell />}
                            onLabel={<BellOff classNameArg="accent" />}
                            currState={() =>
                                post.watchers.includes(window.user?.id)
                            }
                            toggler={() =>
                                window.api.call(
                                    "toggle_following_post",
                                    post.id,
                                )
                            }
                        />
                        <button
                            title="Repost"
                            className="max_width_col"
                            onClick={() => {
                                window.api.call(
                                    "toggle_following_post",
                                    post.id,
                                );
                                location.href = `/#/new/repost/${post.id}`;
                            }}
                        >
                            <Repost />
                        </button>
                        <ToggleButton
                            offTitle="Bookmark post"
                            onTitle="Remove from bookmarks"
                            classNameArg="max_width_col "
                            offLabel={<Save />}
                            onLabel={<Unsave classNameArg="accent" />}
                            currState={() =>
                                window.user.bookmarks.includes(post.id)
                            }
                            toggler={() =>
                                window.api
                                    .call("toggle_bookmark", post.id)
                                    .then(window.reloadUser)
                            }
                            testId="bookmark-post"
                        />
                        <ButtonWithLoading
                            title="Tip"
                            classNameArg="max_width_col"
                            onClick={async () => {
                                const amount =
                                    parseNumber(
                                        prompt(
                                            `Tip @${post.userObject.name} with ${token_symbol}:`,
                                        ) || "",
                                        token_decimals,
                                    ) || NaN;
                                if (isNaN(amount)) return;
                                if (
                                    !confirm(
                                        `Transfer ${tokens(
                                            amount,
                                            token_decimals,
                                        )} ${token_symbol} to @${
                                            post.userObject.name
                                        } as a tip?`,
                                    )
                                )
                                    return;
                                let response = await window.api.call<any>(
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
                                    const reason = prompt(
                                        "Please specify the reason for moving the post out of its realm.",
                                        "rules violation",
                                    );
                                    realmMoveOutCallback();
                                    const response = await window.api.call<any>(
                                        "realm_clean_up",
                                        post.id,
                                        reason,
                                    );
                                    if ("Err" in response)
                                        alert(`Error: ${response.Err}`);
                                }}
                                label={<Close />}
                            />
                        )}
                        {!postAuthor && (
                            <FlagButton id={post.id} domain="post" />
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
                                            } = window.backendCache.config;
                                            const cost =
                                                objectReduce(
                                                    reactions,
                                                    (
                                                        acc: number,
                                                        id: string,
                                                        users: UserId[],
                                                    ) => {
                                                        const costTable =
                                                            reactionCosts();
                                                        let cost =
                                                            costTable[
                                                                parseInt(id)
                                                            ];
                                                        return (
                                                            acc +
                                                            (cost > 0
                                                                ? cost
                                                                : 0) *
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
                                                    `Please confirm the post deletion: it will costs ${cost} credits.`,
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
                                            let response =
                                                await window.api.call<any>(
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
                    </>
                )}
            </div>
            <div
                style={{ paddingBottom: "1em" }}
                className="small_text top_spaced bottom_spaced"
            >
                <b>CREATED</b>:{" "}
                {new Date(Number(postCreated) / 1000000).toLocaleString()}
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
                        <b>{token_symbol} TIPS</b>:{" "}
                        {commaSeparated(
                            post.tips.map(([id, tip]) => (
                                <span key={id + Number(tip)}>
                                    <code>
                                        {tokens(Number(tip), token_decimals)}
                                    </code>{" "}
                                    from {<UserLink id={id} profile={true} />}
                                </span>
                            )),
                        )}
                    </div>
                )}
                {Object.keys(reactions).length > 0 && (
                    <div className="top_spaced">
                        {Object.entries(reactions).map(([reactId, users]) => (
                            <div key={reactId} className="bottom_half_spaced">
                                {reaction2icon(Number(reactId))}{" "}
                                {commaSeparated(
                                    users.map((id) => (
                                        <UserLink
                                            key={id}
                                            id={id}
                                            profile={true}
                                        />
                                    )),
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};

let reactionIndicatorWidth = 0;
let progressInterval: any = null;
let timeStart: any = null;

const PostBar = ({
    post,
    react,
    showInfo,
    toggleInfo,
    showComments,
    toggleComments,
    isThreadView,
    goInside,
    showCarret,
}: {
    post: Post;
    react: (id: number) => void;
    showInfo: boolean;
    toggleInfo: (flag: boolean) => void;
    showComments: boolean;
    toggleComments: (flag: boolean) => void;
    isThreadView?: boolean;
    goInside: (arg: any, flag?: boolean) => void;
    showCarret: boolean;
}) => {
    const [showEmojis, setShowEmojis] = React.useState(false);
    const [showHint, setShowHint] = React.useState(false);
    const replies = post.tree_size;
    // @ts-ignore
    const users: UserId[] = [].concat(...Object.values(post.reactions));
    let user = window.user;
    const cantReact =
        !user || users.includes(user?.id) || post.user == user?.id;
    const updatedRecently =
        Number(new Date()) - Number(post.tree_update) / 1000000 <
        30 * 60 * 1000;
    const newComments =
        window.user && (post.tree_update > window.lastVisit || updatedRecently);
    const ref = React.useRef(null);
    const delay =
        user && "tap_and_hold" in user.settings
            ? Number(user.settings.tap_and_hold)
            : 750;

    const unreact = () => {
        if (Number(new Date()) - timeStart < delay) {
            setShowHint(true);
            setTimeout(() => setShowHint(false), 1000);
        }
        clearInterval(progressInterval);
        reactionIndicatorWidth = 0;
        // @ts-ignore
        ref.current?.style.width = 0;
        setShowEmojis(false);
    };

    const delayedReact = (id: number) => {
        if (cantReact) return;
        if (delay <= 50) {
            react(id);
            unreact();
            return;
        }
        timeStart = new Date();
        progressInterval = setInterval(() => {
            reactionIndicatorWidth += 100 / (delay / 50);
            // @ts-ignore
            ref.current?.style.width =
                Math.min(100, reactionIndicatorWidth) + "%";
            if (reactionIndicatorWidth > 100) {
                react(id);
                unreact();
            }
        }, 50);
    };

    return (
        <>
            <div
                ref={ref}
                className="active"
                style={{ height: "1px", width: 0 }}
            ></div>
            <div className="post_bar vcentered smaller_text">
                {showHint && (
                    <div
                        className="max_width_col"
                        style={{ textAlign: "left", opacity: 0.7 }}
                    >
                        TAP AND HOLD!
                    </div>
                )}
                {showEmojis && !showHint && (
                    <ReactionPicker react={delayedReact} unreact={unreact} />
                )}
                {!showEmojis && !showHint && (
                    <Reactions
                        reactionsMap={post.reactions}
                        react={delayedReact}
                        unreact={unreact}
                    />
                )}
                {!cantReact && (
                    <IconToggleButton
                        pressed={showEmojis}
                        onClick={() => setShowEmojis(!showEmojis)}
                        testId="reaction-picker"
                        icon={<More />}
                    />
                )}
                {!showEmojis && (
                    <>
                        {post.tips.length > 0 && (
                            <Coin classNameArg="accent right_quarter_spaced" />
                        )}
                        {post.reposts.length > 0 && (
                            <IconToggleButton
                                onClick={() =>
                                    (location.href = `#/reposts/${post.id}`)
                                }
                                icon={
                                    <>
                                        <Repost classNameArg="right_quarter_spaced" />
                                        {post.reposts.length}
                                    </>
                                }
                            />
                        )}
                        {replies > 0 && !isThreadView && (
                            <IconToggleButton
                                pressed={showComments}
                                testId="post-comments-toggle"
                                onClick={
                                    showCarret
                                        ? (event) => goInside(event, true)
                                        : () => {
                                              toggleInfo(false);
                                              toggleComments(!showComments);
                                          }
                                }
                                icon={
                                    <>
                                        <Comment
                                            classNameArg={`right_quarter_spaced ${
                                                newComments
                                                    ? "accent"
                                                    : undefined
                                            }`}
                                        />
                                        {replies}
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
                                onClick={(e) => goInside(e)}
                            >
                                <CarretRight />
                            </button>
                        )}
                    </>
                )}
            </div>
        </>
    );
};

export const ReactionPicker = ({
    react,
    unreact,
}: {
    react: (id: number) => void;
    unreact: () => void;
}) => (
    <div
        className={`max_width_col ${
            bigScreen() ? "row_container" : "emoji_table"
        }`}
        style={{
            justifyContent: "flex-start",
            padding: "0.5em",
        }}
    >
        {window.backendCache.config.reactions.map(([reactId, rewards]) => (
            <button
                key={reactId}
                title={`Reward points: ${rewards}`}
                className="medium_text reaction_button unselected centered"
                onMouseDown={() => react(reactId)}
                onMouseUp={unreact}
                onTouchStart={() => react(reactId)}
                onTouchEnd={unreact}
                data-testid="reaction-picker"
            >
                {reaction2icon(Number(reactId))}
            </button>
        ))}
    </div>
);

export const Reactions = ({
    reactionsMap,
    react,
    unreact,
}: {
    reactionsMap: { [id: number]: UserId[] };
    react: (id: number) => void;
    unreact: () => void;
}) => {
    const entries = Object.entries(reactionsMap);
    return (
        <div
            className="max_width_col row_container"
            style={{ justifyContent: "flex-start" }}
        >
            {entries.map(([reactId, users]) => {
                const reacted = users.includes(window.user?.id);
                return (
                    <button
                        key={reactId}
                        className={
                            "reaction_button " +
                            (reacted ? "selected" : "unselected")
                        }
                        onMouseDown={() => react(parseInt(reactId))}
                        onMouseUp={unreact}
                        onTouchStart={() => react(parseInt(reactId))}
                        onTouchEnd={unreact}
                        data-testid={reactId + "-reaction"}
                    >
                        <span className="medium_text right_quarter_spaced">
                            {reaction2icon(Number(reactId))}
                        </span>
                        {users.length}
                    </button>
                );
            })}
        </div>
    );
};

const skipClicks = (elem: HTMLElement | null): boolean =>
    elem != null &&
    (elem.dataset["meta"] == "skipClicks" || skipClicks(elem.parentElement));

const objectReduce = (
    obj: any,
    f: (acc: number, key: string, val: UserId[]) => number,
    initVal: number,
) => Object.keys(obj).reduce((acc, key) => f(acc, key, obj[key]), initVal);

export const filesToUrls = (files: { [id: string]: [number, number] }) =>
    Object.keys(files).reduce(
        (acc, key) => {
            const [id, bucketId] = key.split("@");
            const [offset, len] = files[key];
            acc[id] = bucket_image_url(bucketId, offset, len);
            return acc;
        },
        {} as { [id: string]: string },
    );

function bucket_image_url(bucket_id: string, offset: number, len: number) {
    // Fall back to the mainnet if the local config doesn't contain the bucket.
    let fallback_to_mainnet = !window.backendCache.stats.buckets.find(
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
