use std::convert::TryInto;

use candid::{decode_one, encode_one, CandidType, Principal};
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;

use crate::{controller, setup};

// HTTP request and responst headers.
type Headers = Vec<(String, String)>;

#[derive(CandidType, Serialize)]
struct HttpRequest {
    url: String,
    headers: Headers,
}

#[derive(CandidType, Default, Deserialize)]
struct HttpResponse {
    status_code: u16,
    headers: Headers,
    body: ByteBuf,
    upgrade: Option<bool>,
}

#[test]
fn test_http_image() {
    let (pic, bucket) = setup("bucket");
    let result = pic.update_call(bucket, controller(), "write", "lorem".as_bytes().to_vec());

    let offset = match result {
        Ok(blob) => u64::from_be_bytes(blob.try_into().unwrap()),
        Err(err) => unreachable!("{}", err),
    };

    let request = HttpRequest {
        url: format!("/image?offset={}&len=5", offset),
        headers: vec![],
    };

    let result = pic.query_call(
        bucket,
        Principal::anonymous(),
        "http_request",
        encode_one(request).unwrap(),
    );

    let response: HttpResponse = match result {
        Ok(bytes) => decode_one(&bytes).unwrap(),
        Err(err) => unreachable!("{}", err),
    };

    assert_eq!(response.body, "lorem".as_bytes(),);

    assert_eq!(
        response.headers,
        vec![
            ("Content-Type".to_string(), "image/png".to_string()),
            (
                "Cache-Control".to_string(),
                "public, max-age=1000000".to_string()
            )
        ]
    );
}
