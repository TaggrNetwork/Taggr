import * as React from "react";
import {
    bigScreen,
    domain,
    Loading,
    NotFound,
    setTitle,
    ShareButton,
} from "./common";
import { Content } from "./content";
import { PostFeed } from "./post_feed";
import { PostView } from "./post";
import { PostId, User, Post } from "./types";
import { loadPosts } from "./common";
import { FollowButton } from "./profile";
import { Pin } from "./icons";
import { UserLink } from "./user_resolve";

export const Journal = ({ handle }: { handle: string }) => {
    const [status, setStatus] = React.useState(0);
    const [profile, setProfile] = React.useState({} as User);
    const [pinnedPosts, setPinnedPosts] = React.useState<Post[]>([]);

    const loadState = () =>
        window.api.query<User>("user", "", [handle]).then((profile) => {
            if (profile) {
                setProfile(profile);
                setTitle(`${profile.name}'s profile`);
                setStatus(1);
            } else {
                setStatus(-1);
            }
        });

    React.useEffect(() => {
        loadState();
    }, [handle]);

    React.useEffect(() => {
        if (!profile.pinned_posts || profile.pinned_posts.length == 0) return;
        loadPosts(profile.pinned_posts).then((posts) =>
            setPinnedPosts(posts.filter((p) => p !== null)),
        );
    }, [profile.id]);

    switch (status) {
        case -1:
            return <NotFound />;
        case 0:
            return <Loading />;
    }

    const hasPinnedPosts = pinnedPosts.length > 0;

    return (
        <>
            {profile && (
                <div className="text_centered">
                    <h1>
                        <UserLink
                            id={profile.id}
                            name={profile.name}
                            profile={true}
                        />
                        's Journal
                    </h1>
                    <div className="spaced text_centered vertically_spaced">
                        <Content value={profile.about} />
                    </div>
                    <div
                        className="row_container vertically_spaced"
                        style={{ justifyContent: "center" }}
                    >
                        <FollowButton id={profile.id} />
                        <ShareButton url={`journal/${handle}`} />
                    </div>
                </div>
            )}
            {profile.deactivated ? (
                <div className="text_centered vertically_spaced">
                    This account is deactivated.
                </div>
            ) : (
                <div className={bigScreen() ? "journal" : undefined}>
                    {hasPinnedPosts && (
                        <>
                            <h2>
                                <Pin classNameArg="accent" /> Pinned posts
                            </h2>
                            {pinnedPosts.map((post) => (
                                <PostView
                                    key={post.id}
                                    id={post.id}
                                    data={post}
                                    isFeedItem={true}
                                    isJournalView={true}
                                    classNameArg="feed_item"
                                />
                            ))}
                            <br />
                            <h2>Latest posts</h2>
                        </>
                    )}
                    <PostFeed
                        useList={true}
                        journal={true}
                        feedLoader={async (page: number, offset: PostId) =>
                            await window.api.query(
                                "journal",
                                domain(),
                                handle,
                                page,
                                offset,
                            )
                        }
                    />
                </div>
            )}
        </>
    );
};
