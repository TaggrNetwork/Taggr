use std::collections::HashSet;

use crate::assets;

use super::{
    config::CONFIG,
    post::Post,
    user::{CreditsDelta, UserId},
    RealmId, State,
};
use candid::Principal;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub enum DomainSubConfig {
    BlackListedRealms(HashSet<RealmId>),
    WhiteListedRealms(HashSet<RealmId>),
    Journal(UserId),
}

impl Default for DomainSubConfig {
    fn default() -> Self {
        DomainSubConfig::BlackListedRealms(Default::default())
    }
}

#[derive(Default, Clone, Deserialize, Serialize)]
pub struct DomainConfig {
    // If a domain config has no owner, it is managed by the DAO
    #[serde(default)]
    pub owner: Option<UserId>,
    // TODO: delete
    #[serde(default)]
    pub realm_whitelist: HashSet<RealmId>,
    // TODO: delete
    #[serde(default)]
    pub realm_blacklist: HashSet<RealmId>,

    #[serde(default)]
    pub sub_config: DomainSubConfig,
}

impl DomainConfig {
    pub fn realm_visible(&self, realm_id: &RealmId) -> bool {
        match &self.sub_config {
            DomainSubConfig::WhiteListedRealms(list) => list.contains(realm_id),
            DomainSubConfig::BlackListedRealms(list) => !list.contains(realm_id),
            _ => true,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        match &self.sub_config {
            DomainSubConfig::WhiteListedRealms(realms) if realms.is_empty() => {
                return Err("whitelist list empty".into());
            }
            DomainSubConfig::WhiteListedRealms(realms)
            | DomainSubConfig::BlackListedRealms(realms) => {
                let max_realm_number = 15;
                if realms.len() > max_realm_number {
                    return Err("realm list too long".into());
                }

                if realms
                    .iter()
                    .any(|realm_id| realm_id.len() > CONFIG.max_realm_name)
                {
                    return Err("realm name too long".into());
                }

                Ok(())
            }
            _ => Ok(()),
        }
    }
}

/// Creates a post filter based on the current domain and selected realm.
/// If domain is inavlid no filter is returned.
#[allow(clippy::type_complexity)]
pub fn domain_realm_post_filter(
    state: &State,
    domain: &String,
    realm_id: Option<&RealmId>,
) -> Option<Box<dyn Fn(&Post) -> bool>> {
    let cfg = state.domains.get(domain)?;

    match (realm_id, &cfg.sub_config) {
        // Inside realm_id we show no posts if it's not on a domain whitelist.
        (Some(realm_id), DomainSubConfig::WhiteListedRealms(list)) if !list.contains(realm_id) => {
            None
        }
        // Inside realm_id we show no posts if it's on a domain blacklist.
        (Some(realm_id), DomainSubConfig::BlackListedRealms(list)) if list.contains(realm_id) => {
            None
        }
        // In journal domain we show all posts from the user, independently of the realm.
        (_, DomainSubConfig::Journal(user_id)) => {
            let user_id = *user_id;
            Some(Box::new(move |p: &Post| p.user == user_id))
        }
        // In a realm id we show all posts from this realm no matter the config after previous
        // checks didn't catch anything.
        (Some(realm_id), _) => {
            let realm_id = realm_id.clone();
            Some(Box::new(move |p: &Post| {
                p.realm.as_ref() == Some(&realm_id)
            }))
        }
        // Outside of realms, show any post except those on blacklisted realms.
        (None, DomainSubConfig::BlackListedRealms(list)) => {
            let list = list.clone();
            Some(Box::new(move |p: &Post| {
                p.realm
                    .as_ref()
                    .map(|realm_id| !list.contains(realm_id.as_str()))
                    .unwrap_or(true)
            }))
        }
        // Outside of realms, show only posts on whitelisted realms.
        (None, DomainSubConfig::WhiteListedRealms(list)) => {
            let list = list.clone();
            Some(Box::new(move |p: &Post| {
                p.realm
                    .as_ref()
                    .map(|realm_id| list.contains(realm_id.as_str()))
                    .unwrap_or(false)
            }))
        }
    }
}

pub fn change_domain_config(
    state: &mut State,
    principal: Principal,
    domain: String,
    mut cfg: DomainConfig,
    command: String,
) -> Result<(), String> {
    cfg.validate()?;

    let caller = state.principal_to_user(principal).ok_or("no user found")?;
    let caller_id = caller.id;

    if domain.len() > 40 || !domain.contains(".") || domain.split(".").any(|part| part.is_empty()) {
        return Err("invaild domain".into());
    }

    if ["remove", "update"].contains(&command.as_str()) {
        let current_cfg = state.domains.get(&domain).ok_or("no domain found")?;

        if current_cfg.owner != Some(caller_id) {
            return Err("not authorized".into());
        }
    }

    match command.as_str() {
        "insert" => {
            if state.domains.contains_key(&domain) {
                return Err("domain exists".into());
            }

            state
                .principal_to_user_mut(principal)
                .ok_or("no user found")?
                .change_credits(
                    CONFIG.domain_cost,
                    CreditsDelta::Minus,
                    "domain config creation",
                )?;

            cfg.owner = Some(caller_id);
            state.domains.insert(domain, cfg)
        }
        "remove" => state.domains.remove(&domain),
        "update" => state.domains.insert(domain, cfg),
        _ => return Err("invalid command".into()),
    };

    assets::add_domains(&state.domains);
    assets::certify();

    Ok(())
}

/// Returns realms available under the current domain:
///  - if a whitelist is specified, it return only realms from this list,
///  - if a blacklist is specified, returns all realms not on that list.
///
/// If no config found, returns all domains.
pub fn available_realms(
    state: &State,
    domain: String,
) -> Box<dyn Iterator<Item = &'_ RealmId> + '_> {
    let Some(config) = state.domains.get(&domain) else {
        return Box::new(std::iter::empty());
    };
    let iter = state.realms.iter();
    return Box::new(
        iter.filter(move |(realm_id, _)| match &config.sub_config {
            DomainSubConfig::WhiteListedRealms(list) => list.contains(realm_id.as_str()),
            DomainSubConfig::BlackListedRealms(list) => !list.contains(realm_id.as_str()),
            _ => true,
        })
        .map(|(id, _)| id),
    );
}

#[cfg(test)]
mod tests {
    use crate::{env::Realm, mutate};

