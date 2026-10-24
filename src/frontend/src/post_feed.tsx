import * as React from "react";
import { bigScreen, expandMeta, isRoot, Loading } from "./common";
import { PostView } from "./post";
import { Meta, Post, PostId } from "./types";

export const PostFeed = ({
    classNameArg,
    focusedPost,
    feedLoader,
    heartbeat,
    title,
    thread,
    includeComments,
    highlighted,
    useList,
    journal,
}: {
    classNameArg?: string;
    focusedPost?: PostId;
    feedLoader: (
        page: number,
        offset: number,
        comments?: boolean,
    ) => Promise<[Post, Meta][] | null>;
    heartbeat?: any;
    title?: JSX.Element;
    thread?: boolean;
    includeComments?: boolean;
    highlighted?: PostId[];
    useList?: boolean;
    journal?: boolean;
}) => {
    const [page, setPage] = React.useState(0);
    const [offset, setOffset] = React.useState(0);
    const [posts, setPosts] = React.useState<Post[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [displayPageFlipper, setPageVlipperVisibility] =
        React.useState(!thread);
    const reqId = React.useRef(0);

    const loadPage = async (page: number) => {
        const id = ++reqId.current;
        // Only show the loading indicator while flipping pages; the first
        // load already starts with `loading` set.
        if (page > 0) setLoading(true);
        const loadedPosts = await feedLoader(
            page,
            page == 0 ? 0 : offset,
            !!includeComments,
        );
        // Drop the response if a newer load has started meanwhile.
        if (id !== reqId.current) return;
        if (!loadedPosts) {
            setLoading(false);
            return;
        }
        let nextPosts = loadedPosts.map(expandMeta);
        setPosts((prev) => (page == 0 ? nextPosts : prev.concat(nextPosts)));
        if (page == 0 && nextPosts.length > 0) setOffset(nextPosts[0].id);
        if (nextPosts.length < window.backendCache.config.feed_page_size)
            setPageVlipperVisibility(false);
        setLoading(false);
    };

    React.useEffect(() => {
        setPage(0);
        loadPage(0);
        setPageVlipperVisibility(!thread);
    }, [heartbeat]);

    const itemRenderer = (
        post: Post,
        firstItem?: boolean,
        lastItem?: boolean,
    ) => (
        <PostView
            id={post.id}
            key={post.id}
            data={post}
            highlighted={highlighted}
            isFeedItem={true}
            isJournalView={journal}
            classNameArg={`${
                !isRoot(post) && thread
                    ? "comment"
                    : firstItem && thread
                      ? "prime"
                      : "feed_item"
            }`}
            focused={post.id == focusedPost}
            isCommentView={thread}
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
                (useGrid ? renderGrid() : renderColumns())}
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
