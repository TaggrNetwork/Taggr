use crate::{
    config::CONFIG,
    env::post::{self, Post},
    time,
};
use candid::Principal;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use super::{
    post::PostId,
    user::{UserFilter, UserId},
    Credits, State, Time,
};

pub type RealmId = String;

pub fn validate_realm_id(realm_id: &str) -> Result<(), String> {
    if realm_id.len() > CONFIG.max_realm_name {
        return Err(format!("realm name too long: {realm_id}"));
    }

    if realm_id
        .chars()
        .any(|c| !char::is_alphanumeric(c) && c != '_' && c != '-')
    {
        return Err(format!(
            "realm name should be an alpha-numeric string: {realm_id}"
        ));
    }

    if realm_id.chars().all(|c| char::is_ascii_digit(&c)) {
        return Err(format!(
            "realm name should have at least one character: {realm_id}"
        ));
    }

    Ok(())
}

#[derive(Default, Serialize, Deserialize)]
pub struct Realm {
    pub cleanup_penalty: Credits,
    pub controllers: BTreeSet<UserId>,
    pub description: String,
    pub filter: UserFilter,
    pub label_color: String,
    pub last_setting_update: u64,
    pub last_update: u64,
    pub logo: String,
    #[serde(default)]
    pub max_downvotes: u32,
    pub num_members: u64,
    pub num_posts: usize,
    pub revenue: Credits,
    pub theme: String,
    pub whitelist: BTreeSet<UserId>,
    pub created: Time,
    // Root posts assigned to the realm
    pub posts: Vec<PostId>,
    pub adult_content: bool,
    pub comments_filtering: bool,
    /// Tokens allowed to appear in realm like tips
    pub tokens: Option<BTreeSet<Principal>>,
}

