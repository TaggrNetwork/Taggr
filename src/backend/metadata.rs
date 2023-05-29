use crate::env::config::CONFIG;

pub fn set_index_metadata(body: &[u8]) -> Vec<u8> {
    let domain = CONFIG.domains.first().cloned().expect("no domains");

    set_metadata(
        body,
        domain,
        "",
        CONFIG.name,
        "The first FULLY decentralized social network powered by the Internet Computer.",
        "website",
    )
}

pub fn set_metadata(
    body: &[u8],
    host: &str,
    path: &str,
    title: &str,
    desc: &str,
    page_type: &str,
) -> Vec<u8> {
    String::from_utf8_lossy(body)
        .replace(
            r#"<meta name="mark" content="OG">"#,
            &format!(
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
            ),
        )
        .as_bytes()
        .to_vec()
}
