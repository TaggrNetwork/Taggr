import * as React from "react";
import { Form } from "./form";
import {
    getPatch,
    loadPostBlobs,
    loadPosts,
    currentRealm,
    MAX_POST_SIZE_BYTES,
} from "./common";
import { Extension, Post, PostId } from "./types";

export const PostSubmissionForm = ({
    id,
    repost,
}: {
    id: PostId;
    repost: PostId;
}) => {
    const [post, setPost] = React.useState<Post>();
    const [blobs, setBlobs] = React.useState({});

    const load = async () => {
        if (!id) return;
        const post = (await loadPosts([id])).pop();
        if (!post) return;
        setPost(post);
        setBlobs(await loadPostBlobs(post.files));
    };

    React.useEffect(() => {
        load();
    }, []);

    const callback = async (
        text: string,
        blobs: [string, Uint8Array][],
        extension: Extension | undefined,
        realm: string | undefined,
    ): Promise<boolean> => {
        let postId;
        text = text.trim();
        const optionalRealm = realm ? [realm] : [];
        if (post?.id) {
            const patch = getPatch(text, post.body);
            let response: any = await window.api.edit_post(
                id,
                text,
                blobs,
                patch,
                optionalRealm,
            );
            if ("Err" in response) {
                alert(`Error: ${response.Err}`);
                return false;
            }
            postId = post.id;
        } else {
            const postSize =
                text.length +
                blobs.reduce((acc, [_, blob]) => acc + blob.length, 0);
            let result: any;
            // If the post has too many blobs, upload them separately.
            if (postSize > MAX_POST_SIZE_BYTES) {
                await window.api.add_post_data(
                    text,
                    optionalRealm,
                    encodeExtension(extension),
                );
                let results = await Promise.all(
                    blobs.map(([id, blob]) =>
                        window.api.add_post_blob(id, blob),
                    ),
                );
                let error: any = results.find((result: any) => "Err" in result);
                if (error) {
                    alert(`Error: ${error.Err}`);
                    return false;
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
            if ("Err" in result) {
                alert(`Error: ${result.Err}`);
                return false;
            }
            postId = result.Ok;
        }
        window.resetUI();
        location.href = `#/post/${postId}`;
        return true;
    };

    if (!isNaN(id) && !post) return null;

    return (
        <div className="spaced top_spaced">
            <Form
                submitCallback={callback}
                postId={id}
                content={post?.body || ""}
                blobs={blobs}
                expanded={true}
                repost={repost}
                realmArg={post?.realm || currentRealm()}
            />
            <h3>Tipps</h3>
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
                    Use three empty lines to create a cut line for long posts.
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
