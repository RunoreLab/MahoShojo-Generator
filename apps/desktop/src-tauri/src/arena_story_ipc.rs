//! Small raw-frame metadata parser shared by real command handlers and native tests.
//! Body bytes never pass through JSON, SQL, a path, or a caller-selected table.
use super::{PartKind, StoryError, MAX_SAFE_INTEGER};
pub const TOKEN_HEADER: &str = "x-story-token";
pub const PART_HEADER: &str = "x-story-part";
pub const OFFSET_HEADER: &str = "x-story-offset";
pub fn token(value: Option<&str>) -> Result<&str, StoryError> {
    let value = value.ok_or(StoryError::Invalid)?;
    if value.len() != 65
        || value.as_bytes()[32] != b'-'
        || !value.bytes().enumerate().all(|(index, byte)| {
            index == 32 || byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
        })
    {
        return Err(StoryError::Invalid);
    }
    Ok(value)
}
pub fn offset(value: Option<&str>) -> Result<u64, StoryError> {
    let value = value.ok_or(StoryError::Invalid)?;
    if value.is_empty()
        || value.len() > 16
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(StoryError::Invalid);
    }
    let parsed = value.parse::<u64>().map_err(|_| StoryError::Invalid)?;
    if parsed > MAX_SAFE_INTEGER {
        return Err(StoryError::Invalid);
    }
    Ok(parsed)
}
pub fn part(value: Option<&str>) -> Result<PartKind, StoryError> {
    match value {
        Some("session") => Ok(PartKind::Session),
        Some("seed") => Ok(PartKind::Seed),
        Some("chapter") => Ok(PartKind::Chapter),
        Some("checkpoint0") => Ok(PartKind::Checkpoint0),
        Some("checkpoint1") => Ok(PartKind::Checkpoint1),
        _ => Err(StoryError::Invalid),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_metadata_is_fixed_and_canonical() {
        let good = format!("{}-{}", "a".repeat(32), "0".repeat(32));
        assert_eq!(token(Some(&good)), Ok(good.as_str()));
        for bad in ["", "../a", "SESSION", "a\r\nb"] {
            assert!(token(Some(bad)).is_err());
        }
        for bad in ["", "01", "+1", "-1", "1.0", "1e2", "9007199254740992", " 1"] {
            assert!(offset(Some(bad)).is_err());
        }
        assert_eq!(offset(Some("9007199254740991")), Ok(MAX_SAFE_INTEGER));
        assert_eq!(offset(Some("0")), Ok(0));
        assert_eq!(part(Some("checkpoint1")), Ok(PartKind::Checkpoint1));
        for bad in ["arena_story_chapter", "checkpoint", "../seed", "Chapter"] {
            assert!(part(Some(bad)).is_err());
        }
    }
}
