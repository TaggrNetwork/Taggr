import * as React from "react";
import { Form } from "./form";
import { getPatch, loadPostBlobs, loadPosts, currentRealm } from "./common";

export const PostSubmissionForm = ({ id, repost }) => {
    const [post, setPost] = React.useState(null);
    const [blobs, setBlobs] = React.useState({});

    const load = async () => {
        if (!id) return;
        const post = (await loadPosts([id])).pop();
        setPost(post);
        setBlobs(await loadPostBlobs(post.files));
    };

    React.useEffect(() => {
        load();
    }, []);

    const callback = async (text, blobs, extension, realm) => {
        let postId;
        text = text.trim();
        const optionalRealm = realm ? [realm] : [];
        if (post?.id) {
            const patch = getPatch(text, post.body);
            let response = await api.edit_post(
                id,
                text,
                blobs,
                patch,
                optionalRealm
            );
            if ("Err" in response) {
                alert(`Error: ${response.Err}`);
                return;
            }
            postId = post.id;
        } else {
            const result = await api.add_post(
                text,
                blobs,
                [],
                optionalRealm,
                encodeExtension(extension)
            );
            if ("Err" in result) {
                return alert(`Error: ${result.Err}`);
            }
            postId = result.Ok;
        }
        window.cleanUICache();
        // If we have created the very first post, we need to fetch the bucket ids from the backend.
        if (backendCache.stats.buckets.length == 0 && blobs.length > 0)
            await window.reloadCache();
        location.href = `#/post/${postId}`;
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

const encodeExtension = (extension) =>
    extension ? [new TextEncoder().encode(JSON.stringify(extension))] : [];
