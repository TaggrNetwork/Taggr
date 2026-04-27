use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::{user::UserId, Time};

// Retained only so the `Memory::features` index can still be deserialized.
// The next release drops the field; serde silently ignores it once the migration
// has drained the index.
#[derive(Default, Serialize, Deserialize)]
pub struct Feature {
    pub supporters: HashSet<UserId>,
    pub status: u8,
    #[serde(default)]
    pub last_activity: Time,
}
