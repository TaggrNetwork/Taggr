import React from "react";
import { HeadBar, TabBar } from "./common";
import { Tokens } from "@dfinity/ledger-icrc/dist/candid/icrc_ledger";
import { Feature, Meta, Post } from "./types";
import { newPostCallback } from "./new";
import { Form } from "./form";
import { PostFeed } from "./post_feed";

export const Roadmap = () => {
    const [posts, setPosts] = React.useState<[Post, Meta][]>([]);
    const [tab, setTab] = React.useState("OPEN");

    const loadData = async () => {
        const features = await window.api.query<
            [[Post, Meta], Tokens, Feature][]
        >("features", []);
        if (!features) return;
        features.sort(([_f1, tokens1], [_f2, tokens2]) =>
            Number(tokens2 - tokens1),
        );
        setPosts(
            features
                .filter(
                    ([_post, _tokens, feature]) =>
                        feature.status == (tab == "IMPLEMENTED" ? 1 : 0),
                )
                .map(([posts_with_meta]) => posts_with_meta),
        );
    };

    React.useEffect(() => {
        loadData();
    }, [tab]);

    return (
        <>
            <HeadBar
                title="ROADMAP"
                shareLink="roadmap"
                menu={true}
                content={
                    <>
                        <h2>New Feature Request Form</h2>
                        <Form
                            featureRequest={true}
                            submitCallback={newPostCallback}
                        />
                    </>
                }
            />
            <div className="outstanding vertically_spaced spaced">
                This is the community driven roadmap for{" "}
                {window.backendCache.config.name}. Any user can add a new
                feature requests for{" "}
                <code>{window.backendCache.config.feature_cost}</code> credits.
                All features are sorted by the voting power of the supporters.
                The order of features signalizes their priority as defined by
                DAO's support. When creating a new feature request, be clear and
                concise, link all previous discussions and design documents.
            </div>
            <TabBar
                tabs={["OPEN", "IMPLEMENTED"]}
                activeTab={tab}
                onTabChange={setTab}
            />
            <PostFeed
                heartbeat={posts}
                useList={true}
                feedLoader={async (_: any) => posts}
            />
        </>
    );
};
