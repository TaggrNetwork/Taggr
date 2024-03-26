import React from "react";
import { HeadBar } from "./common";
import { Tokens } from "@dfinity/ledger-icrc/dist/candid/icrc_ledger";
import { Post } from "./types";
import { newPostCallback } from "./new";
import { Form } from "./form";

export const Roadmap = () => {
    const [features, setFeatures] = React.useState<[Post, Tokens][]>([]);

    const loadData = async () => {
        const features =
            await window.api.query<[Post, Tokens][]>("list_features");
        if (!features) return;
        features.sort(([_f1, tokens1], [_f2, tokens2]) =>
            Number(tokens1 - tokens2),
        );
        setFeatures(features);
    };

    React.useEffect(() => {
        loadData();
    }, []);

    console.log(features);
    return (
        <>
            <HeadBar
                title="ROADMAP"
                shareLink="roadmap"
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
            <div className="outstanding">
                This is the community driven roadmap for{" "}
                {window.backendCache.config.name}. Any user can add a new
                feature requests for{" "}
                <code>{window.backendCache.config.feature_cost}</code> credits.
                All features are sorted by the voting power of the supporters.
                When creating a new feature request, be clear and consise, link
                all previous discussions and design documents.
            </div>
        </>
    );
};