    use super::*;
    use crate::tests::*;

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn test_domain_realm_post_filter() {
        mutate(|state| {
            state.init();

            state.realms.insert("REALM1".into(), Realm::default());
            state.realms.insert("REALM2".into(), Realm::default());
            state.realms.insert("REALM3".into(), Realm::default());

            let p = pr(0);
            create_user(state, p);
            state.toggle_realm_membership(p, "REALM1".to_string());
            state.toggle_realm_membership(p, "REALM2".to_string());
            state.toggle_realm_membership(p, "REALM3".to_string());

            // Create test domains with different configurations
            let mut whitelist_config = DomainConfig::default();
            whitelist_config.sub_config = DomainSubConfig::WhiteListedRealms(
                vec!["REALM1".to_string(), "REALM2".to_string()]
                    .into_iter()
                    .collect(),
            );
            state
                .domains
                .insert("whitelist_domain".to_string(), whitelist_config);

            let mut blacklist_config = DomainConfig::default();
            blacklist_config.sub_config = DomainSubConfig::BlackListedRealms(
                vec!["REALM3".to_string()].into_iter().collect(),
            );
            state
                .domains
                .insert("blacklist_domain".to_string(), blacklist_config);

            // Empty config (blacklist with empty set)
            let empty_config = DomainConfig::default();
            state
                .domains
                .insert("empty_config_domain".to_string(), empty_config);

            // Create test posts with different realms
            let mut post_ids = vec![];
            for i in 1..=3 {
                post_ids.push(
                    Post::create(
                        state,
                        "post".to_string(),
                        &[],
                        p,
                        0,
                        None,
                        Some(format!("REALM{}", i)),
                        None,
                    )
                    .unwrap(),
                );
            }
            let no_realm_id =
                Post::create(state, "post".to_string(), &[], p, 0, None, None, None).unwrap();

            let post_realm3 = Post::get(state, &post_ids.pop().unwrap()).unwrap();
            let post_realm2 = Post::get(state, &post_ids.pop().unwrap()).unwrap();
            let post_realm1 = Post::get(state, &post_ids.pop().unwrap()).unwrap();

            let post_no_realm = Post::get(state, &no_realm_id).unwrap();

            // Test whitelist domain with specific realm
            if let Some(filter) = domain_realm_post_filter(
                state,
                &"whitelist_domain".to_string(),
                Some(&"REALM1".to_string()),
            ) {
                assert!(filter(post_realm1));
                assert!(!filter(post_realm2));
                assert!(!filter(post_realm3));
                assert!(!filter(post_no_realm));
            } else {
                panic!("Filter should be Some");
            }

            // Test whitelist domain with no specific realm
            if let Some(filter) =
                domain_realm_post_filter(state, &"whitelist_domain".to_string(), None)
            {
                assert!(filter(post_realm1));
                assert!(filter(post_realm2));
                assert!(!filter(post_realm3));
                assert!(!filter(post_no_realm));
            } else {
                panic!("Filter should be Some");
            }

            // Test blacklist domain with specific realm
            if let Some(filter) = domain_realm_post_filter(
                state,
                &"blacklist_domain".to_string(),
                Some(&"REALM1".to_string()),
            ) {
                assert!(filter(post_realm1));
                assert!(!filter(post_realm3));
            } else {
                panic!("Filter should be Some");
            }

            // Test blacklist domain with no specific realm
            if let Some(filter) =
                domain_realm_post_filter(state, &"blacklist_domain".to_string(), None)
            {
                assert!(filter(post_realm1));
                assert!(filter(post_realm2));
                assert!(!filter(post_realm3));
                assert!(filter(post_no_realm));
            } else {
                panic!("Filter should be Some");
            }

            // Test empty config domain with specific realm
            if let Some(filter) = domain_realm_post_filter(
                state,
                &"empty_config_domain".to_string(),
                Some(&"REALM1".to_string()),
            ) {
                assert!(filter(post_realm1));
                assert!(!filter(post_realm2));
            } else {
                panic!("Filter should be Some");
            }

            // Test empty config domain with no specific realm
            if let Some(filter) =
                domain_realm_post_filter(state, &"empty_config_domain".to_string(), None)
            {
                assert!(filter(post_realm1));
                assert!(filter(post_realm2));
                assert!(filter(post_realm3));
                assert!(filter(post_no_realm)); // Posts with no realm should pass with empty config
            } else {
                panic!("Filter should be Some");
            }

            // Test non-existent domain
            let filter = domain_realm_post_filter(state, &"nonexistent_domain".to_string(), None);
            assert!(filter.is_none());
        });
    }

