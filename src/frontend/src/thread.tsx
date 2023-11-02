import { HeadBar, setTitle } from "./common";
import { PostFeed } from "./post_feed";
import { PostId } from "./types";

export const Thread = ({ id }: { id: PostId }) => {
    setTitle(`Thread to #${id}`);
    return (
        <>
            {
                <HeadBar
                    title={
                        <>
                            THREAD TO <code>#{id}</code>
                        </>
                    }
                    shareLink={`thread/${id}`}
                />
            }
            <PostFeed
                heartbeat={id}
                thread={true}
                focusedPost={id}
                classNameArg="thread"
                useList={true}
                feedLoader={async () => await window.api.query("thread", id)}
            />
        </>
    );
};