impl Realm {
    pub fn new(description: String) -> Self {
        Self {
            description,
            label_color: "#000000".into(),
            max_downvotes: CONFIG.default_max_downvotes,
            ..Default::default()
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.logo.len() > CONFIG.max_realm_logo_len {
            return Err("logo too big".into());
        }

        if self.label_color.len() > 10 {
            return Err("label color invalid".into());
        }

        if self.description.len() > 2000 {
            return Err("description too long".into());
        }

        if self.theme.len() > 400 {
            return Err("theme invalid".into());
        }

        if self.whitelist.len() > 100 {
            return Err("whitelist too long".into());
        }

        Ok(())
    }
}

pub fn create_realm(
    state: &mut State,
    principal: Principal,
    realm_id: RealmId,
    mut realm: Realm,
) -> Result<(), String> {
    realm.validate()?;

    let Realm {
        controllers,
        cleanup_penalty,
        ..
    } = &realm;
    if controllers.is_empty() {
        return Err("no controllers specified".into());
    }

    validate_realm_id(&realm_id)?;

    if CONFIG.name.to_lowercase() == realm_id.to_lowercase() || state.realms.contains_key(&realm_id)
    {
        return Err("realm name taken".into());
    }

    let user_id = state
        .principal_to_user(principal)
        .ok_or("user not found")?
        .id;

    state.charge(
        user_id,
        CONFIG.realm_cost,
        format!("new realm /{}", realm_id),
    )?;

    let user = state
        .principal_to_user_mut(principal)
        .ok_or("user not found")?;
    user.controlled_realms.insert(realm_id.clone());
    let user_name = user.name.clone();

    realm.cleanup_penalty = CONFIG.max_realm_cleanup_penalty.min(*cleanup_penalty);
    realm.last_update = time();
    realm.created = time();
    if realm.label_color.is_empty() {
        realm.label_color = "#000000".into();
    }

    state.realms.insert(realm_id.clone(), realm);

    let _ = state.system_message(
        format!(
            "Realm [{}](/#/realm/{0}) was created by `@{}`",
            realm_id, user_name
        ),
        CONFIG.dao_realm.into(),
    );

    Ok(())
}

pub fn clean_up_realm(
    state: &mut State,
    principal: Principal,
    post_id: PostId,
    reason: String,
) -> Result<(), String> {
    if reason.len() > CONFIG.max_report_length {
        return Err("reason too long".into());
    }

    let controller = state
        .principal_to_user(principal)
        .ok_or("user not found")?
        .id;
    let post = Post::get(state, &post_id).ok_or("no post found")?;
    if post.parent.is_some() {
        return Err("only root posts can be moved out of realms".into());
    }
    let realm_id = post.realm.as_ref().cloned().ok_or("no realm id found")?;
    let realm = state.realms.get(&realm_id).ok_or("no realm found")?;

    let post_update_cleanup = post.creation_timestamp() >= realm.last_setting_update;

    let post_user = post.user;
    if !realm.controllers.contains(&controller) {
        return Err("only realm controller can clean up".into());
    }
    let user = state.users.get_mut(&post_user).ok_or("user not found")?;
    let user_principal = user.principal;
    let realm_member = user.realms.contains(&realm_id);
    let msg = format!(
        "post [{0}](#/post/{0}) was moved out of realm /{1}: {2}",
        post_id, realm_id, reason
    );

    // If post removal happens for a post created after last realm updates, user is allowed to
    // be penalized.
    if post_update_cleanup {
        user.change_rewards(-(realm.cleanup_penalty as i64), &msg);
        let user_id = user.id;
        let penalty = realm.cleanup_penalty.min(user.credits());
        // if user has no credits left, ignore the error
        let _ = state.charge(user_id, penalty, msg);
    }

    post::change_realm(state, post_id, None);
    let realm = state.realms.get_mut(&realm_id).expect("no realm found");
    realm.posts.retain(|id| id != &post_id);
    if realm_member {
        state.toggle_realm_membership(user_principal, realm_id);
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {

    use crate::{
        env::{
            tests::{create_user, create_user_with_params, pr},
            user::CreditsDelta,
            WEEK,
        },
        mutate, read, time,
    };

    use super::*;

    pub fn create_realm(state: &mut State, user: Principal, name: String) -> Result<(), String> {
        let realm = Realm {
            description: "Test description".into(),
            controllers: vec![0].into_iter().collect(),
            ..Default::default()
        };
        super::create_realm(state, user, name, realm)
    }

    fn realm_posts(state: &State, name: &str) -> Vec<PostId> {
        state
            .last_posts("localhost".into(), None, 0, 0, true)
            .filter(|post| post.realm.as_ref() == Some(&name.to_string()))
            .map(|post| post.id)
            .collect::<Vec<_>>()
    }

    #[test]
    fn test_realm_whitelist() {
        mutate(|state| {
            create_user(state, pr(0));
            create_user(state, pr(1));
            create_user(state, pr(2));
            let test_realm = Realm {
                whitelist: vec![1].into_iter().collect(),
                ..Default::default()
            };
            state.realms.insert("TEST".into(), test_realm);

            // Joining of public realms should always work
            for i in 0..2 {
                state
                    .principal_to_user_mut(pr(i))
                    .unwrap()
                    .realms
                    .push("TEST".into());
            }

            // This should fail, because white list is set
            for (i, result) in &[
                (
                    0,
                    Err("TEST realm is gated and you are not allowed to post to this realm".into()),
                ),
                (1, Ok(0)),
            ] {
                assert_eq!(
                    &Post::create(
                        state,
                        "test".to_string(),
                        &[],
                        pr(*i),
                        WEEK,
                        None,
                        Some("TEST".into()),
                        None,
                    ),
                    result
                );
            }
        })
    }

    #[test]
    fn test_realm_revenue() {
        mutate(|state| {
            create_user(state, pr(0));
            create_user(state, pr(1));
            create_user(state, pr(2));
            let test_realm = Realm {
                controllers: [0, 1, 2].iter().copied().collect(),
                ..Default::default()
            };
            for i in 0..=2 {
                let user = state.principal_to_user_mut(pr(i)).unwrap();
                user.realms.push("TEST".into());
                user.change_credits(10000, CreditsDelta::Plus, "").unwrap();
            }
            state.realms.insert("TEST".into(), test_realm);
            for i in 0..100 {
                let post_id = Post::create(
                    state,
                    "test".to_string(),
                    &[],
                    pr(i % 2),
                    WEEK,
                    None,
                    Some("TEST".into()),
                    None,
                )
                .unwrap();
                assert!(state.react(pr((i + 1) % 2), post_id, 100, WEEK).is_ok());
            }

            assert_eq!(state.realms.values().next().unwrap().revenue, 200);
            assert_eq!(state.principal_to_user(pr(0)).unwrap().rewards(), 500);
            assert_eq!(state.principal_to_user(pr(1)).unwrap().rewards(), 500);
            assert_eq!(state.principal_to_user(pr(2)).unwrap().rewards(), 0);
            assert_eq!(state.burned_cycles, 300);
            state.distribute_realm_revenue(WEEK + WEEK / 2);
            assert_eq!(state.realms.values().next().unwrap().revenue, 0);
            let expected_revenue = (200 / 100 * CONFIG.realm_revenue_percentage / 2) as i64;
            assert_eq!(state.burned_cycles, 300 - 2 * expected_revenue);
            assert_eq!(
                state.principal_to_user(pr(0)).unwrap().rewards(),
                500 + expected_revenue
            );
            assert_eq!(
                state.principal_to_user(pr(1)).unwrap().rewards(),
                500 + expected_revenue
            );
            assert_eq!(state.principal_to_user(pr(2)).unwrap().rewards(), 0);
        })
    }

    #[test]
    fn test_realm_change() {
        mutate(|state| {
            state.init();

            state.realms.insert("TEST".into(), Realm::default());
            state.realms.insert("TEST2".into(), Realm::default());

            create_user(state, pr(0));
            assert!(state.toggle_realm_membership(pr(0), "TEST".into()));
            assert_eq!(
                state
                    .users
                    .values()
                    .filter(|user| user.realms.contains(&"TEST".to_string()))
                    .count(),
                1
            );

            let post_id = Post::create(
                state,
                "Root".to_string(),
                &[],
                pr(0),
                0,
                None,
                Some("TEST".into()),
                None,
            )
            .unwrap();

            let comment_1_id = Post::create(
                state,
                "Comment 1".to_string(),
                &[],
                pr(0),
                0,
                Some(post_id),
                Some("TEST".into()),
                None,
            )
            .unwrap();

            Post::create(
                state,
                "Comment 2".to_string(),
                &[],
                pr(0),
                0,
                Some(comment_1_id),
                Some("TEST".into()),
                None,
            )
            .unwrap();

            assert_eq!(realm_posts(state, "TEST").len(), 3);
            assert_eq!(realm_posts(state, "TEST2").len(), 0);

            crate::post::change_realm(state, post_id, Some("TEST2".into()));

            assert_eq!(realm_posts(state, "TEST").len(), 0);
            assert_eq!(realm_posts(state, "TEST2").len(), 3);
        });
    }

    #[actix_rt::test]
    async fn test_realms() {
        let (p1, realm_name, new_realm_post_id) = mutate(|state| {
            state.init();

            let p0 = pr(0);
            let p1 = pr(1);
            let _u0 = create_user_with_params(state, p0, "user1", 1000);
            let _u1 = create_user_with_params(state, p1, "user2", 1000);

            let user1 = state.users.get_mut(&_u1).unwrap();
            assert_eq!(user1.credits(), 1000);
            user1.change_credits(500, CreditsDelta::Minus, "").unwrap();
            assert_eq!(user1.credits(), 500);

            let name = "TAGGRDAO".to_string();
            let controllers: BTreeSet<_> = vec![_u0].into_iter().collect();

            // simple creation and description change edge cases
            assert_eq!(
                create_realm(state, pr(2), name.clone(),),
                Err("user not found".to_string())
            );

            assert_eq!(
                create_realm(state, p1, name.clone(),),
                Err("not enough credits (required: 1000)".to_string())
            );

            assert_eq!(
                create_realm(
                    state,
                    p0,
                    "THIS_NAME_IS_IMPOSSIBLY_LONG_AND_WILL_NOT_WORK".to_string()
                ),
                Err("realm name too long: THIS_NAME_IS_IMPOSSIBLY_LONG_AND_WILL_NOT_WORK".into())
            );

            assert_eq!(
                super::create_realm(state, p0, name.clone(), Realm::default()),
                Err("no controllers specified".to_string())
            );

            assert_eq!(
                create_realm(state, p0, "TEST NAME".to_string(),),
                Err("realm name should be an alpha-numeric string: TEST NAME".into())
            );

            assert_eq!(create_realm(state, p0, name.clone(),), Ok(()));

            assert!(state
                .principal_to_user(p0)
                .unwrap()
                .controlled_realms
                .contains(&name));

            let user0 = state.users.get_mut(&_u0).unwrap();
            user0.change_credits(1000, CreditsDelta::Plus, "").unwrap();

            assert_eq!(
                create_realm(state, p0, name.clone(),),
                Err("realm name taken".to_string())
            );

            assert_eq!(
                state.realms.get(&name).unwrap().description,
                "Test description".to_string()
            );

            let new_description = "New test description".to_string();

            assert_eq!(
                state.edit_realm(p0, name.clone(), Realm::default()),
                Err("no controllers specified".to_string())
            );

            assert_eq!(
                state.edit_realm(pr(2), name.clone(), Realm::default()),
                Err("user not found".to_string())
            );

            assert_eq!(
                state.edit_realm(p0, "WRONGNAME".to_string(), Realm::default()),
                Err("no realm found".to_string())
            );

            assert_eq!(
                state.edit_realm(p1, name.clone(), Realm::default()),
                Err("not authorized".to_string())
            );

            let mut tokens = BTreeSet::new();
            tokens.insert(pr(99));
            let realm = Realm {
                controllers,
                description: "New test description".into(),
                tokens: Some(tokens.clone()),
                ..Default::default()
            };
            assert_eq!(state.edit_realm(p0, name.clone(), realm), Ok(()));

            assert_eq!(
                state.realms.get(&name).unwrap().tokens,
                Some(tokens.clone()),
            );

            assert_eq!(
                state.realms.get(&name).unwrap().description,
                new_description
            );

            // wrong user and wrong realm joining
            assert!(!state.toggle_realm_membership(pr(2), name.clone()));
            assert!(!state.toggle_realm_membership(p1, "WRONGNAME".to_string()));

            assert!(state.toggle_realm_membership(p1, name.clone()));
            assert!(state.users.get(&_u1).unwrap().realms.contains(&name));
            assert_eq!(state.realms.get(&name).unwrap().num_members, 1);

            // creating a post in a realm
            let realm_post_id = Post::create(
                state,
                "Realm post".to_string(),
                &[],
                p1,
                0,
                None,
                Some(name.clone()),
                None,
            )
            .unwrap();
            assert_eq!(state.realms.get(&name).unwrap().posts.len(), 1);

            assert_eq!(
                Post::get(state, &realm_post_id).unwrap().realm,
                Some(name.clone())
            );
            assert!(realm_posts(state, &name).contains(&realm_post_id));

            // Posting without realm creates the post in the global realm
            let no_realm_post_id = Post::create(
                state,
                "Realm post".to_string(),
                &[],
                p1,
                0,
                None,
                None,
                None,
            )
            .unwrap();

            assert_eq!(Post::get(state, &no_realm_post_id).unwrap().realm, None,);

            // comments are possible even if user is not in the realm
            let _comment_id_1 = Post::create(
                state,
                "comment".to_string(),
                &[],
                p0,
                0,
                Some(realm_post_id),
                None,
                None,
            )
            .unwrap();

            assert!(state.toggle_realm_membership(p0, name.clone()));
            assert_eq!(state.realms.get(&name).unwrap().num_members, 2);

            let _comment_id_2 = Post::create(
                state,
                "comment".to_string(),
                &[],
                p0,
                0,
                Some(realm_post_id),
                None,
                None,
            )
            .unwrap();

            assert!(realm_posts(state, &name).contains(&realm_post_id));

            // Create post without a realm

            let no_realm_post_id_2 = Post::create(
                state,
                "No realm post".to_string(),
                &[],
                p1,
                0,
                None,
                None,
                None,
            )
            .unwrap();
            let comment_on_no_realm = Post::create(
                state,
                "comment".to_string(),
                &[],
                p0,
                0,
                Some(no_realm_post_id_2),
                None,
                None,
            )
            .unwrap();

            assert_eq!(Post::get(state, &comment_on_no_realm).unwrap().realm, None);

            // Creating post without entering the realm
            let realm_name = "NEW_REALM".to_string();
            assert_eq!(
                Post::create(
                    state,
                    "test".to_string(),
                    &[],
                    p0,
                    0,
                    None,
                    Some(realm_name.clone()),
                    None
                ),
                Err(format!("not a member of the realm {}", realm_name))
            );

            // create a new realm
            let user0 = state.users.get_mut(&_u0).unwrap();
            user0.change_credits(1000, CreditsDelta::Plus, "").unwrap();
            assert_eq!(create_realm(state, p0, realm_name.clone(),), Ok(()));

            // we still can't post into it, because we didn't join
            assert_eq!(
                Post::create(
                    state,
                    "test".to_string(),
                    &[],
                    p0,
                    0,
                    None,
                    Some(realm_name.clone()),
                    None
                ),
                Err(format!("not a member of the realm {}", realm_name))
            );

            // join the realm and create the post without entering
            assert!(state.toggle_realm_membership(p1, realm_name.clone()));
            assert!(state.users.get(&_u1).unwrap().realms.contains(&name));

            assert_eq!(state.realms.get(&realm_name).unwrap().num_members, 1);
            assert_eq!(state.realms.get(&realm_name).unwrap().posts.len(), 0);

            let new_realm_post_id = Post::create(
                state,
                "test".to_string(),
                &[],
                p1,
                0,
                None,
                Some(realm_name.clone()),
                None,
            )
            .unwrap();
            assert_eq!(state.realms.get(&realm_name).unwrap().posts.len(), 1);

            assert!(state
                .users
                .get(&_u1)
                .unwrap()
                .realms
                .contains(&"TAGGRDAO".to_string()));
            (p1, realm_name, new_realm_post_id)
        });

        // Move the post to non-joined realm
        assert_eq!(
            Post::edit(
                new_realm_post_id,
                "changed".to_string(),
                vec![],
                "".to_string(),
                Some("TAGGRDAO_X".to_string()),
                p1,
                time(),
            )
            .await,
            Err("you're not in the realm".into()),
        );

        read(|state| {
            assert_eq!(
                Post::get(state, &new_realm_post_id).unwrap().realm,
                Some(realm_name.clone())
            );
            assert_eq!(state.realms.get("TAGGRDAO").unwrap().posts.len(), 1);
        });
        assert_eq!(
            Post::edit(
                new_realm_post_id,
                "changed".to_string(),
                vec![],
                "".to_string(),
                Some("TAGGRDAO".to_string()),
                p1,
                time(),
            )
            .await,
            Ok(())
        );

        read(|state| {
            assert_eq!(state.realms.get("NEW_REALM").unwrap().posts.len(), 0);
            assert_eq!(state.realms.get("TAGGRDAO").unwrap().posts.len(), 2);
            assert_eq!(
                Post::get(state, &new_realm_post_id).unwrap().realm,
                Some("TAGGRDAO".to_string())
            );
        });
    }
}
