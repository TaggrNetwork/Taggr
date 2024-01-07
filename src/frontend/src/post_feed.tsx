import * as React from "react";
import { bigScreen, isRoot, Loading, expandUser } from "./common";
import { PostView } from "./post";
import { Post, PostId } from "./types";

export const PostFeed = ({
    classNameArg,
    focusedPost,
    feedLoader,
    heartbeat,
    title,
    comments,
    thread,
    includeComments,
    level,
    highlighted,
    useList,
    journal,
    refreshRateSecs = 0,
}: {
    classNameArg?: string;
    focusedPost?: PostId;
    feedLoader: (
        page: number,
        offset: number,
        comments?: boolean,
    ) => Promise<Post[] | null>;
    heartbeat?: any;
    title?: JSX.Element;
    comments?: boolean;
    thread?: boolean;
    includeComments?: boolean;
    level?: number;
    highlighted?: PostId[];
    useList?: boolean;
    journal?: boolean;
    refreshRateSecs?: number;
}) => {
    const [page, setPage] = React.useState(0);
    const [offset, setOffset] = React.useState(0);
    const [posts, setPosts] = React.useState<Post[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [displayPageFlipper, setPageVlipperVisibility] = React.useState(
        !comments && !thread,
    );
    const [refreshBeat, setRefreshBeat] = React.useState(0);

    React.useEffect(() => {
        if (!refreshRateSecs) return;
        let t = setTimeout(async () => {
            if (
                Number(new Date()) - Number(window.lastActivity) >=
                refreshRateSecs * 1000
            ) {
                setRefreshBeat(refreshBeat + 1);
            }
            return () => clearTimeout(t);
        }, refreshRateSecs * 1000);
    }, [refreshBeat, refreshRateSecs]);

    const loadPage = async (page: number) => {
        // only show the loading indicator on the first load
        setLoading(refreshBeat == 0);
        const loadedPost = await feedLoader(
            page,
            page == 0 ? 0 : offset,
            !!includeComments,
        );
        if (!loadedPost) return;
        let nextPosts = loadedPost.map(expandUser);
        setPosts(page == 0 ? nextPosts : posts.concat(nextPosts));
        if (page == 0 && nextPosts.length > 0) setOffset(nextPosts[0].id);
        if (nextPosts.length < window.backendCache.config.feed_page_size)
            setPageVlipperVisibility(false);
        setLoading(false);
    };

    React.useEffect(() => {
        setPage(0);
        loadPage(0);
    }, [heartbeat, refreshBeat]);

    const itemRenderer = (
        post: Post,
        firstItem?: boolean,
        lastItem?: boolean,
    ) => (
        <PostView
            id={post.id}
            key={post.id}
            data={post}
            level={level}
            highlighted={highlighted}
            isFeedItem={true}
            isJournalView={journal}
            classNameArg={
                `${thread ? "" : "collapsable"} ` +
                `${
                    !isRoot(post) && (comments || thread)
                        ? "comment"
                        : firstItem && thread
                        ? "prime"
                        : "feed_item"
                }`
            }
            focused={post.id == focusedPost}
            isCommentView={comments || thread}
            isThreadView={thread && !lastItem}
        />
    );

    const useGrid =
        !useList && bigScreen() && window.user?.settings.columns != "off";
    let renderColumns = () =>
        posts.map((item, i) =>
            itemRenderer(item, i == 0, i == posts.length - 1),
        );
    const renderGrid = () => (
        <GridFeed posts={posts} itemRenderer={itemRenderer} />
    );

    return (
        <div className={classNameArg}>
            {title && title}
            {(!loading || page > 0) &&
                (useGrid && !comments ? renderGrid() : renderColumns())}
            {loading && <Loading />}
            {displayPageFlipper && !loading && posts.length > 0 && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                    <button
                        className="pageFlipper"
                        onClick={async () => {
                            const nextPage = page + 1;
                            setPage(nextPage);
                            await loadPage(nextPage);
                        }}
                    >
                        MORE
                    </button>
                </div>
            )}
        </div>
    );
};

const GridFeed = ({
    posts,
    itemRenderer,
}: {
    posts: Post[];
    itemRenderer: (post: Post, last_item?: boolean) => JSX.Element;
}) => {
    const columnLeft = posts.filter((_, i) => i % 2 == 0);
    const columnRight = posts.filter((_, i) => i % 2 == 1);
    return (
        <div className="row_container">
            <div className="grid_column" style={{ marginRight: "auto" }}>
                {columnLeft.map((p) => itemRenderer(p))}
            </div>
            <div className="grid_column" style={{ marginLeft: "auto" }}>
                {columnRight.map((p) => itemRenderer(p))}
            </div>
        </div>
    );
};
