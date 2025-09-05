import { Principal } from "@dfinity/principal";
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
    tokens,
    bucket_image_url,
    currentRealm,
    noiseControlBanner,
    showPopUp,
    postAllowed,
    NotAllowed,
    onCanonicalDomain,
    getCanistersMetaData,
    numberToUint8Array,
    shortenTokensAmount,
    icpSwapLogoFallback,
    popUp,
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
    Pin,
} from "./icons";
import { ProposalView } from "./proposals";
import { DEFAULT_REACTION_HOLD_TIME } from "./settings";
import {
    Feature,
    Icrc1Canister,
    Post,
    PostId,
    PostTip,
    Realm,
    UserId,
} from "./types";
import {
    USER_CACHE,
    UserLink,
    UserList,
    populateUserNameCache,
} from "./user_resolve";
import { CANISTER_ID } from "./env";
import { TokenSelect } from "./token-select";

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
    const [urls, setUrls] = React.useState({});
    const [notFound, setNotFound] = React.useState(false);
    const [notAllowed, setNotAllowed] = React.useState(false);
    const [hidden, setHidden] = React.useState(false);
    const [showComments, toggleComments] = React.useState(!!prime);
    const [showInfo, toggleInfo] = React.useState(false);
    const [safeToOpen, setSafeToOpen] = React.useState(false);
    const [commentIncoming, setCommentIncoming] = React.useState(false);

    const refPost = React.useRef();

    const loadData = async (preloadedData?: Post) => {
        const data = preloadedData || (await loadPosts([id])).pop();
        if (!data) {
            setNotFound(true);
            return;
        }

        if (!postAllowed(data)) setNotAllowed(true);

        let effBody = data.body;
        if (version != undefined && !isNaN(version)) {
            for (let i = data.patches.length - 1; i >= version; i--) {
                const [_timestamp, patch] = data.patches[i];
                effBody = applyPatch(effBody, patch)[0];
            }
        }
        setBody(effBody);
        setUrls(filesToUrls(data.files));
        setPost(data);
        // I truly do not understand why this is needed on post pages,
        // but without it, the post page opened from a feed scrolled down
        // is displayed as scrolled down too.
        if (prime) window.scrollTo(0, 0);
    };

    React.useEffect(() => {
        loadData(data);
    }, [id, version, data]);

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
            showPopUp("error", result.Err);
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
            if ("Err" in response) showPopUp("error", response.Err);
            window.reloadUser();
        });
        users.push(userId);
        setPost({ ...post });
        toggleInfo(commentIncoming);
    };

    const isComment = !isRoot(post);
    const expanded =
        isComment || focused || (!isFeedItem && !repost) || isThreadView;
    const costTable = reactionCosts();
    const isInactive =
        notAllowed ||
        objectReduce(
            post.reactions,
            (acc, id, users) => acc + costTable[id as any] * users.length,
            0,
        ) < 0;
    const deleted = post.hashes.length > 0;
    const commentAsPost = isComment && !isCommentView;
    const realmPost =
        (!isComment || !isCommentView) &&
        post.realm &&
        post.realm != currentRealm();
    const postCreated =
        post.patches.length > 0 ? post.patches[0][0] : post.timestamp;
    const isNSFW =
        isFeedItem &&
        !safeToOpen &&
        (body.toLowerCase().includes("#nsfw") ||
            (post.meta.nsfw && post.realm != currentRealm()));
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
    const { realm_color } = post.meta;
    const blogTitle =
        prime && body.length > 750 && body.startsWith("# ")
            ? {
                  author: post.meta.author_name,
                  realm: post.realm,
                  created: postCreated,
                  length: body.length,
                  background: realm_color,
              }
            : undefined;

    if (prime) setTitle(`Post #${post.id} by @${post.meta.author_name}`);

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
                            classNameArg="left_well_spaced right_half_spaced vcentered"
                            id={post.user}
                            name={post.meta.author_name}
                            profile={true}
                            pfpSize={isComment ? undefined : 32}
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
                                background={realm_color}
                                classNameArg="realm_tag"
                            />
                        )}
                    </div>
                )}
                {post.encrypted && (
                    <div className="text_centered x_large_text">ENCRYPTED</div>
                )}
                {isNSFW && (
                    <div
                        className="nsfw x_large_text"
                        onClick={() => setSafeToOpen(true)}
                    >
                        NSFW
                    </div>
                )}
                {notAllowed && <NotAllowed />}
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
                {!isNSFW && !post.encrypted && !notAllowed && (
                    <article onClick={goInside}>
                        <Content
                            blogTitle={blogTitle}
                            post={true}
                            value={body}
                            collapse={!expanded}
                            primeMode={isRoot(post) && !repost}
                            urls={urls}
                        />
                    </article>
                )}
                {showExtension && post.extension == "Feature" && (
                    <FeatureView id={post.id} />
                )}
                {showExtension && typeof post.extension == "object" && (
                    <>
                        {"Poll" in post.extension && (
                            <PollView
                                poll={post.extension.Poll}
                                post_id={post.id}
                                created={postCreated}
                            />
                        )}
                        {"Repost" in post.extension && (
                            <PostView
                                id={post.extension.Repost}
                                repost={true}
                                classNameArg="post_extension repost"
                            />
                        )}
                        {"Proposal" in post.extension && (
                            <ProposalView
                                postId={post.id}
                                id={post.extension.Proposal}
                            />
                        )}
                    </>
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
                <PostInfo
                    post={post}
                    reactions={post.reactions}
                    version={version}
                    versionSpecified={versionSpecified}
                    postCreated={postCreated}
                    callback={async () => await loadData()}
                    realmMoveOutCallback={() => setHidden(true)}
                    commentSubmissionCallback={commentSubmissionCallback}
                    writingCallback={() => setCommentIncoming(true)}
                />
            )}
            {(showComments || prime) && post.children.length > 0 && (
                <Comments
                    heartbeat={`${post.id}_${
                        Object.keys(post.children).length
                    }_${showComments}`}
                    level={level + 1}
                    loader={async () => await loadPosts(post.children)}
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
        setPosts(comments || []);
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
    commentSubmissionCallback,
    writingCallback,
}: {
    post: Post;
    reactions: { [id: number]: UserId[] };
    version?: number;
    postCreated: BigInt;
    callback: () => Promise<void>;
    realmMoveOutCallback: () => void;
    versionSpecified?: boolean;
    commentSubmissionCallback: (
        comment: string,
        blobs: [string, Uint8Array][],
    ) => Promise<any>;
    writingCallback: () => void;
}) => {
    const [realmData, setRealmData] = React.useState<Realm | null>();
    const [loaded, setLoaded] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [externalTips, setExternalTips] = React.useState<PostTip[]>([]);
    const [canistersMetaData, setCanisterMetaData] = React.useState<
        Record<string, Icrc1Canister>
    >({}); // All tokens data
    const [allowedTippingCanisterIds, setAllowedTippingCanisterIds] =
        React.useState<string[]>([]); // Allowed tipping tokens

    const loadData = async () => {
        // Load realm data asynchronously
        const realmPromise = post.realm
            ? window.api
                  .query<Realm[]>("realms", [post.realm])
                  .then((realmData) => {
                      setRealmData(realmData?.at(0));
                      return realmData?.at(0);
                  })
            : Promise.resolve(undefined);
        const ids: UserId[] = [post.user]
            // @ts-ignore
            .concat(...Object.values(reactions))
            // @ts-ignore
            .concat(post.watchers)
            // @ts-ignore
            .concat(Object.keys(post.tips).map(Number))
            // External tip senders
            .concat(
                post.external_tips?.map(({ sender_id }) => sender_id) || [],
            );

        await populateUserNameCache(ids, setLoading);

        realmPromise
            .then((realm) => loadExternalTipsData(realm))
            .catch(console.error);

        setLoaded(true);
    };

    /** Load canister data of external tips */
    const loadExternalTipsData = async (realm: Realm | undefined) => {
        const externalTips = post.external_tips || [];
        const allTokenIds = [
            CANISTER_ID,
            ...externalTips.map(({ canister_id }) => canister_id),
        ];
        const allowedTippingCanisterIds = [CANISTER_ID];
        if (realm?.tokens) {
            allowedTippingCanisterIds.push(...realm.tokens);
            allTokenIds.push(...realm.tokens);
        }

        const metadata = await getCanistersMetaData([
            ...new Set(allTokenIds),
        ]).catch(() => new Map<string, Icrc1Canister>());

        setCanisterMetaData(Object.fromEntries(metadata));

        setAllowedTippingCanisterIds(
            [...new Set(allowedTippingCanisterIds)].filter(
                (canisterId) => !!metadata.get(canisterId),
            ),
        );

        setExternalTips(externalTips);
    };

    let initial = false;
    React.useEffect(() => {
        if (!initial) {
            initial = true;
            loadData().finally(() => (initial = false));
        }
    }, []);

    const user = window.user;
    let realmAccessError = null;
    if (user) {
        if (post.meta.viewer_blocked)
            realmAccessError = (
                <div className="banner vertically_spaced">
                    You're blocked by this user.
                </div>
            );
        else if (
            realmData &&
            realmData.comments_filtering &&
            realmData.whitelist.length > 0 &&
            !realmData.whitelist.includes(user.id)
        )
            realmAccessError = (
                <div className="banner vertically_spaced">
                    This realm is gated by a whitelist.
                </div>
            );
        else if (realmData && realmData.comments_filtering)
            realmAccessError = noiseControlBanner(
                "realm",
                realmData.filter,
                user,
            );
        else if (!post.realm)
            realmAccessError = noiseControlBanner(
                "user",
                post.meta.author_filters,
                user,
            );
    }

    const postAuthor = user?.id == post.user;
    const realmController =
        user && user.controlled_realms.includes(post.realm || "");
    const { token_symbol, token_decimals } = window.backendCache.config;
    if (loading || !loaded) return <Loading />;
    return (
        <div
            className="left_half_spaced right_half_spaced top_spaced"
            data-testid="post-menu"
        >
            {user && (
                <>
                    {realmAccessError}
                    {!realmAccessError && (
                        <Form
                            submitCallback={commentSubmissionCallback}
                            postId={post.id}
                            writingCallback={writingCallback}
                            comment={true}
                        />
                    )}
                </>
            )}
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
                        {postAuthor && (
                            <ToggleButton
                                offTitle="Pin post"
                                onTitle="Unpin post"
                                classNameArg="max_width_col"
                                offLabel={<Pin />}
                                onLabel={<Pin classNameArg="accent" />}
                                currState={() =>
                                    window.user.pinned_posts?.includes(
                                        post.id,
                                    ) || false
                                }
                                toggler={async () => {
                                    const result = await window.api.call<{
                                        [key: string]: any;
                                    }>("toggle_pinned_post", post.id);
                                    if (result && "Err" in result)
                                        showPopUp(
                                            "error",
                                            result.Err as string,
                                        );
                                    window.reloadUser();
                                }}
                                testId="pin-post"
                            />
                        )}
                        {!postAuthor && onCanonicalDomain() && (
                            <>
                                <ButtonWithLoading
                                    title="Tip"
                                    label={<Coin />}
                                    classNameArg="max_width_col"
                                    onClick={async () =>
                                        popUp(
                                            <TippingPopup
                                                post={post}
                                                allowedTippingCanisterIds={
                                                    allowedTippingCanisterIds
                                                }
                                                canistersMetaData={
                                                    canistersMetaData
                                                }
                                                externalTips={externalTips}
                                                setExternalTips={
                                                    setExternalTips
                                                }
                                                callback={callback}
                                            />,
                                        )
                                    }
                                />
                            </>
                        )}
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
                                        showPopUp("error", response.Err);
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
                                                showPopUp(
                                                    "error",
                                                    response.Err,
                                                );
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
                        <b>WATCHERS</b>: <UserList ids={post.watchers} />
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
                                    from{" "}
                                    {
                                        <UserLink
                                            id={id}
                                            pfp={false}
                                            profile={true}
                                        />
                                    }
                                </span>
                            )),
                        )}
                    </div>
                )}
                {externalTips.length > 0 &&
                    Object.keys(canistersMetaData).length > 0 && (
                        <div>
                            <b>EXTERNAL TIPS</b>:{" "}
                            {commaSeparated(
                                externalTips.map((tip) => (
                                    <span key={tip.canister_id + tip.index}>
                                        <code>
                                            {shortenTokensAmount(
                                                tip.amount,
                                                canistersMetaData[
                                                    tip.canister_id
                                                ]?.decimals || 0,
                                            )}
                                            {canistersMetaData[tip.canister_id]
                                                ?.symbol || ""}
                                        </code>
                                        <img
                                            src={
                                                canistersMetaData[
                                                    tip.canister_id
                                                ]?.logo ||
                                                icpSwapLogoFallback(
                                                    tip.canister_id,
                                                )
                                            }
                                            className="vertically_aligned "
                                            style={{ height: 16 }}
                                        />{" "}
                                        from{" "}
                                        {
                                            <UserLink
                                                id={tip.sender_id}
                                                profile={true}
                                                pfp={false}
                                            />
                                        }
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
                                <UserList ids={users} profile={true} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
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
        post.meta.viewer_blocked ||
        !user ||
        users.includes(user?.id) ||
        post.user == user?.id;
    const updatedRecently =
        Number(new Date()) - Number(post.tree_update) / 1000000 <
        30 * 60 * 1000;
    const newComments =
        window.user && (post.tree_update > window.lastVisit || updatedRecently);
    const ref = React.useRef(null);
    const delay =
        user && "tap_and_hold" in user.settings
            ? Number(user.settings.tap_and_hold)
            : DEFAULT_REACTION_HOLD_TIME;

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
        <div onClick={goInside}>
            <div
                ref={ref}
                className="active_element"
                style={{ height: "1px", width: 0 }}
            ></div>
            <div className="post_bar vcentered">
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
                {!showEmojis && !showHint && !post.meta.viewer_blocked && (
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
                        {(post.tips.length > 0 ||
                            !!post.external_tips?.length) && (
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
        </div>
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
        className={`framed right_spaced max_width_col ${
            bigScreen() ? "row_container" : "emoji_table"
        }`}
        style={{
            justifyContent: "flex-start",
            padding: "0.5em",
        }}
        data-meta="skipClicks"
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
                        data-meta="skipClicks"
                        className={
                            "reaction_button button_text " +
                            (reacted ? "selected" : "unselected")
                        }
                        onMouseDown={() => react(parseInt(reactId))}
                        onMouseUp={unreact}
                        onTouchStart={() => react(parseInt(reactId))}
                        onTouchEnd={unreact}
                        data-testid={reactId + "-reaction"}
                    >
                        <span className="small_text right_quarter_spaced">
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

const FeatureView = ({ id }: { id: PostId }) => {
    const [feature, setFeature] = React.useState<Feature>();
    const [vp, setVP] = React.useState(0);

    const loadData = async () => {
        const features = await window.api.query<[Post, number, Feature][]>(
            "features",
            [id],
        );
        if (!features || features.length < 1) return;
        setFeature(features[0][2]);
        setVP(features[0][1]);
    };

    React.useEffect(() => {
        loadData();
    }, []);

    if (!feature) return <Loading />;
    const user = window.user;

    return (
        <div className="post_extension">
            <h3>Feature Request</h3>
            <h4>
                Status:{" "}
                <code className={feature.status == 0 ? "accent" : ""}>
                    {feature.status == 0 ? "REQUESTED" : "IMPLEMENTED"}
                </code>
            </h4>
            {feature.supporters.length > 0 && (
                <>
                    <hr />
                    Supporters: <UserList ids={feature.supporters} />
                </>
            )}
            <hr />
            Total voting power support:{" "}
            <code>{tokens(vp, window.backendCache.config.token_decimals)}</code>
            {user && (
                <div className="row_container top_spaced">
                    <ButtonWithLoading
                        classNameArg="max_width_col"
                        label={
                            feature.supporters.includes(user.id)
                                ? "REMOVE SUPPORT"
                                : "SUPPORT"
                        }
                        onClick={async () => {
                            await window.api.call("toggle_feature_support", id);
                            await loadData();
                        }}
                    />
                </div>
            )}
        </div>
    );
};

const TippingPopup = ({
    parentCallback,
    post,
    allowedTippingCanisterIds,
    canistersMetaData,
    externalTips,
    setExternalTips,
    callback,
}: {
    parentCallback?: () => void;
    post: Post;
    allowedTippingCanisterIds: string[];
    canistersMetaData: Record<string, Icrc1Canister>;
    externalTips: PostTip[];
    setExternalTips: React.Dispatch<React.SetStateAction<PostTip[]>>;
    callback: () => Promise<void>;
}) => {
    const [selectedTippingCanisterId, setSelectedTippingCanisterId] =
        React.useState(CANISTER_ID);
    const [tippingAmount, setTippingAmount] = React.useState(0.1);

    const onTokenSelectionChange = (canisterId: string) => {
        setSelectedTippingCanisterId(canisterId);

        const canister = canistersMetaData[canisterId];
        if (!canister) {
            return showPopUp(
                "error",
                `Could not find canister data for ${canisterId}`,
            );
        }
        setTippingAmount(
            Number((canister.fee / Math.pow(10, canister.decimals)).toFixed(
                canister.decimals,
            )),
        );
    };

    const finalizeTip = async () => {
        try {
            const canisterId = selectedTippingCanisterId;
            const canister = canistersMetaData[canisterId];
            if (!canister) {
                return showPopUp(
                    "error",
                    `Could not find canister data for ${canisterId}`,
                );
            }

            const amount = Number((
                tippingAmount * Math.pow(10, canister.decimals)
            ).toFixed(0));
            if (!amount || isNaN(amount)) return;
            if (
                !confirm(
                    `Transfer ${tippingAmount} ${canister.symbol} to @${
                        post.meta.author_name
                    } as a tip?`,
                )
            )
                return;

            const { token_symbol } = window.backendCache.config;
            if (canister.symbol !== token_symbol) {
                let transId = await window.api.icrc_transfer(
                    Principal.fromText(canisterId),
                    Principal.fromText(USER_CACHE[post.user]?.at(1) || ""),
                    amount,
                    canister.fee,
                    numberToUint8Array(post.id),
                );

                if (Number.isNaN(transId as number)) {
                    throw new Error(
                        transId.toString() ||
                            "Something went wrong with transfer!",
                    );
                }

                const optimisticPostTip: PostTip = {
                    amount,
                    canister_id: canisterId,
                    index: Number(transId),
                    sender_id: window.user.id,
                };
                setExternalTips([...externalTips, optimisticPostTip]);

                let addTipResponse = await window.api.call<{
                    Ok: PostTip;
                    Err: string;
                }>(
                    "add_external_icrc_transaction",
                    canisterId,
                    Number(transId),
                    post.id,
                );
                if ("Err" in (addTipResponse || {}) || !addTipResponse) {
                    setExternalTips(
                        externalTips.filter(
                            ({ canister_id, index }) =>
                                index !== optimisticPostTip.index ||
                                canisterId !== canister_id,
                        ),
                    );
                    throw new Error(
                        addTipResponse?.Err || "Could not add tip to post.",
                    );
                }

                setExternalTips([
                    ...externalTips.filter(
                        ({ index }) => index !== Number(transId),
                    ),
                    addTipResponse.Ok,
                ]);
            } else {
                let response = await window.api.call<any>(
                    "tip",
                    post.id,
                    amount,
                );
                if ("Err" in response) {
                    throw new Error(response.Err);
                } else await callback();
            }
        } catch (e: any) {
            return showPopUp("error", e?.message || e);
        }
    };

    return (
        <div className="column_container">
            <p>
                Tip <b>{post.meta.author_name} </b>
                with
                <TokenSelect
                    classNameArg="left_half_spaced"
                    canisters={allowedTippingCanisterIds.map((canisterId) => [
                        canisterId,
                        canistersMetaData[canisterId],
                    ])}
                    onSelectionChange={onTokenSelectionChange}
                    selectedCanisterId={selectedTippingCanisterId}
                />
            </p>
            <input
                className="bottom_spaced"
                type="number"
                value={tippingAmount}
                onChange={async (e) => {
                    const amount = Number(e.target.value);
                    if (isNaN(amount)) {
                        return;
                    }
                    setTippingAmount(amount);
                }}
            />
            <ButtonWithLoading
                classNameArg="active"
                label={"SEND"}
                onClick={async () => {
                    await finalizeTip();
                    parentCallback && parentCallback();
                }}
            />
        </div>
    );
};
