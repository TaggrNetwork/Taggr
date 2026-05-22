import * as React from "react";
import { Principal } from "@dfinity/principal";
import { Form } from "./form";
import { getPatch, loadPosts, currentRealm, showPopUp } from "./common";
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
        text = text.trim();
        const optionalRealm = realm ? [realm] : [];
        if (post?.id != undefined) {
            const refs = await uploadBlobsOrFail(blobs);
            if (refs === null) return null;
            const patch = getPatch(text, post.body);
            const response: any = await window.api.edit_post(
                post.id,
                text,
                refs,
                patch,
                optionalRealm,
            );
            if ("Err" in response) {
                showPopUp("error", response.Err);
                return null;
            }
            return Number(post.id);
        }
        const postId = await newPostCallback(text, blobs, extension, realm);
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

// Uploads each attached blob directly into the user's personal bucket and
// returns refs ready for add_post/edit_post. Returns null (and shows the popup)
// if the user has no bucket configured.
const uploadBlobsOrFail = async (
    blobs: [string, Uint8Array][],
): Promise<[string, number, number][] | null> => {
    if (blobs.length === 0) return [];
    const bucketText = window.user?.bucket;
    if (!bucketText) {
        showPopUp(
            "error",
            "No personal media bucket configured. Set one up under Settings → STORAGE.",
            7,
        );
        return null;
    }
    const bucket = Principal.fromText(bucketText);
    const refs: [string, number, number][] = [];
    for (const [id, blob] of blobs) {
        const offset = await window.api.bucket_write(bucket, blob);
        refs.push([id, Number(offset), blob.length]);
    }
    return refs;
};

export const newPostCallback = async (
    text: string,
    blobs: [string, Uint8Array][],
    extension: Extension | undefined,
    realm: string | undefined,
) => {
    const optionalRealm = realm ? [realm] : [];
    const refs = await uploadBlobsOrFail(blobs);
    if (refs === null) return null;
    const result: any = await window.api.add_post(
        text,
        refs,
        [],
        optionalRealm,
        encodeExtension(extension),
    );
    if (!result) {
        showPopUp("error", "Call failed");
        return null;
    } else if ("Err" in result) {
        showPopUp("error", result.Err);
        return null;
    }
    return Number(result.Ok);
};
