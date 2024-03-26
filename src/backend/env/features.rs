use candid::Principal;
use serde::{Deserialize, Serialize};

use crate::mutate;

use super::{
    config::CONFIG,
    post::{Extension, Post, PostId},
    token::Token,
    user::UserId,
    State,
};

#[derive(Default, Serialize, Deserialize)]
pub struct Feature {
    // Users who voted for increased priority
    pub supporters: Vec<UserId>,
    // 0: requested, 1: implemented
    pub status: u8,
}

/// Returns a list of all feature ids and current collective voting power of all supporters.
pub fn list_features(state: &State) -> Box<dyn DoubleEndedIterator<Item = (PostId, Token)> + '_> {
    Box::new(state.memory.features.iter().map(move |(post_id, feature)| {
        (
            post_id,
            feature
                .supporters
                .iter()
                .map(|user_id| {
                    state
                        .users
                        .get(&user_id)
                        .map(|user| user.total_balance())
                        .unwrap_or_default()
                })
                .sum::<Token>(),
        )
    }))
}

pub fn support_feature(caller: Principal, post_id: PostId) -> Result<(), String> {
    mutate(|state| {
        let user_id = state.principal_to_user(caller).ok_or("no user found")?.id;
        let mut feature = state.memory.features.remove(&post_id)?;
        feature.supporters.push(user_id);
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
        state.charge(
            user.id,
            CONFIG.feature_cost,
            format!("creation of a [new feature](#/post/{})", post_id),
        )?;

        Post::mutate(state, &post_id, |post| {
            post.extension = Some(Extension::Feature);
            Ok(())
        })?;

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
            "@{} created a [new feature](#/post/{}",
            user_name, post_id
        ));

        Ok(())
    })
}
