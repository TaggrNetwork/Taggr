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
}: {
    classNameArg?: string;
    focusedPost?: PostId;
    feedLoader: (page: number, comments?: boolean) => Promise<Post[] | null>;
    heartbeat?: any;
    title?: JSX.Element;
    comments?: boolean;
    thread?: boolean;
    includeComments?: boolean;
    level?: number;
    highlighted?: PostId[];
    useList?: boolean;
    journal?: boolean;
}) => {
    const [page, setPage] = React.useState(0);
    const [posts, setPosts] = React.useState<Post[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [displayPageFlipper, setPageVlipperVisibility] = React.useState(
        !comments && !thread,
    );

    const loadPage = async (page: number) => {
        setLoading(true);
        const loadedPost = await feedLoader(page, !!includeComments);
        if (!loadedPost) return;
        let nextPosts = loadedPost.map(expandUser);
        setPosts(page == 0 ? nextPosts : posts.concat(nextPosts));
        if (nextPosts.length < window.backendCache.config.feed_page_size)
            setPageVlipperVisibility(false);
        setLoading(false);
    };

    React.useEffect(() => {
        setPage(0);
        loadPage(0);
    }, [heartbeat]);

    const itemRenderer = (post: Post, lastItem?: boolean) => (
        <PostView
            id={post.id}
            key={post.id}
            data={post}
            level={level}
            highlighted={highlighted}
            isFeedItem={true}
            isJournalView={journal}
            classNameArg={`${
                !isRoot(post) && (comments || thread) ? "comment" : "feed_item"
            }`}
            focused={post.id == focusedPost}
            isCommentView={comments || thread}
            isThreadView={thread && !lastItem}
        />
    );

    const useGrid =
        !useList && bigScreen() && window.user?.settings.columns != "off";
    let renderColumns = () =>
        posts.map((item, i) => itemRenderer(item, i == posts.length - 1));
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
                        id="pageFlipper"
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
