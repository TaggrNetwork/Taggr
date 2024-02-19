pub struct UrlParts<'a> {
    pub path: &'a str,
    pub args: &'a str,
}

/// Parses a URL that IC passes to `http_request` in the format defined
/// by https://internetcomputer.org/docs/current/references/http-gateway-protocol-spec.
/// Note that the protocol and host parts of the URL have already been stripped.
pub fn parse(url: &str) -> UrlParts {
    if !url.starts_with('/') {
        return UrlParts { path: "", args: "" };
    }
    let (path, args) = match url.split_once('?') {
        Some((path, args)) => (path, args),
        None => (url, ""),
    };
    UrlParts { path, args }
}

/// Finds an argument with the given prefix and returns its value.
/// Caution: it assumes simple URLs served by the bucket canister
/// where argument values are integers and do not contain `&`.
/// The prefix should be given with `=`: `offset=`.
pub fn find_arg_value<'a>(args: &'a str, arg: &'a str) -> Option<&'a str> {
    args.split('&').find_map(|part| part.strip_prefix(arg))
}

#[cfg(test)]
mod tests {
    use crate::url::{find_arg_value, parse};

    #[test]
    fn test_parse_valid() {
        let url = parse("/test1/test2?v1=1&v2=2");
        assert_eq!(url.path, "/test1/test2");
        assert_eq!(url.args, "v1=1&v2=2");
    }

    #[test]
    fn test_parse_invalid() {
        let url = parse("http://abc-efg.ic0.app:8080/test1/test2?v1=1&v2=2");
        assert_eq!(url.path, "");
        assert_eq!(url.args, "");
        let url = parse("abc-efg.ic0.app:8080/test1/test2?v1=1&v2=2");
        assert_eq!(url.path, "");
        assert_eq!(url.args, "");
    }

    #[test]
    fn test_parse_empty() {
        let url = parse("");
        assert_eq!(url.path, "");
        assert_eq!(url.args, "");
        let url = parse("/");
        assert_eq!(url.path, "/");
        assert_eq!(url.args, "");
    }

    #[test]
    fn test_find_arg_value() {
        assert_eq!(
            Some("1000"),
            find_arg_value("offset=1000&len=2000", "offset=")
        );
        assert_eq!(Some("2000"), find_arg_value("offset=1000&len=2000", "len="));
        assert_eq!(Some(""), find_arg_value("offset=1000&len=", "len="));
        assert_eq!(None, find_arg_value("offset=1000&len=2000", "other="));
    }
}
