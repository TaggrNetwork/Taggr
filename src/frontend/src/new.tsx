import * as React from "react";
import { Form } from "./form";
import {
    getPatch,
    loadPosts,
    currentRealm,
    MAX_POST_SIZE_BYTES,
} from "./common";
import { Extension, Post, PostId } from "./types";
import { filesToUrls } from "./post";

export const PostSubmissionForm = ({
    id,
    repost,
}: {
    id?: PostId;
    repost?: PostId;
}) => {
    const [post, setPost] = React.useState<Post>();

    const load = async () => {
        if (id == undefined) return;
        const post = (await loadPosts([id])).pop();
        if (!post) return;
        setPost(post);
    };

    React.useEffect(() => {
        load();
    }, []);

    const callback = async (
        text: string,
        blobs: [string, Uint8Array][],
        extension: Extension | undefined,
        realm: string | undefined,
    ): Promise<PostId | null> => {
        let postId;
        text = text.trim();
        const optionalRealm = realm ? [realm] : [];
        if (post?.id != undefined) {
            const patch = getPatch(text, post.body);
            let response: any = await window.api.edit_post(
                post.id,
                text,
                blobs,
                patch,
                optionalRealm,
            );
            if ("Err" in response) {
                alert(`Error: ${response.Err}`);
                return null;
            }
            postId = post.id;
        } else postId = await newPostCallback(text, blobs, extension, realm);
        return postId == null ? null : Number(postId);
    };

    if (id != undefined && !isNaN(id) && !post) return null;

    return (
        <div className="spaced top_spaced">
            <Form
                submitCallback={callback}
                postId={id}
                content={post?.body || ""}
                urls={filesToUrls(post?.files || {})}
                expanded={true}
                repost={repost}
                realmArg={post?.realm || currentRealm()}
            />
            <h3>Tips</h3>
            <ul>
                <li>
                    Use{" "}
                    <a target="_blank" href="https://commonmark.org/help/">
                        Markdown
                    </a>{" "}
                    for formatting.
                </li>
                <li>
                    Use <code>#hashtags</code> if you want your post to appear
                    in the corresponding tag-feed.
                </li>
                <li>
                    For long posts, use three empty lines to separate the
                    introductory part from the rest of the content.
                </li>
                <li>You can drag and drop images into the text area.</li>
                <li>
                    Group images together and separate from the rest by new
                    lines to create galleries.
                </li>
                <li>Use the #NSFW hashtag to mask your content by default.</li>
            </ul>
        </div>
    );
};

const encodeExtension = (extension?: Extension) =>
    extension ? [new TextEncoder().encode(JSON.stringify(extension))] : [];

export const newPostCallback = async (
    text: string,
    blobs: [string, Uint8Array][],
    extension: Extension | undefined,
    realm: string | undefined,
) => {
    const optionalRealm = realm ? [realm] : [];
    const postSize =
        text.length + blobs.reduce((acc, [_, blob]) => acc + blob.length, 0);
    let result: any;
    // If the post has too many blobs, upload them separately.
    if (postSize > MAX_POST_SIZE_BYTES) {
        await window.api.add_post_data(
            text,
            optionalRealm,
            encodeExtension(extension),
        );
        let results = await Promise.all(
            blobs.map(([id, blob]) => window.api.add_post_blob(id, blob)),
        );
        let error: any = results.find((result: any) => "Err" in result);
        if (error) {
            alert(`Error: ${error.Err}`);
            return null;
        }
        result = await window.api.commit_post();
    } else {
        result = await window.api.add_post(
            text,
            blobs,
            [],
            optionalRealm,
            encodeExtension(extension),
        );
    }
    if (!result) {
        alert(`Error: call failed`);
        return null;
    } else if ("Err" in result) {
        alert(`Error: ${result.Err}`);
        return null;
    }
    // this is the rare case when a blob triggers the creation of a new bucket
    if (window.backendCache.stats.buckets.length == 0) {
        await window.reloadCache();
    }
    return Number(result.Ok);
};
