use super::add_asset;

pub fn load() {
    add_asset(
        &["/188.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/188.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/291.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/291.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/293.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/293.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/316.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/316.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/466.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/466.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/514.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/514.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/849.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/849.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/889.chunk.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/889.chunk.js.gz").to_vec(),
    );
    add_asset(
        &["/index.js"],
        vec![
            ("Content-Type".to_string(), "text/javascript".to_string()),
            ("Content-Encoding".to_string(), "gzip".to_string()),
        ],
        include_bytes!("../../../dist/frontend/index.js.gz").to_vec(),
    );
}
