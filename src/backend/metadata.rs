use crate::env::config::CONFIG;

pub fn set_index_metadata(domain: &str, body: &[u8]) -> Vec<u8> {
    set_metadata(
        body,
        domain,
        "",
        CONFIG.name,
        "The first FULLY decentralized social network powered by the Internet Computer.",
        "website",
    )
}

fn truncate(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        None => s.to_string(),
        Some((idx, _)) => {
            let mut truncated_string = s[..idx - 3].to_string();
            truncated_string.push_str("...");
            truncated_string
        }
    }
}

pub fn set_metadata(
    body: &[u8],
    host: &str,
    path: &str,
    title: &str,
    desc: &str,
    page_type: &str,
) -> Vec<u8> {
    let desc = truncate(desc, 160).replace('\n', " ");

    let metadata = format!(
        r#"<meta content="https://{0}/#/{1}" property="og:url" />
            <link href="https://{0}/#/{1}" rel="canonical" />
            <title>{2}</title>
            <meta content="{3}" name="description" />
            <meta content="{2}" property="og:title" />
            <meta content="{3}" property="og:description" />
            <meta content="{2}" property="twitter:title" />
            <meta content="{3}" property="twitter:description" />
            <meta content="{4}" property="og:type" />"#,
        host, path, title, desc, page_type
    )
    .replace('\n', "");

    String::from_utf8_lossy(body)
        // We have to remove the space before the last "/" so that the test passes on the minimized version.
        .replace(r#"<meta name="mark" content="OG"/>"#, &metadata)
        .as_bytes()
        .to_vec()
}