    #[test]
    fn test_change_domain_config() {
        mutate(|state| {
            state.init();

            // Create test users
            let owner_principal = pr(1);
            let owner_id = create_user_with_credits(state, owner_principal, 2000);

            let non_owner_principal = pr(2);
            let _ = create_user_with_credits(state, non_owner_principal, 2000);

            // Create test realms for whitelist/blacklist testing
            for i in 1..=20 {
                let realm_id = format!("REALM{}", i);
                state.realms.insert(realm_id, Realm::default());
            }

            // TEST CASE 1: Insert new domain config
            let mut config = DomainConfig {
                owner: Some(owner_id),
                ..Default::default()
            };
            config.sub_config = DomainSubConfig::WhiteListedRealms(
                vec!["REALM1".to_string(), "REALM2".to_string()]
                    .into_iter()
                    .collect(),
            );

            // Test: Insert with insufficient credits
            let user = state.principal_to_user_mut(owner_principal).unwrap();
            user.change_credits(2000 - CONFIG.domain_cost + 1, CreditsDelta::Minus, "test")
                .unwrap();

            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "test.domain".to_string(),
                    config.clone(),
                    "insert".to_string()
                ),
                Err("not enough credits (required: 1000)".into())
            );

            // Restore credits
            let user = state.principal_to_user_mut(owner_principal).unwrap();
            user.change_credits(2 * CONFIG.domain_cost, CreditsDelta::Plus, "test")
                .unwrap();

            // Test: Insert with valid parameters
            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "test.domain".to_string(),
                    config.clone(),
                    "insert".to_string()
                ),
                Ok(())
            );

            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "test.domain".to_string(),
                    config.clone(),
                    "insert".to_string()
                ),
                Err("domain exists".into())
            );

            // Verify domain was added
            assert!(state.domains.contains_key("test.domain"));
            let stored_config = state.domains.get("test.domain").unwrap();
            assert_eq!(stored_config.owner, Some(owner_id));
            if let DomainSubConfig::WhiteListedRealms(whitelist) = &stored_config.sub_config {
                assert_eq!(whitelist.len(), 2);
                assert!(whitelist.contains("REALM1"));
                assert!(whitelist.contains("REALM2"));
            } else {
                panic!("Expected WhiteListedRealms");
            }

            // TEST CASE 2: Update domain config
            let mut updated_config = DomainConfig {
                owner: Some(owner_id),
                ..Default::default()
            };
            updated_config.sub_config = DomainSubConfig::WhiteListedRealms(
                vec!["REALM3".to_string()].into_iter().collect(),
            );

            // Test: Update by non-owner
            assert_eq!(
                change_domain_config(
                    state,
                    non_owner_principal,
                    "test.domain".to_string(),
                    updated_config.clone(),
                    "update".to_string()
                ),
                Err("not authorized".into())
            );

            // Test: Update by owner
            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "test.domain".to_string(),
                    updated_config.clone(),
                    "update".to_string()
                ),
                Ok(())
            );

            // Verify domain was updated
            let stored_config = state.domains.get("test.domain").unwrap();
            if let DomainSubConfig::WhiteListedRealms(whitelist) = &stored_config.sub_config {
                assert_eq!(whitelist.len(), 1);
                assert!(whitelist.contains("REALM3"));
            } else {
                panic!("Expected WhiteListedRealms");
            }

            // TEST CASE 3: Whitelist/blacklist limits
            let mut oversized_config = DomainConfig {
                owner: Some(owner_id),
                ..Default::default()
            };

            // Add more than 15 realms to whitelist
            let mut oversized_whitelist = HashSet::new();
            for i in 1..=16 {
                oversized_whitelist.insert(format!("REALM{}", i));
            }
            oversized_config.sub_config = DomainSubConfig::WhiteListedRealms(oversized_whitelist);

            // Test: Insert with oversized whitelist
            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "oversized.domain".to_string(),
                    oversized_config.clone(),
                    "insert".to_string()
                ),
                Err("realm list too long".into())
            );

            // Reset and create oversized blacklist
            let mut oversized_blacklist = HashSet::new();
            for i in 1..=16 {
                oversized_blacklist.insert(format!("REALM{}", i));
            }
            oversized_config.sub_config = DomainSubConfig::BlackListedRealms(oversized_blacklist);

            // Test: Insert with oversized blacklist
            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "oversized.domain".to_string(),
                    oversized_config.clone(),
                    "insert".to_string()
                ),
                Err("realm list too long".into())
            );

            // TEST CASE 4: Remove domain config
            // Test: Remove by non-owner
            assert_eq!(
                change_domain_config(
                    state,
                    non_owner_principal,
                    "test.domain".to_string(),
                    DomainConfig::default(),
                    "remove".to_string()
                ),
                Err("not authorized".into())
            );

            // Test: Remove by owner
            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "test.domain".to_string(),
                    DomainConfig::default(),
                    "remove".to_string()
                ),
                Ok(())
            );

            // Verify domain was removed
            assert!(!state.domains.contains_key("test.domain"));

            // TEST CASE 5: Invalid command
            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "test.domain".to_string(),
                    DomainConfig::default(),
                    "invalid".to_string()
                ),
                Err("invalid command".into())
            );

            // TEST CASE 6: Non-existent domain
            assert_eq!(
                change_domain_config(
                    state,
                    owner_principal,
                    "nonexistent.domain".to_string(),
                    DomainConfig::default(),
                    "update".to_string()
                ),
                Err("no domain found".into())
            );
        });
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn test_personal_feed_with_blacklisted_domain() {
        mutate(|state| {
            state.init();

            // create a post author and one post for its principal
            let p = pr(0);
            let user_id = create_user(state, p);
            state
                .principal_to_user_mut(p)
                .unwrap()
                .change_credits(2000, CreditsDelta::Plus, "")
                .unwrap();

            let realm_id = "DEMO".to_string();
            create_realm(state, p, realm_id.clone()).unwrap();

            // Create blacklisted domain config
            let mut cfg = DomainConfig::default();
            cfg.sub_config =
                DomainSubConfig::BlackListedRealms(vec![realm_id.clone()].into_iter().collect());
            state.domains.insert("nodemo".into(), cfg);

            // Create whitelisted domain config
            let mut cfg = DomainConfig::default();
            cfg.sub_config =
                DomainSubConfig::WhiteListedRealms(vec![realm_id.clone()].into_iter().collect());
            state.domains.insert("demo".into(), cfg);

            // Join realm DEMO
            assert!(!state
                .principal_to_user(p)
                .unwrap()
                .realms
                .contains(&realm_id));
            assert!(state.toggle_realm_membership(p, realm_id.clone()));

            // Create two posts outside and inside the DEMO realm
            let post_id_1 =
                Post::create(state, "message1".to_string(), &[], p, 0, None, None, None).unwrap();
            let post_id_2 = Post::create(
                state,
                "message2".to_string(),
                &[],
                p,
                0,
                None,
                Some(realm_id),
                None,
            )
            .unwrap();

            // Check user posts
            let user = state.principal_to_user(p).unwrap();
            let iter = user.posts(Some(&"nodemo".to_string()), state, 0, false);
            assert_eq!(iter.count(), 1);

            // make sure we see both posts sent to localhost domain because it is a wildcard domain
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed("localhost".into(), state, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 2);

            // make sure only the post 1 is visible in the nodemo domain
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed("nodemo".into(), state, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 1);
            assert!(feed.contains(&post_id_1));

            // make sure only the post 2 is visible in the demo domain
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed("demo".into(), state, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 1);
            assert!(feed.contains(&post_id_2));
        });
    }
}
