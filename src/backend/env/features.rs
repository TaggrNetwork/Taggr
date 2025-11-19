use std::collections::HashSet;

use candid::Principal;
use serde::{Deserialize, Serialize};

use crate::{
    env::{post::Meta, Time, YEAR},
    mutate,
};

use super::{
    config::CONFIG,
    post::{Extension, Post, PostId},
    token::Token,
    user::UserId,
    State,
};

const STATUS_IMPLEMENTED: u8 = 1;
const STATUS_OPEN: u8 = 0;

#[derive(Default, Serialize, Deserialize)]
pub struct Feature {
    // Users who voted for increased priority
    pub supporters: HashSet<UserId>,
    // 0: requested, 1: implemented
    pub status: u8,
    #[serde(default)]
    pub last_activity: Time,
}

/// Returns a list of all feature ids and current collective voting power of all supporters.
pub fn features<'a>(
    state: &'a State,
    ids: &'a [PostId],
    now: Time,
) -> Box<dyn DoubleEndedIterator<Item = ((&'a Post, Meta<'a>), Token, Feature)> + 'a> {
    let transform_feature = move |(post_id, feature): (&PostId, Feature)| {
        if feature.status == STATUS_OPEN && feature.last_activity + YEAR <= now {
            return None;
        }
        let tokens = feature
            .supporters
            .iter()
            .map(|user_id| {
                state
                    .users
                    .get(user_id)
                    .map(|user| user.total_balance())
                    .unwrap_or_default()
            })
            .sum::<Token>();
        Post::get(state, post_id).map(|post| (post.with_meta(state), tokens, feature))
    };

    if !ids.is_empty() {
        return Box::new(
            ids.iter()
                .filter_map(move |id| state.memory.features.get(id).map(|feature| (id, feature)))
                .filter_map(transform_feature),
        );
    }
    Box::new(state.memory.features.iter().filter_map(transform_feature))
}

pub fn toggle_feature_support(caller: Principal, post_id: PostId, now: Time) -> Result<(), String> {
    mutate(|state| {
        let user_id = state.principal_to_user(caller).ok_or("no user found")?.id;
        let mut feature = state.memory.features.remove(&post_id)?;
        if feature.supporters.contains(&user_id) {
            feature.supporters.remove(&user_id);
        } else {
            feature.last_activity = now;
            feature.supporters.insert(user_id);
        }
        state
            .memory
            .features
            .insert(post_id, feature)
            .expect("couldn't re-insert feature");

        Ok(())
    })
}

pub fn create_feature(caller: Principal, post_id: PostId, now: Time) -> Result<(), String> {
    mutate(|state| {
        let user = state.principal_to_user(caller).ok_or("no user found")?;
        let user_name = user.name.clone();

        let post = Post::get(state, &post_id).ok_or("post not found")?;
        if post.user != user.id || !matches!(post.extension.as_ref(), Some(&Extension::Feature)) {
            return Err("no post with a feature found".into());
        }

        if state.memory.features.get(&post_id).is_some() {
            return Err("feature already exists".into());
        }

        state
            .memory
            .features
            .insert(
                post_id,
                Feature {
                    supporters: Default::default(),
                    status: STATUS_OPEN,
                    last_activity: now,
                },
            )
            .expect("couldn't persist feature");

        let _ = state.system_message(
            format!(
                "A [new feature](#/post/{}) was created by `@{}`",
                post_id, user_name
            ),
            CONFIG.dao_realm.into(),
        );

        Ok(())
    })
}

pub fn close_feature(state: &mut State, post_id: PostId) -> Result<(), String> {
    let mut feature = state.memory.features.remove(&post_id)?;
    feature.status = STATUS_IMPLEMENTED;
    state
        .memory
        .features
        .insert(post_id, feature)
        .expect("couldn't re-insert feature");
    Ok(())
}
