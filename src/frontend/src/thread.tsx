import { HeadBar, setTitle } from "./common";
import { PostFeed } from "./post_feed";
import { PostId } from "./types";

export const Thread = ({ id }: { id: PostId }) => {
    setTitle(`Thread to #${id}`);
    return (
        <>
            {
                // @ts-ignore
                <HeadBar
                    title={`THREAD to #${id}`}
                    shareLink={`thread/${id}`}
                />
            }
            <PostFeed
                heartbeat={id}
                no_paging={true}
                thread={true}
                focusedPost={id}
                // @ts-ignore
                classNameArg="thread"
                useList={true}
                feedLoader={async () => await window.api.query("thread", id)}
            />
        </>
    );
};
