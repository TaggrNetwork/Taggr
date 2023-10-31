import * as React from "react";
import { bigScreen, Loading, NotFound, ShareButton } from "./common";
import { Content } from "./content";
import { PostFeed } from "./post_feed";
import { User } from "./types";

export const Journal = ({ handle }: { handle: string }) => {
    const [status, setStatus] = React.useState(0);
    const [profile, setProfile] = React.useState({} as User);

    const loadState = () =>
        window.api.query<User>("user", [handle]).then((profile) => {
            if (profile) {
                setProfile(profile);
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
                        <a href={`/#/user/${profile.name}`}>{profile.name}</a>'s
                        JOURNAL
                    </h1>
                    {
                        // @ts-ignore
                        <Content
                            value={profile.about}
                            classNameArg="text_centered vertically_spaced"
                        />
                    }
                    <div
                        className="row_container vertically_spaced"
                        style={{ justifyContent: "center" }}
                    >
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
                feedLoader={async (page: number) =>
                    await window.api.query("journal", handle, page)
                }
            />
        </>
    );
};
