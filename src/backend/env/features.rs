use std::collections::HashSet;

use candid::Principal;
use serde::{Deserialize, Serialize};

use crate::mutate;

use super::{
    post::{Extension, Post, PostId},
    token::Token,
    user::UserId,
    State,
};

#[derive(Default, Serialize, Deserialize)]
pub struct Feature {
    // Users who voted for increased priority
    pub supporters: HashSet<UserId>,
    // 0: requested, 1: implemented
    pub status: u8,
}

/// Returns a list of all feature ids and current collective voting power of all supporters.
pub fn features(
    state: &State,
    ids: Vec<PostId>,
) -> Box<dyn DoubleEndedIterator<Item = (PostId, Token, Feature)> + '_> {
    let count_support = move |(post_id, feature): (PostId, Feature)| {
        (
            post_id,
            feature
                .supporters
                .iter()
                .map(|user_id| {
                    state
                        .users
                        .get(user_id)
                        .map(|user| user.total_balance())
                        .unwrap_or_default()
                })
                .sum::<Token>(),
            feature,
        )
    };
    if !ids.is_empty() {
        return Box::new(
            ids.into_iter()
                .filter_map(move |id| state.memory.features.get(&id).map(|feature| (id, feature)))
                .map(count_support),
        );
    }
    Box::new(state.memory.features.iter().map(count_support))
}

pub fn toggle_feature_support(caller: Principal, post_id: PostId) -> Result<(), String> {
    mutate(|state| {
        let user_id = state.principal_to_user(caller).ok_or("no user found")?.id;
        let mut feature = state.memory.features.remove(&post_id)?;
        if feature.supporters.contains(&user_id) {
            feature.supporters.remove(&user_id);
        } else {
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

pub fn create_feature(caller: Principal, post_id: PostId) -> Result<(), String> {
    mutate(|state| {
        let user = state.principal_to_user(caller).ok_or("no user found")?;
        let user_name = user.name.clone();

        if !Post::get(state, &post_id)
            .map(|post| {
                post.user == user.id && matches!(post.extension.as_ref(), Some(&Extension::Feature))
            })
            .unwrap_or_default()
        {
            return Err("no post with a feature found".into());
        };

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
                    status: 0,
                },
            )
            .expect("couldn't persist feature");

        state.logger.info(format!(
            "@{} created a [new feature](#/post/{})",
            user_name, post_id
        ));

        Ok(())
    })
}

pub fn close_feature(state: &mut State, post_id: PostId) -> Result<(), String> {
    let mut feature = state.memory.features.remove(&post_id)?;
    feature.status = 1;
    state
        .memory
        .features
        .insert(post_id, feature)
        .expect("couldn't re-insert feature");
    Ok(())
}
