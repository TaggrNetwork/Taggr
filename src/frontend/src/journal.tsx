import * as React from "react";
import { bigScreen, Loading, NotFound, setTitle, ShareButton } from "./common";
import { Content } from "./content";
import { PostFeed } from "./post_feed";
import { PostId, User } from "./types";
import { FollowButton } from "./profile";
import { UserLink } from "./user_resolve";

export const Journal = ({ handle }: { handle: string }) => {
    const [status, setStatus] = React.useState(0);
    const [profile, setProfile] = React.useState({} as User);

    const loadState = () =>
        window.api.query<User>("user", [handle]).then((profile) => {
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

    switch (status) {
        case -1:
            return <NotFound />;
        case 0:
            return <Loading />;
    }

    const { name } = window.backendCache.config;

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
                    {
                        <Content
                            value={profile.about}
                            classNameArg="spaced text_centered vertically_spaced"
                        />
                    }
                    <div
                        className="row_container vertically_spaced"
                        style={{ justifyContent: "center" }}
                    >
                        <FollowButton id={profile.id} />
                        <ShareButton
                            url={`journal/${handle}`}
                            title={`${handle}'s journal on ${name}`}
                        />
                    </div>
                </div>
            )}
            <PostFeed
                classNameArg={bigScreen() ? "journal" : undefined}
                useList={true}
                journal={true}
                feedLoader={async (page: number, offset: PostId) =>
                    await window.api.query("journal", handle, page, offset)
                }
            />
        </>
    );
};
