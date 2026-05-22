// Post-migration loop: pull each post off the server-side index, fetch its
// images from their old buckets via HTTP, rewrite them into the user's own
// bucket, and ask taggr to swap the file refs. Progress is always derived
// from server state, so a refresh just resumes.

import { Principal } from "@dfinity/principal";
import { Post, PostId } from "./types";

const fetchBucketImage = async (
    bucket: string,
    offset: number,
    len: number,
): Promise<Uint8Array> => {
    const url = `https://${bucket}.raw.icp0.io/image?offset=${offset}&len=${len}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
};

const writeToBucket = async (
    bucket: Principal,
    bytes: Uint8Array,
): Promise<bigint> => {
    // Bucket `write` takes raw bytes and replies with the 8-byte big-endian
    // offset where the blob was stored.
    const buf = await window.api.call_raw(
        bucket,
        "write",
        bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
    );
    if (!buf || buf.byteLength < 8) {
        throw new Error("bucket.write: short reply");
    }
    return new DataView(buf).getBigUint64(0, false);
};

const migratePost = async (
    postId: PostId,
    entries: [string, number, number][],
): Promise<void> => {
    const response: any = await window.api.call(
        "migrate_post",
        postId,
        entries,
    );
    if (response && "Err" in response) throw new Error(response.Err);
};

export const loadPendingPostIds = async (): Promise<PostId[]> => {
    const ids = await window.api.query<PostId[]>("user_post_index");
    return ids || [];
};

export const runMigration = async (
    bucket: Principal,
    postIds: PostId[],
    onProgress: (done: number, total: number) => void,
    shouldStop: () => boolean,
): Promise<void> => {
    const bucketStr = bucket.toString();
    const total = postIds.length;
    for (let i = 0; i < total; i++) {
        if (shouldStop()) return;
        const postId = postIds[i];
        const posts = await window.api.query<[Post, unknown][]>("posts", [
            postId,
        ]);
        if (!posts || posts.length === 0) {
            onProgress(i + 1, total);
            continue;
        }
        const post = posts[0][0];
        const filesToMigrate = Object.entries(post.files).filter(
            ([key]) => !key.endsWith(`@${bucketStr}`),
        ) as [string, [number, number]][];
        if (filesToMigrate.length === 0) {
            onProgress(i + 1, total);
            continue;
        }
        const entries: [string, number, number][] = [];
        for (const [key, [offset, len]] of filesToMigrate) {
            const oldBucket = key.split("@")[1];
            const bytes = await fetchBucketImage(oldBucket, offset, len);
            const newOffset = await writeToBucket(bucket, bytes);
            entries.push([key, Number(newOffset), len]);
        }
        await migratePost(postId, entries);
        onProgress(i + 1, total);
    }
};
