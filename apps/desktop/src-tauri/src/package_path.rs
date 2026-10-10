//! Shared portable Web Package path validation; extracted without behavior changes.
pub fn is_valid_package_path(path: &str) -> bool {
    let length = path.encode_utf16().count();
    if length == 0 || length > 512 || path.starts_with('/') {
        return false;
    }
    if path.chars().any(|c| {
        matches!(
            c,
            '\u{0}'..='\u{1f}' | '\u{7f}' | '<' | '>' | ':' | '"' | '|' | '?' | '*' | '%' | '\\'
        )
    }) {
        return false;
    }
    for segment in path.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || is_reserved_file_stem(segment)
        {
            return false;
        }
    }
    true
}

/// `con|prn|aux|nul|com[1-9]|lpt[1-9]`（可带扩展名），大小写不敏感。
fn is_reserved_file_stem(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or_default();
    let lower = stem.to_ascii_lowercase();
    matches!(lower.as_str(), "con" | "prn" | "aux" | "nul")
        || (lower.len() == 4
            && (lower.starts_with("com") || lower.starts_with("lpt"))
            && lower.as_bytes()[3].is_ascii_digit()
            && lower.as_bytes()[3] != b'0')
}
