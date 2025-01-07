import { MAINNET_MODE } from "./env";

export function bucket_image_url(
    bucket_id: string,
    offset: number,
    len: number,
) {
    // Fall back to the mainnet if the local config doesn't contain the bucket.
    let fallback_to_mainnet = !window.backendCache.stats?.buckets?.find(
        ([id, _y]) => id == bucket_id,
    );
    let host =
        MAINNET_MODE || fallback_to_mainnet
            ? `https://${bucket_id}.raw.icp0.io`
            : `http://127.0.0.1:8080`;
    return (
        `${host}/image?offset=${offset}&len=${len}` +
        (MAINNET_MODE ? "" : `&canisterId=${bucket_id}`)
    );
}
