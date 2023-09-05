import * as React from "react";
import { Loading, ShareButton } from "./common";
import { Content } from "./content";
import { PostFeed } from "./post_feed";
import { getLabels } from "./profile";

export const Journal = ({ handle }) => {
    const [profile, setProfile] = React.useState(null);

    const loadState = () =>
        api.query("user", [handle]).then((profile) => {
            if (profile) setProfile(profile);
        });

    React.useEffect(() => {
        loadState();
    }, [handle]);

    if (!profile) return <Loading />;

    const { name } = backendCache.config;

    return (
        <div>
            {profile && (
                <div className="text_centered">
                    <h1>
                        <a href={`/#/user/${profile.name}`}>{profile.name}</a>'s
                        JOURNAL
                    </h1>
                    <Content
                        value={profile.about}
                        classNameArg="text_centered vertically_spaced"
                    />
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
                feedLoader={async (page) =>
                    await api.query("journal", handle, page)
                }
            />
        </div>
    );
};
