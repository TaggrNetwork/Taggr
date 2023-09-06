import * as React from "react";
import { HeadBar, setTitle, ShareButton } from "./common";
import { PostFeed } from "./post_feed";

export const Thread = ({ id }) => {
    setTitle(`Thread to #${id}`);
    return (
        <>
            <HeadBar title={`THREAD to #${id}`} shareLink={`thread/${id}`} />
            <PostFeed
                heartbeat={id}
                no_paging={true}
                thread={true}
                focusedPost={id}
                classNameArg="thread"
                useList={true}
                feedLoader={async () => await api.query("thread", id)}
            />
        </>
    );
};
