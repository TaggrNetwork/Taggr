import * as React from "react";
import { Form } from "./form";
import {
    getPatch,
    loadPostBlobs,
    loadPosts,
    currentRealm,
    MAX_POST_SIZE_BYTES,
} from "./common";

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
            let result;
            // If the post has too many blobs, upload them separately.
            if (postSize > MAX_POST_SIZE_BYTES) {
                await api.add_post_data(
                    text,
                    optionalRealm,
                    encodeExtension(extension),
                );
                let results = await Promise.all(
                    blobs.map(([id, blob]) => api.add_post_blob(id, blob)),
                );
                let error = results.find((result) => "Err" in result);
                if (error) {
                    alert(`Error: ${error.Err}`);
                    return;
                }
                result = await api.commit_post();
            } else {
                result = await api.add_post(
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
        window.cleanUICache();
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

const encodeExtension = (extension) =>
    extension ? [new TextEncoder().encode(JSON.stringify(extension))] : [];
