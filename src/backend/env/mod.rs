use self::canisters::{icrc_transfer, upgrade_main_canister, NNSVote};
use self::invoices::{Invoice, USER_ICP_SUBACCOUNT};
use self::post::{archive_cold_posts, Extension, Poll, Post, PostId};
use self::proposals::{Payload, Status};
use self::reports::Report;
use self::token::{account, TransferArgs};
use self::user::{Filters, Notification, Predicate, UserFilter};
use crate::assets::export_token_supply;
use crate::env::user::CreditsDelta;
use crate::proposals::Proposal;
use crate::token::{Account, Token, Transaction};
use crate::{assets, id, mutate, read, time};
use candid::Principal;
use config::{CONFIG, ICP_CYCLES_PER_XDR};
use ic_cdk::api::stable::stable64_size;
use ic_cdk::api::{self, canister_balance};
use ic_ledger_types::{AccountIdentifier, DEFAULT_SUBACCOUNT, MAINNET_LEDGER_CANISTER_ID};
use invoices::Invoices;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use user::{User, UserId};

pub mod canisters;
pub mod config;
pub mod invoices;
pub mod memory;
pub mod post;
pub mod proposals;
pub mod reports;
pub mod search;
pub mod storage;
pub mod token;
pub mod user;

pub type Credits = u64;
pub type Blob = ByteBuf;
pub type Time = u64;

pub const MILLISECOND: u64 = 1_000_000_u64;
pub const SECOND: u64 = 1000 * MILLISECOND;
pub const MINUTE: u64 = 60 * SECOND;
pub const HOUR: u64 = 60 * MINUTE;
pub const DAY: u64 = 24 * HOUR;
pub const WEEK: u64 = 7 * DAY;

#[derive(Serialize, Deserialize)]
pub struct NNSProposal {
    pub id: u64,
    pub topic: i32,
    pub proposer: u64,
    pub title: String,
    pub summary: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Event {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
pub struct Stats {
    minting_ratio: u64,
    e8s_revenue_per_1k: u64,
    e8s_for_one_xdr: u64,
    team_tokens: HashMap<UserId, Token>,
    users: usize,
    credits: Credits,
    canister_cycle_balance: u64,
    burned_credits: i64,
    burned_credits_total: Credits,
    total_revenue_shared: u64,
    total_rewards_shared: u64,
    posts: usize,
    comments: usize,
    account: String,
    last_weekly_chores: u64,
    last_daily_chores: u64,
    last_hourly_chores: u64,
    stalwarts: Vec<UserId>,
    bots: Vec<UserId>,
    state_size: u64,
    active_users: usize,
    invited_users: usize,
    buckets: Vec<(String, u64)>,
    users_online: usize,
    last_upgrade: u64,
    module_hash: String,
    canister_id: Principal,
    circulating_supply: u64,
    meta: String,

    fees_burned: Token,
    volume_day: Token,
    volume_week: Token,
}

pub type RealmId = String;

#[derive(Default, Serialize, Deserialize)]
pub struct Realm {
    pub cleanup_penalty: Credits,
    pub controllers: BTreeSet<UserId>,
    pub description: String,
    pub filter: UserFilter,
    pub label_color: String,
    pub last_setting_update: u64,
    pub last_update: u64,
    logo: String,
    pub num_members: u64,
    pub num_posts: usize,
    pub revenue: Credits,
    theme: String,
    pub whitelist: BTreeSet<UserId>,
    pub created: Time,
    // Root posts assigned to the realm
    pub posts: Vec<PostId>,
    #[serde(default)]
    pub adult_content: bool,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Summary {
    pub title: String,
    description: String,
    items: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct State {
    pub burned_cycles: i64,
    pub burned_cycles_total: Credits,
    pub posts: BTreeMap<PostId, Post>,
    pub users: BTreeMap<UserId, User>,
    pub principals: HashMap<Principal, UserId>,
    pub next_post_id: PostId,
    pub next_user_id: UserId,
    pub accounting: Invoices,
    pub storage: storage::Storage,
    pub last_weekly_chores: u64,
    pub last_daily_chores: u64,
    pub last_hourly_chores: u64,
    pub logger: Logger,
    pub invites: BTreeMap<String, (UserId, Credits)>,
    pub realms: BTreeMap<RealmId, Realm>,

    #[serde(skip)]
    pub balances: HashMap<Account, Token>,

    #[serde(skip)]
    // new principal -> old principal
    pub principal_change_requests: BTreeMap<Principal, Principal>,

    total_revenue_shared: u64,
    total_rewards_shared: u64,

    pub proposals: Vec<Proposal>,
    pub ledger: Vec<Transaction>,

    pub team_tokens: HashMap<UserId, Token>,

    pub memory: memory::Memory,

    // This runtime flag has to be set in order to mint new tokens.
    #[serde(skip)]
    pub minting_mode: bool,
    #[serde(skip)]
    pub module_hash: String,
    #[serde(skip)]
    pub last_upgrade: u64,

    #[serde(skip)]
    pub emergency_binary: Vec<u8>,
    #[serde(skip)]
    pub emergency_votes: BTreeMap<Principal, Token>,

    pending_polls: BTreeSet<PostId>,

    pending_nns_proposals: BTreeMap<u64, PostId>,

    pub last_nns_proposal: u64,

    // TODO: delete
    #[serde(skip)]
    pub root_posts: usize,

    #[serde(default)]
    pub root_posts_index: Vec<PostId>,

    e8s_for_one_xdr: u64,

    last_revenues: VecDeque<u64>,

    pub tag_subscribers: HashMap<String, usize>,

    pub distribution_reports: Vec<Summary>,

    migrations: BTreeSet<UserId>,

    pub posts_with_tags: Vec<PostId>,

    // Indicates whether the end of the stable memory contains a valid heap snapshot.
    #[serde(skip)]
    pub backup_exists: bool,

    #[serde(skip)]
    pub last_archive: u64,
}

#[derive(Default, Deserialize, Serialize)]
pub struct Logger {
    pub events: BTreeMap<String, Vec<Event>>,
}

impl Logger {
    pub fn critical<T: ToString>(&mut self, message: T) {
        self.log(message, "CRITICAL".to_string());
    }

    pub fn error<T: ToString>(&mut self, message: T) {
        self.log(message, "ERROR".to_string());
    }

    pub fn warn<T: ToString>(&mut self, message: T) {
        self.log(message, "WARN".to_string());
    }

    pub fn debug<T: ToString>(&mut self, message: T) {
        self.log(message, "DEBUG".to_string());
    }

    pub fn info<T: ToString>(&mut self, message: T) {
        self.log(message, "INFO".to_string());
    }

    pub fn log<T: ToString>(&mut self, message: T, level: String) {
        let event = Event {
            timestamp: time(),
            message: message.to_string(),
            level,
        };
        self.events
            .entry(event.level.clone())
            .and_modify(|list| {
                list.push(event.clone());
                while list.len() > 300 {
                    list.remove(0);
                }
            })
            .or_insert(vec![event]);
    }
}

#[derive(PartialEq)]
pub enum Destination {
    Rewards,
    Credits,
}

impl State {
    pub fn tags_cost(&self, tags: Box<dyn Iterator<Item = &'_ String> + '_>) -> Credits {
        tags.fold(0, |acc, tag| {
            acc + self
                .tag_subscribers
                .get(tag.to_lowercase().as_str())
                .copied()
                .unwrap_or_default()
        }) as Credits
    }

    pub fn link_cold_wallet(&mut self, caller: Principal, user_id: UserId) -> Result<(), String> {
        if self.principal_to_user(caller).is_some() {
            return Err("this wallet is linked already".into());
        }
        let user = self.users.get_mut(&user_id).ok_or("no user found")?;
        if user.cold_wallet.is_some() {
            return Err("this user has already a cold wallet".into());
        }
        user.cold_wallet = Some(caller);
        user.cold_balance = self
            .balances
            .get(&account(caller))
            .copied()
            .unwrap_or_default();
        self.principals.insert(caller, user.id);
        Ok(())
    }

    pub fn unlink_cold_wallet(&mut self, caller: Principal) -> Result<(), String> {
        if self.voted_on_pending_proposal(caller) {
            return Err("a vote on a pending proposal detected".into());
        }
        if let Some(user) = self.principal_to_user_mut(caller) {
            let principal = user.cold_wallet.take();
            user.cold_balance = 0;
            if let Some(principal) = principal {
                self.principals.remove(&principal);
            }
        }
        Ok(())
    }

    pub fn voted_on_pending_proposal(&self, principal: Principal) -> bool {
        self.emergency_votes.contains_key(&principal)
            || self
                .principal_to_user(principal)
                .map(|user| {
                    self.proposals.iter().any(|proposal| {
                        proposal.status == Status::Open
                            && proposal
                                .bulletins
                                .iter()
                                .any(|(user_id, _, _)| &user.id == user_id)
                    })
                })
                .unwrap_or_default()
    }

    pub async fn finalize_upgrade() {
        let current_hash = canisters::settings(id())
            .await
            .ok()
            .and_then(|s| s.module_hash.map(hex::encode))
            .unwrap_or_default();
        mutate(|state| {
            state.module_hash = current_hash.clone();
            state.logger.debug(format!(
                "Upgrade succeeded: new version is `{}`.",
                &current_hash[0..8]
            ));
        });
    }

    pub fn execute_pending_upgrade(&mut self, force: bool) -> bool {
        let pending_upgrade =
            self.proposals
                .iter()
                .rev()
                .find_map(|proposal| match &proposal.payload {
                    Payload::Release(payload)
                        if proposal.status == Status::Executed && !payload.binary.is_empty() =>
                    {
                        Some(payload)
                    }
                    _ => None,
                });
        if let Some(release) = pending_upgrade {
            upgrade_main_canister(&mut self.logger, &release.binary, force);
            true
        } else {
            false
        }
    }

    pub fn execute_pending_emergency_upgrade(&mut self, force: bool) -> bool {
        if self.emergency_binary.is_empty() {
            return false;
        }
        let active_vp = self.active_voting_power(time());
        let votes = self.emergency_votes.values().sum::<Token>();
        if votes * 100 >= active_vp * CONFIG.proposal_approval_threshold as u64 {
            let binary = self.emergency_binary.clone();
            upgrade_main_canister(&mut self.logger, &binary, force);
            return true;
        }
        false
    }

    pub fn clean_up_realm(
        &mut self,
        principal: Principal,
        post_id: PostId,
        reason: String,
    ) -> Result<(), String> {
        let controller = self.principal_to_user(principal).ok_or("no user found")?.id;
        let post = Post::get(self, &post_id).ok_or("no post found")?;
        if post.parent.is_some() {
            return Err("only root posts can be moved out of realms".into());
        }
        let realm_id = post.realm.as_ref().cloned().ok_or("no realm id found")?;
        let realm = self.realms.get(&realm_id).ok_or("no realm found")?;

        if post.creation_timestamp() < realm.last_setting_update {
            return Err(
                "cannot move out posts created before the latest realm parameter changes".into(),
            );
        }

        let post_user = post.user;
        if !realm.controllers.contains(&controller) {
            return Err("only realm controller can clean up".into());
        }
        let user = self.users.get_mut(&post_user).ok_or("no user found")?;
        let user_principal = user.principal;
        let realm_member = user.realms.contains(&realm_id);
        let msg = format!(
            "post [{0}](#/post/{0}) was moved out of realm /{1}: {2}",
            post_id, realm_id, reason
        );
        user.change_rewards(-(realm.cleanup_penalty as i64), &msg);
        let user_id = user.id;
        let penalty = realm.cleanup_penalty.min(user.credits());
        // if user has no credits left, ignore the error
        let _ = self.charge(user_id, penalty, msg);
        post::change_realm(self, post_id, None);
        let realm = self.realms.get_mut(&realm_id).expect("no realm found");
        realm.posts.retain(|id| id != &post_id);
        if realm_member {
            self.toggle_realm_membership(user_principal, realm_id);
        }
        Ok(())
    }

    pub fn active_voters(&self, time: u64) -> Box<dyn Iterator<Item = (UserId, Token)> + '_> {
        Box::new(
            self.users
                .values()
                .filter(move |user| {
                    user.active_within_weeks(time, CONFIG.voting_power_activity_weeks)
                })
                .map(move |user| (user.id, user.total_balance())),
        )
    }

    pub fn active_voting_power(&self, time: u64) -> Token {
        self.active_voters(time).map(|(_, balance)| balance).sum()
    }

    fn spend_to_user_rewards<T: ToString>(&mut self, user_id: UserId, amount: Credits, log: T) {
        let user = self.users.get_mut(&user_id).expect("no user found");
        user.change_rewards(amount as i64, log);
        self.burned_cycles = self.burned_cycles.saturating_sub(amount as i64);
    }

    pub fn spend<T: ToString>(&mut self, amount: Credits, log: T) {
        if amount > 5 {
            self.logger.info(format!(
                "Spent `{}` credits on {}.",
                amount,
                log.to_string()
            ));
        }
        self.burned_cycles = self.burned_cycles.saturating_sub(amount as i64);
    }

    pub fn charge<T: ToString>(
        &mut self,
        id: UserId,
        amount: Credits,
        log: T,
    ) -> Result<(), String> {
        self.charge_in_realm(id, amount, None, log)
    }

    pub fn charge_in_realm<T: ToString>(
        &mut self,
        id: UserId,
        amount: Credits,
        realm_id: Option<&RealmId>,
        log: T,
    ) -> Result<(), String> {
        if amount < 1 {
            return Err("non-positive amount".into());
        }
        let user = self.users.get_mut(&id).ok_or("no user found")?;
        user.change_credits(amount, CreditsDelta::Minus, log)?;
        self.burned_cycles = self
            .burned_cycles
            .checked_add(amount as i64)
            .ok_or("wrong amount")?;
        if let Some(realm) = realm_id.and_then(|id| self.realms.get_mut(id)) {
            realm.revenue = realm.revenue.checked_add(amount).ok_or("wrong amount")?
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn credit_transfer<T: ToString>(
        &mut self,
        sender_id: UserId,
        receiver_id: UserId,
        amount: Credits,
        fee: Credits,
        destination: Destination,
        log: T,
        notification: Option<String>,
    ) -> Result<(), String> {
        let sender = self.users.get_mut(&sender_id).expect("no sender found");
        sender.change_credits(
            amount.checked_add(fee).ok_or("wrong credit amount")?,
            CreditsDelta::Minus,
            log.to_string(),
        )?;
        let receiver = self.users.get_mut(&receiver_id).expect("no receiver found");
        self.burned_cycles = self
            .burned_cycles
            .checked_add(fee as i64)
            .ok_or("wrong fee")?;
        let result = match destination {
            Destination::Rewards => {
                receiver.change_rewards(amount as i64, log);
                Ok(())
            }
            Destination::Credits => receiver.change_credits(amount, CreditsDelta::Plus, log),
        };
        if result.is_ok() {
            if let Some(message) = notification {
                receiver.notify(message);
            }
        }
        result
    }

    pub fn load(&mut self) {
        assets::load();
        match token::balances_from_ledger(&self.ledger) {
            Ok(balances) => {
                for user in self.users.values_mut() {
                    user.balance = balances
                        .get(&account(user.principal))
                        .copied()
                        .unwrap_or_default();
                    user.cold_balance = user
                        .cold_wallet
                        .and_then(|principal| balances.get(&account(principal)).copied())
                        .unwrap_or_default();
                }
                self.balances = balances;
            }
            Err(err) => self
                .logger
                .critical(format!("the token ledger is inconsistent: {}", err)),
        }
        if !self.realms.contains_key(CONFIG.dao_realm) {
            self.realms.insert(
                CONFIG.dao_realm.to_string(),
                Realm {
                    description:
                        "The default DAO realm. Stalwarts are added and removed by default."
                            .to_string(),
                    ..Default::default()
                },
            );
        }
        self.last_upgrade = time();
        self.last_hourly_chores = time();
    }

    pub fn realms_posts(
        &self,
        caller: Principal,
        page: usize,
        offset: PostId,
    ) -> Box<dyn Iterator<Item = &'_ Post> + '_> {
        let realm_ids = match self
            .principal_to_user(caller)
            .map(|user| user.realms.as_slice())
        {
            None | Some(&[]) => return Box::new(std::iter::empty()),
            Some(ids) => ids.iter().collect::<BTreeSet<_>>(),
        };
        Box::new(
            self.last_posts(None, offset, 0, false)
                .filter(move |post| {
                    post.realm
                        .as_ref()
                        .map(|id| realm_ids.contains(&id))
                        .unwrap_or_default()
                })
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size),
        )
    }

    pub fn hot_posts(
        &self,
        realm: Option<RealmId>,
        page: usize,
        offset: PostId,
        filter: Option<&dyn Fn(&Post) -> bool>,
    ) -> Box<dyn Iterator<Item = &'_ Post> + '_> {
        let mut hot_posts = self
            .last_posts(realm, offset, 0, false)
            .filter(|post| !matches!(post.extension, Some(Extension::Proposal(_))))
            .filter(|post| filter.map(|f| f(post)).unwrap_or(true))
            .take(1000)
            .collect::<Vec<_>>();
        hot_posts.sort_unstable_by_key(|post| Reverse(post.heat()));
        Box::new(
            hot_posts
                .into_iter()
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size),
        )
    }

    pub fn toggle_realm_membership(&mut self, principal: Principal, name: String) -> bool {
        let user_id = match self.principal_to_user(principal) {
            Some(user) => user.id,
            _ => return false,
        };

        let Some(user) = self.users.get_mut(&user_id) else {
            return false;
        };

        let Some(realm) = self.realms.get_mut(&name) else {
            return false;
        };

        if user.realms.contains(&name) {
            user.realms.retain(|realm| realm != &name);
            realm.num_members -= 1;
            return false;
        }

        realm.num_members += 1;
        user.realms.push(name.clone());
        user.filters.realms.remove(&name);
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn edit_realm(
        &mut self,
        principal: Principal,
        name: String,
        realm: Realm,
    ) -> Result<(), String> {
        let Realm {
            logo,
            label_color,
            theme,
            description,
            controllers,
            whitelist,
            filter,
            cleanup_penalty,
            adult_content,
            ..
        } = realm;
        let user = self.principal_to_user(principal).ok_or("no user found")?;
        let user_id = user.id;
        let user_name = user.name.clone();
        let realm = self.realms.get_mut(&name).ok_or("no realm found")?;
        if !realm.controllers.contains(&user_id) {
            return Err("not authorized".into());
        }
        if controllers.is_empty() {
            return Err("no controllers specified".into());
        }
        if !logo.is_empty() {
            realm.logo = logo;
        }
        let description_change = realm.description != description;
        realm.description = description;
        if realm.controllers != controllers {
            self.logger.info(format!(
                "Realm /{} controller list was changed from {:?} to {:?}",
                name, &realm.controllers, &controllers
            ));
        }
        realm.controllers = controllers;
        realm.label_color = label_color;
        realm.theme = theme;
        realm.whitelist = whitelist;
        realm.filter = filter;
        realm.cleanup_penalty = CONFIG.max_realm_cleanup_penalty.min(cleanup_penalty);
        realm.last_setting_update = time();
        realm.adult_content = adult_content;
        if description_change {
            self.notify_with_filter(
                &|user| user.realms.contains(&name),
                format!(
                    "@{} changed the description of the realm /{}! ",
                    user_name, name
                ) + "Please read the new description to avoid potential penalties for rules violation!",
            );
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_realm(
        &mut self,
        principal: Principal,
        name: String,
        mut realm: Realm,
    ) -> Result<(), String> {
        let Realm {
            controllers,
            cleanup_penalty,
            ..
        } = &realm;
        if controllers.is_empty() {
            return Err("no controllers specified".into());
        }

        if name.len() > CONFIG.max_realm_name {
            return Err("realm name too long".into());
        }

        if name
            .chars()
            .any(|c| !char::is_alphanumeric(c) && c != '_' && c != '-')
        {
            return Err("realm name should be an alpha-numeric string".into());
        }

        if name.chars().all(|c| char::is_ascii_digit(&c)) {
            return Err("realm name should have at least on character".into());
        }

        if CONFIG.name.to_lowercase() == name.to_lowercase()
            || self.realms.contains_key(&name)
            || CONFIG.dao_realm.to_lowercase() == name.to_lowercase()
        {
            return Err("realm name taken".into());
        }

        let user = self.principal_to_user(principal).ok_or("no user found")?;
        let user_id = user.id;
        let user_name = user.name.clone();

        self.charge(user_id, CONFIG.realm_cost, format!("new realm /{}", name))
            .map_err(|err| {
                format!(
                    "couldn't charge {} credits for realm creation: {}",
                    CONFIG.realm_cost, err
                )
            })?;

        realm.cleanup_penalty = CONFIG.max_realm_cleanup_penalty.min(*cleanup_penalty);
        realm.last_update = time();
        realm.created = time();

        self.realms.insert(name.clone(), realm);

        self.logger.info(format!(
            "@{} created realm [{1}](/#/realm/{1}) 🎭",
            user_name, name
        ));

        Ok(())
    }

    pub fn tip(
        &mut self,
        principal: Principal,
        post_id: PostId,
        amount: u64,
    ) -> Result<(), String> {
        let tipper = self.principal_to_user(principal).ok_or("no user found")?;
        let tipper_id = tipper.id;
        let tipper_name = tipper.name.clone();
        let author_id = Post::get(self, &post_id).ok_or("post not found")?.user;
        let author = self.users.get(&author_id).ok_or("no user found")?;
        token::transfer(
            self,
            time(),
            principal,
            TransferArgs {
                from_subaccount: None,
                to: account(author.principal),
                fee: Some(1), // special tipping fee
                amount: amount as u128,
                memo: None,
                created_at_time: None,
            },
        )
        .map_err(|err| format!("tip transfer failed: {:?}", err))?;
        Post::mutate(self, &post_id, |post| {
            post.tips.push((tipper_id, amount));
            Ok(())
        })?;
        self.users
            .get_mut(&author_id)
            .expect("user not found")
            .notify_about_post(
                format!(
                    "@{} tipped you with `{}` {} for your post",
                    tipper_name,
                    display_tokens(amount, CONFIG.token_decimals as u32),
                    CONFIG.token_symbol
                ),
                post_id,
            );
        Ok(())
    }

    fn new_user(
        &mut self,
        principal: Principal,
        timestamp: u64,
        name: String,
        credits: Option<Credits>,
    ) -> Result<UserId, String> {
        if principal == Principal::anonymous() {
            return Err("invalid principal".into());
        }
        if self.principals.contains_key(&principal) {
            return Err("another user assigned to the same principal".into());
        }
        let id = self.new_user_id();
        let mut user = User::new(principal, id, timestamp, name);
        user.notify(format!("**Welcome!** 🎉 Use #{} as your personal blog, micro-blog or a photo blog. Use #hashtags to connect with others. Make sure you understand [how {0} works](/#/whitepaper). And finally, [say hello](#/new) and start earning rewards!", CONFIG.name));
        if let Some(credits) = credits {
            user.change_credits(credits, CreditsDelta::Plus, "topped up by an invite")
                .expect("couldn't add credits when creating a new user");
        }
        self.principals.insert(principal, user.id);
        self.users.insert(user.id, user);
        Ok(id)
    }

    #[cfg(feature = "dev")]
    pub fn new_test_user(
        &mut self,
        principal: Principal,
        timestamp: u64,
        name: String,
        credits: Option<Credits>,
    ) -> Result<UserId, String> {
        self.new_user(principal, timestamp, name, credits)
    }

    pub async fn create_user(
        principal: Principal,
        name: String,
        invite: Option<String>,
    ) -> Result<(), String> {
        let invited = mutate(|state| {
            state.validate_username(&name)?;
            if let Some(user) = state.principal_to_user(principal) {
                return Err(format!("principal already assigned to user @{}", user.name));
            }
            if let Some((inviter_id, credits)) = invite.and_then(|code| state.invites.remove(&code))
            {
                let inviter = state.users.get_mut(&inviter_id).ok_or("no user found")?;
                let new_user_id = if inviter.credits() > credits {
                    let new_user_id = state.new_user(principal, time(), name.clone(), None)?;
                    state
                        .credit_transfer(
                            inviter_id,
                            new_user_id,
                            credits,
                            0,
                            Destination::Credits,
                            "claimed by invited user",
                            None,
                        )
                        .unwrap_or_else(|err| panic!("couldn't use the invite: {}", err));
                    new_user_id
                } else {
                    return Err("inviter has not enough credits".into());
                };
                let user = state.users.get_mut(&new_user_id).expect("no user found");
                user.invited_by = Some(inviter_id);
                if let Some(inviter) = state.users.get_mut(&inviter_id) {
                    inviter.notify(format!(
                        "Your invite was used by @{}! Thanks for helping #{} grow! 🤗",
                        name, CONFIG.name
                    ));
                }
                return Ok(true);
            }
            Ok(false)
        })?;

        if invited {
            return Ok(());
        }

        if let Ok(Invoice { paid: true, .. }) = State::mint_credits(principal, 0).await {
            mutate(|state| state.new_user(principal, time(), name, None))?;
            // After the user has beed created, transfer credits.
            return State::mint_credits(principal, 0).await.map(|_| ());
        }

        Err("payment missing or the invite is invalid".to_string())
    }

    pub fn invites(&self, principal: Principal) -> Vec<(String, Credits)> {
        self.principal_to_user(principal)
            .map(|user| {
                self.invites
                    .iter()
                    .filter(|(_, (user_id, _))| user_id == &user.id)
                    .map(|(code, (_, credits))| (code.clone(), *credits))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }

    pub fn create_invite(&mut self, principal: Principal, credits: Credits) -> Result<(), String> {
        let min_credits = CONFIG.min_credits_for_inviting;
        let user = self
            .principal_to_user_mut(principal)
            .ok_or("no user found")?;
        if credits < min_credits {
            return Err(format!(
                "smallest invite must contain {} credits",
                min_credits
            ));
        }
        if user.credits() < credits {
            return Err("not enough credits".into());
        }
        let mut hasher = Sha256::new();
        hasher.update(principal.as_slice());
        hasher.update(time().to_be_bytes());
        let code = format!("{:x}", hasher.finalize())[..10].to_string();
        let user_id = user.id;
        self.invites.insert(code, (user_id, credits));
        Ok(())
    }

    fn critical<T: ToString>(&mut self, message: T) {
        self.logger.critical(&message.to_string());
        self.users.values_mut().for_each(|user| {
            user.notify(format!("CRITICAL SYSTEM ERROR: {}", message.to_string()))
        });
    }

    fn notify_with_predicate<T: AsRef<str>>(
        &mut self,
        filter: &dyn Fn(&User) -> bool,
        message: T,
        predicate: Predicate,
    ) {
        self.users
            .values_mut()
            .filter(|u| filter(u))
            .for_each(|u| u.notify_with_params(&message, Some(predicate.clone())));
    }

    fn notify_with_filter<T: AsRef<str>>(&mut self, filter: &dyn Fn(&User) -> bool, message: T) {
        self.users
            .values_mut()
            .filter(|u| filter(u))
            .for_each(|u| u.notify_with_params(&message, None))
    }

    pub fn denotify_users(&mut self, filter: &dyn Fn(&User) -> bool) {
        let mut notifications = Vec::new();
        for user in self.users.values().filter(|u| filter(u)) {
            for (id, (notification, read_status)) in user.notifications.iter() {
                if *read_status {
                    continue;
                }
                if let Notification::Conditional(_, predicate) = notification {
                    let current_status = match predicate {
                        Predicate::UserReportOpen(user_id) => self
                            .users
                            .get(user_id)
                            .and_then(|p| p.report.as_ref().map(|r| r.closed))
                            .unwrap_or_default(),
                        Predicate::ReportOpen(post_id) => Post::get(self, post_id)
                            .and_then(|p| p.report.as_ref().map(|r| r.closed))
                            .unwrap_or_default(),
                        Predicate::Proposal(post_id) => self
                            .proposals
                            .iter()
                            .find(|p| p.post_id == *post_id)
                            .map(|p| p.status != Status::Open)
                            .unwrap_or_default(),
                    };
                    if current_status != *read_status {
                        notifications.push((user.id, *id, current_status));
                    }
                }
            }
        }

        for (user_id, notification_id, new_read_status) in notifications {
            if let Some((_, read_status)) = self
                .users
                .get_mut(&user_id)
                .and_then(|user| user.notifications.get_mut(&notification_id))
            {
                *read_status = new_read_status;
            }
        }
    }

    async fn top_up() {
        let children = read(|state| state.storage.buckets.keys().cloned().collect::<Vec<_>>());

        // top up the main canister
        let balance = canister_balance();
        let target_balance = CONFIG.main_canister_min_cycle_balance
            + children.len() as u64 * CONFIG.child_canister_min_cycle_balance;
        if balance < target_balance {
            let xdrs = target_balance / ICP_CYCLES_PER_XDR;
            // subtract weekly burned credits to reduce the revenue
            mutate(|state| state.spend(xdrs * 1000, "canister top up"));
            match invoices::topup_with_icp(&api::id(), xdrs).await {
                Err(err) => mutate(|state| {
                    state.critical(format!(
                    "FAILED TO TOP UP THE MAIN CANISTER — {}'S FUNCTIONALITY IS ENDANGERED: {:?}",
                    CONFIG.name.to_uppercase(),
                    err
                ))
                }),
                Ok(_credits) => mutate(|state| {
                    state.logger.debug(format!(
                        "The main canister was topped up with credits (balance was `{}`, now `{}`).",
                        balance,
                        canister_balance()
                    ))
                }),
            }
        }

        // top up all children canisters
        let mut topped_up = Vec::new();
        for canister_id in children {
            match crate::canisters::top_up(canister_id, CONFIG.child_canister_min_cycle_balance)
                .await
            {
                Ok(true) => topped_up.push(canister_id),
                Err(err) => mutate(|state| state.critical(err)),
                _ => {}
            }
        }
        if !topped_up.is_empty() {
            mutate(|state| {
                state.logger.debug(format!(
                    "Topped up canisters: {:?}.",
                    topped_up
                        .into_iter()
                        .map(|p| p.to_string())
                        .collect::<Vec<_>>()
                ))
            })
        }
    }

    pub fn collect_revenue(&self, now: u64, e8s_for_one_xdr: u64) -> HashMap<UserId, u64> {
        let burned_credits = self.burned_cycles;
        if burned_credits <= 0 {
            return Default::default();
        }
        let active_user_balances = self.active_voters(now);
        let supply_of_active_users = self.active_voting_power(now);
        active_user_balances
            .map(|(user_id, balance)| {
                let revenue_share =
                    burned_credits as f64 * balance as f64 / supply_of_active_users as f64;
                let e8s =
                    (revenue_share / CONFIG.credits_per_xdr as f64 * e8s_for_one_xdr as f64) as u64;
                (user_id, e8s)
            })
            .collect()
    }

    pub fn minting_ratio(&self) -> u64 {
        let circulating_supply: Token = self.balances.values().sum();
        let factor = (circulating_supply as f64 / CONFIG.maximum_supply as f64 * 10.0) as u64;
        1 << factor
    }

    pub fn tokens_to_mint(&self) -> BTreeMap<UserId, Token> {
        let num_active_users = self
            .users
            .values()
            .filter(|user| user.active_within_weeks(time(), 1))
            .count();
        let user_shares = 1.max(
            (num_active_users as f32
                * (CONFIG.active_user_share_for_minting_promille as f32 / 1000.0))
                as u64,
        );
        let boostraping_mode =
            self.balances.values().sum::<Token>() < CONFIG.boostrapping_threshold_tokens;
        let mut tokens_to_mint: BTreeMap<UserId, Token> = Default::default();

        for (user_id, tokens) in self
            .users
            .values()
            .flat_map(|user| user.mintable_tokens(self, user_shares, boostraping_mode))
        {
            tokens_to_mint
                .entry(user_id)
                .and_modify(|balance| *balance += tokens)
                .or_insert(tokens);
        }

        tokens_to_mint.retain(|user_id, balance| {
            *balance > 0
                && self
                    .users
                    .get(user_id)
                    .map(|user| user.eligible_for_minting())
                    .unwrap_or_default()
        });

        tokens_to_mint
    }

    pub fn mint(&mut self) {
        let circulating_supply: Token = self.balances.values().sum();
        if circulating_supply >= CONFIG.maximum_supply {
            return;
        }

        let tokens_to_mint = self.tokens_to_mint();

        let mut minted_tokens = 0;
        let ratio = self.minting_ratio();
        let mut summary = Summary {
            title: "Token minting report".into(),
            description: Default::default(),
            items: Vec::default(),
        };

        let total_tokens_to_mint: u64 = tokens_to_mint.values().sum();

        if ratio > 1
            && total_tokens_to_mint * 100 / circulating_supply > CONFIG.minting_threshold_percentage
        {
            self.logger.warn(format!(
                "Skipping minting: `{}` tokens exceed the configured threshold of `{}`% of existing supply.",
                total_tokens_to_mint, CONFIG.minting_threshold_percentage
            ));
            return;
        }

        let mut items = Vec::default();
        for (user_id, tokens) in tokens_to_mint {
            // This is a circuit breaker to avoid unforeseen side-effects due to hacks or bugs.
            if ratio > 1
                && tokens * 100 / circulating_supply
                    > CONFIG.individual_minting_threshold_percentage
            {
                self.logger.warn(format!(
                    "Minting skipped: `{}` tokens for user_id=`{}` exceed the configured threshold of `{}`% of existing supply.",
                    tokens, user_id, CONFIG.individual_minting_threshold_percentage
                ));
                continue;
            }

            let base = token::base();
            if let Some(user) = self.users.get_mut(&user_id) {
                let minted_fractional = tokens as f64 / base as f64;
                user.notify(format!(
                    "{} minted `{}` ${} tokens for you! 💎",
                    CONFIG.name, minted_fractional, CONFIG.token_symbol,
                ));
                items.push((tokens, minted_fractional, user.name.clone()));
                let acc = account(user.principal);
                crate::token::mint(self, acc, tokens);
                minted_tokens += tokens / base;
            }
        }

        items.sort_unstable_by_key(|(minted, _, _)| Reverse(*minted));
        for (_, minted, name) in &items {
            summary.items.push(format!("`{}` to @{}", minted, name));
        }

        // Mint team tokens
        for (user_id, user_name, user_principal, user_balance) in [0, 305]
            .iter()
            .filter_map(|id| {
                self.users.get(id).map(|user| {
                    (
                        user.id,
                        user.name.clone(),
                        user.principal,
                        user.total_balance(),
                    )
                })
            })
            .collect::<Vec<_>>()
        {
            let acc = account(user_principal);
            let total_balance = user_balance;
            let vested = match self.team_tokens.get_mut(&user_id) {
                Some(balance) if *balance > 0 => {
                    // 1% of circulating supply is vesting.
                    let vested = (circulating_supply / 100).min(*balance);
                    // We use 14% because 1% will vest and we want to stay below 15%.
                    let cap = (circulating_supply * 14) / 100;
                    // Vesting is allowed if the total voting power of the team member stays below
                    // 15% of the current supply, or if 2/3 of total supply is minted.
                    if total_balance <= cap || circulating_supply * 3 > CONFIG.maximum_supply * 2 {
                        *balance = balance.saturating_sub(vested);
                        Some((vested, *balance))
                    } else {
                        None
                    }
                }
                _ => None,
            };
            if let Some((vested, remaining_balance)) = vested {
                crate::token::mint(self, acc, vested);
                self.logger.info(format!(
                    "Minted `{}` team tokens for @{} (still vesting: `{}`).",
                    vested / 100,
                    user_name,
                    remaining_balance / 100
                ));
            }
        }

        if summary.items.is_empty() {
            self.logger.info("no tokens were minted".to_string());
        } else {
            summary.description = format!(
                "{} minted `{}` ${} tokens 💎 from the earned reward at the ratio `{}:1`",
                CONFIG.name, minted_tokens, CONFIG.token_symbol, ratio
            );
            self.distribution_reports.push(summary);
            for user in self.users.values_mut() {
                user.karma_donations.clear();
            }
        }
    }

    pub fn collect_new_rewards(&mut self) -> HashMap<UserId, u64> {
        let mut payouts = HashMap::default();

        for user in self.users.values_mut() {
            let rewards = user.take_positive_rewards();
            if rewards == 0 {
                continue;
            };
            // All miner rewards are burned.
            if user.miner {
                self.burned_cycles += rewards;
            } else {
                payouts.insert(user.id, rewards as Credits);
            }
        }

        payouts
    }

    async fn distribute_icp() {
        let treasury_balance = match invoices::account_balance(invoices::main_account()).await {
            Ok(balance) => balance.e8s(),
            Err(err) => {
                mutate(|state| {
                    state.logger.warn(format!(
                        "couldn't fetch the balance of main account: {}",
                        err
                    ));
                });
                return;
            }
        };

        let debt = mutate(|state| state.assign_rewards_and_revenue(time(), treasury_balance));

        if let Err(err) = canisters::icrc_transfer(
            MAINNET_LEDGER_CANISTER_ID,
            None,
            Account {
                owner: id(),
                subaccount: Some(USER_ICP_SUBACCOUNT.to_vec()),
            },
            debt as u128,
        )
        .await
        {
            mutate(|state| {
                state.logger.error(format!(
                    "user ICPs couldn't be transferred from the treasury: {err}"
                ))
            });
        }
    }

    fn assign_rewards_and_revenue(&mut self, now: Time, treasury_balance: u64) -> u64 {
        let (rewards, revenue, e8s_for_one_xdr) = (
            self.collect_new_rewards(),
            self.collect_revenue(now, self.e8s_for_one_xdr),
            self.e8s_for_one_xdr,
        );
        let rewards = rewards
            .iter()
            .map(|(id, donations)| {
                (
                    id,
                    (*donations as f64 / CONFIG.credits_per_xdr as f64 * e8s_for_one_xdr as f64)
                        as u64,
                )
            })
            .collect::<HashMap<_, _>>();
        let total_payout =
            rewards.values().copied().sum::<u64>() + revenue.values().copied().sum::<u64>();
        if total_payout == 0 {
            self.logger.info("No payouts to distribute...");
            return 0;
        }
        // We stop distributions if the treasury balance falls below the minimum balance.
        let minimal_treasury_balance = CONFIG.min_treasury_balance_xdrs * e8s_for_one_xdr;
        if treasury_balance < total_payout || treasury_balance < minimal_treasury_balance {
            self.logger
                .info("Treasury balance is too low; skipping the payouts...");
            return 0;
        }
        let mut total_rewards = 0;
        let mut total_revenue = 0;
        let mut summary = Summary {
            title: "Rewards report".into(),
            description: Default::default(),
            items: Vec::default(),
        };
        let mut items = Vec::default();
        for user in self.users.values_mut() {
            let mut user_revenue = revenue.get(&user.id).copied().unwrap_or_default();
            let _ = user.top_up_credits_from_revenue(&mut user_revenue, e8s_for_one_xdr);
            let user_reward = rewards.get(&user.id).copied().unwrap_or_default();
            let e8s = match user_reward.checked_add(user_revenue) {
                Some(0) | None => continue,
                Some(value) => value,
            };

            user.treasury_e8s = match user.treasury_e8s.checked_add(e8s) {
                Some(0) | None => continue,
                Some(value) => value,
            };
            total_rewards += user_reward;
            total_revenue += user_revenue;
            items.push((e8s, user.name.clone()));
            user.notify(format!(
                "You received `{}` ICP as rewards and `{}` ICP as revenue! 💸",
                display_tokens(user_reward, 8),
                display_tokens(user_revenue, 8)
            ));
        }
        if self.burned_cycles > 0 {
            self.spend(self.burned_cycles as Credits, "revenue distribution");
            self.burned_cycles_total += self.burned_cycles as Credits;
        }
        self.total_rewards_shared += total_rewards;
        self.total_revenue_shared += total_revenue;
        let supply_of_active_users = self.active_voting_power(time());
        let e8s_revenue_per_1k =
            total_revenue / (supply_of_active_users / 1000 / token::base()).max(1);
        self.last_revenues.push_back(e8s_revenue_per_1k);
        while self.last_revenues.len() > 12 {
            self.last_revenues.pop_front();
        }

        items.sort_by_cached_key(|(e8s, _)| Reverse(*e8s));
        for (e8s, name) in &items {
            summary
                .items
                .push(format!("`{}` to @{}", display_tokens(*e8s, 8), name));
        }

        summary.description = format!(
            "Weekly pay out to users: `{}` ICP as rewards and `{}` ICP as revenue.",
            display_tokens(total_rewards, 8),
            display_tokens(total_revenue, 8)
        );
        self.distribution_reports.push(summary);

        total_rewards + total_revenue
    }

    fn conclude_polls(&mut self, now: u64) {
        for post_id in self.pending_polls.clone() {
            match Post::conclude_poll(self, &post_id, now) {
                // The poll didn't end yet.
                Ok(false) => {}
                // The poll has ended, so it can be removed from pending ones.
                _ => {
                    self.pending_polls.remove(&post_id);
                }
            };
        }
    }

    pub fn compute_tag_subscribers(&mut self, now: Time) {
        self.tag_subscribers.clear();
        for user in self
            .users
            .values_mut()
            .filter(|user| user.active_within_weeks(now, 1))
        {
            for tag in user.feeds.iter().flatten() {
                self.tag_subscribers
                    .entry(tag.clone())
                    .and_modify(|subscribers| *subscribers += 1)
                    .or_insert(1);
            }
        }
    }

    async fn daily_chores(now: Time) {
        mutate(|state| {
            for proposal_id in state
                .proposals
                .iter()
                .filter_map(|p| (p.status == Status::Open).then_some(p.id))
                .collect::<Vec<_>>()
            {
                if let Err(err) = proposals::execute_proposal(state, proposal_id, now) {
                    state
                        .logger
                        .error(format!("couldn't execute last proposal: {:?}", err));
                }
            }

            if !state.emergency_binary.is_empty() {
                state.logger.info("An emergency release is pending! 🚨");
            }

            state.recompute_stalwarts(now);

            for user in state.users.values_mut() {
                user.downvotes.retain(|_, timestamp| {
                    *timestamp + CONFIG.downvote_counting_period_days * DAY >= now
                });
            }

            state.compute_tag_subscribers(now);
        });

        export_token_supply(token::icrc1_total_supply());
    }

    fn archive_cold_data(&mut self) -> Result<(), String> {
        let max_posts_in_heap = 10_000;
        archive_cold_posts(self, max_posts_in_heap)
    }

    async fn handle_nns_proposals(now: u64) {
        if !CONFIG.nns_voting_enabled {
            return;
        }

        // Vote on proposals if pending ones exist
        for (proposal_id, post_id) in read(|state| state.pending_nns_proposals.clone()) {
            if let Some(Extension::Poll(poll)) = read(|state| {
                Post::get(state, &post_id).and_then(|post| post.extension.as_ref().cloned())
            }) {
                // The poll is still pending.
                if read(|state| state.pending_polls.contains(&post_id)) {
                    continue;
                }

                let adopted = poll.weighted_by_tokens.get(&0).copied().unwrap_or_default();
                let rejected = poll.weighted_by_tokens.get(&1).copied().unwrap_or_default();
                if let Err(err) = canisters::vote_on_nns_proposal(
                    proposal_id,
                    if adopted > rejected {
                        NNSVote::Adopt
                    } else {
                        NNSVote::Reject
                    },
                )
                .await
                {
                    mutate(|state| {
                        state.logger.warn(format!(
                            "couldn't vote on NNS proposal {}: {}",
                            proposal_id, err
                        ))
                    });
                };
            }
            mutate(|state| state.pending_nns_proposals.remove(&post_id));
        }

        // fetch new proposals
        let last_known_proposal_id = read(|state| state.last_nns_proposal);
        let proposals = match canisters::fetch_proposals().await {
            Ok(value) => value,
            Err(err) => {
                mutate(|state| {
                    state
                        .logger
                        .warn(format!("couldn't fetch proposals: {}", err))
                });
                Default::default()
            }
        };

        for proposal in proposals
            .into_iter()
            .filter(|proposal| proposal.id > last_known_proposal_id)
        {
            // Vote only on proposals with topics network economics, governance, SNS & replica-management.
            if [3, 4, 13, 14].contains(&proposal.topic) {
                let post = format!(
                    "# #NNS-Proposal [{0}](https://dashboard.internetcomputer.org/proposal/{0})\n## {1}\n",
                    proposal.id, proposal.title,
                ) + &format!(
                    "Proposer: [{0}](https://dashboard.internetcomputer.org/neuron/{0})\n\n\n\n{1}",
                    proposal.proposer, proposal.summary
                );

                match mutate(|state| {
                    state.last_nns_proposal = state.last_nns_proposal.max(proposal.id);
                    Post::create(
                        state,
                        post,
                        Default::default(),
                        id(),
                        now,
                        None,
                        Some("NNS-GOV".into()),
                        Some(Extension::Poll(Poll {
                            deadline: 72,
                            options: vec!["ACCEPT".into(), "REJECT".into()],
                            ..Default::default()
                        })),
                    )
                }) {
                    Ok(post_id) => {
                        mutate(|state| state.pending_nns_proposals.insert(proposal.id, post_id));
                        continue;
                    }
                    Err(err) => {
                        mutate(|state| {
                            state.logger.warn(format!(
                                "couldn't create an NNS proposal post for proposal {}: {:?}",
                                proposal.id, err
                            ))
                        });
                    }
                };
            }

            if let Err(err) = canisters::vote_on_nns_proposal(proposal.id, NNSVote::Reject).await {
                mutate(|state| {
                    state.last_nns_proposal = state.last_nns_proposal.max(proposal.id);
                    state.logger.warn(format!(
                        "couldn't vote on NNS proposal {}: {}",
                        proposal.id, err
                    ))
                });
            };
        }
    }

    pub async fn fetch_xdr_rate() {
        if let Ok(e8s_for_one_xdr) = invoices::get_xdr_in_e8s().await {
            mutate(|state| state.e8s_for_one_xdr = e8s_for_one_xdr);
        }
    }

    pub async fn hourly_chores(now: u64) {
        mutate(|state| {
            if let Err(err) = state.archive_cold_data() {
                state
                    .logger
                    .error(format!("couldn't archive cold data: {:?}", err));
            }

            state.conclude_polls(now)
        });

        State::fetch_xdr_rate().await;

        State::top_up().await;

        State::handle_nns_proposals(now).await;
    }

    pub async fn chores(now: u64) {
        // This should always be the first operation executed in the chores routine so
        // that the upgrades are never blocked by a panic in any other routine.
        if mutate(|state| {
            state.execute_pending_emergency_upgrade(false) || state.execute_pending_upgrade(false)
        }) {
            return;
        }

        let (last_hourly_chores, last_daily_chores, last_weekly_chores) = read(|state| {
            (
                state.last_hourly_chores,
                state.last_daily_chores,
                state.last_weekly_chores,
            )
        });

        let log_time = |state: &mut State, frequency| {
            state.logger.debug(format!(
                "{} routine finished after `{}` ms.",
                frequency,
                (time() - now) / MILLISECOND
            ))
        };

        if last_weekly_chores + WEEK < now {
            State::weekly_chores(now).await;
            mutate(|state| {
                state.last_weekly_chores += WEEK;
                log_time(state, "Weekly");
            });
        }

        if last_daily_chores + DAY < now {
            State::daily_chores(now).await;
            mutate(|state| {
                state.last_daily_chores += DAY;
                log_time(state, "Daily");
            });
        }

        if last_hourly_chores + HOUR < now {
            State::hourly_chores(now).await;
            mutate(|state| {
                state.last_hourly_chores += HOUR;
                log_time(state, "Hourly");
            });
        }
    }

    pub async fn weekly_chores(now: Time) {
        mutate(|state| {
            state.distribution_reports.clear();
            state.distribute_realm_revenue(now);
        });

        // We only mint and distribute if no open proposals exists
        if read(|state| state.proposals.iter().all(|p| p.status != Status::Open)) {
            mutate(|state| {
                state.minting_mode = true;
                state.mint();
                state.minting_mode = false;
            });
            State::distribute_icp().await;
            mutate(|state| {
                for summary in &state.distribution_reports {
                    state.logger.info(format!(
                        "{}: {} [[details](#/distribution)]",
                        summary.title, summary.description
                    ));
                }
            });
        } else {
            mutate(|state| {
                state
                    .logger
                    .info("Skipping minting & distributions due to open proposals")
            });
        }

        mutate(|state| {
            state.clean_up(now);
            state.charge_for_inactivity(now);
        });
    }

    fn distribute_realm_revenue(&mut self, now: Time) {
        let mut summary = Summary {
            title: "Realm revenue report".into(),
            description: Default::default(),
            items: Vec::default(),
        };
        let mut total_revenue = 0;
        let mut items = Vec::default();
        for (realm_id, revenue, controllers) in self
            .realms
            .iter_mut()
            .filter(|(id, realm)| id.as_str() != CONFIG.dao_realm && realm.revenue > 0)
            .map(|(id, realm)| {
                (
                    id.clone(),
                    std::mem::take(&mut realm.revenue),
                    realm.controllers.clone(),
                )
            })
            .collect::<Vec<_>>()
        {
            let controllers = controllers
                .into_iter()
                .filter_map(|user_id| self.users.get(&user_id))
                .filter(|user| user.active_within_weeks(now, 1))
                .map(|user| (user.id, user.name.clone()))
                .collect::<Vec<_>>();
            let realm_revenue = revenue * CONFIG.realm_revenue_percentage as u64 / 100;
            let controller_revenue = realm_revenue / controllers.len().max(1) as u64;
            for (id, name) in &controllers {
                self.spend_to_user_rewards(
                    *id,
                    controller_revenue,
                    format!("revenue from realm /{}", &realm_id),
                );
                total_revenue += controller_revenue;
                items.push((controller_revenue, realm_id.clone(), name.clone()));
            }
        }

        items.sort_unstable_by_key(|(revenue, _, _)| Reverse(*revenue));
        for (controller_revenue, realm_id, name) in &items {
            summary.items.push(format!(
                "/{}: `{}` credits to @{}",
                realm_id, controller_revenue, name
            ));
        }
        summary.description = format!(
            "`{}` credits of realm revenue paid to active realm controllers",
            total_revenue
        );
        self.distribution_reports.push(summary);
    }

    fn clean_up(&mut self, now: Time) {
        for user in self.users.values_mut() {
            if user.active_within_weeks(now, 1) {
                user.active_weeks += 1;
            } else {
                user.active_weeks = 0;
            }
            let inactive = !user.active_within_weeks(now, CONFIG.inactivity_duration_weeks);
            if inactive || user.is_bot() {
                user.notifications.clear();
                user.accounting.clear();
            }
            if inactive && user.rewards() > 0 {
                user.change_rewards(
                    -(CONFIG.inactivity_penalty as i64).min(user.rewards()),
                    "inactivity_penalty".to_string(),
                );
            }
            user.post_reports
                .retain(|_, timestamp| *timestamp + CONFIG.user_report_validity_days * DAY >= now);
        }
        self.accounting.clean_up();
    }

    fn charge_for_inactivity(&mut self, now: u64) {
        let mut inactive_users = 0;
        let mut credits_total = 0;
        let inactive_user_balance_threshold = CONFIG.inactivity_penalty * 4;
        for (id, credits) in self
            .users
            .values()
            .filter(|user| {
                !user.active_within_weeks(now, CONFIG.inactivity_duration_weeks)
                    && user.credits() > inactive_user_balance_threshold
            })
            .map(|u| (u.id, u.credits()))
            .collect::<Vec<_>>()
        {
            let costs = CONFIG
                .inactivity_penalty
                .min(credits - inactive_user_balance_threshold);
            if let Err(err) = self.charge(id, costs, "inactivity penalty".to_string()) {
                self.logger
                    .warn(format!("Couldn't charge inactivity penalty: {:?}", err));
            } else {
                credits_total += costs;
                inactive_users += 1;
            }
        }
        self.logger.info(format!(
            "Charged `{}` inactive users with `{}` credits.",
            inactive_users, credits_total
        ));
    }

    fn recompute_stalwarts(&mut self, now: u64) {
        let mut balances = self
            .users
            .values()
            .map(|user| (user.id, user.total_balance()))
            .collect::<Vec<_>>();
        balances.sort_unstable_by_key(|(_, balance)| Reverse(*balance));

        let users = self.users.values_mut().collect::<Vec<_>>();

        let mut stalwart_seats = (users.len() * CONFIG.stalwart_percentage / 100).max(3);
        let top_balances = balances
            .into_iter()
            .take(stalwart_seats)
            .collect::<BTreeMap<_, _>>();
        let mut left = Vec::new();
        let mut joined = Vec::new();
        let mut left_logs = Vec::new();
        let mut joined_logs = Vec::new();

        for u in users {
            if !u.governance
                || u.is_bot()
                || u.controversial()
                || now.saturating_sub(u.timestamp)
                    < WEEK * CONFIG.min_stalwart_account_age_weeks as u64
            {
                u.stalwart = false;
                continue;
            }
            match (
                u.stalwart,
                u.active_weeks >= CONFIG.min_stalwart_activity_weeks as u32,
                top_balances.is_empty() || top_balances.contains_key(&u.id),
                stalwart_seats,
            ) {
                // User is qualified but no seats left
                (true, true, true, 0) => {
                    u.stalwart = false;
                    left.push(u.id);
                    left_logs.push(format!("@{} (outcompeted)", u.name));
                }
                // A user is qualified and is already a stalwart and seats available
                (true, true, true, _) => {
                    stalwart_seats = stalwart_seats.saturating_sub(1);
                }
                // User is qualified but not enough balance
                (true, true, false, _) => {
                    u.stalwart = false;
                    left.push(u.id);
                    left_logs.push(format!("@{} (balance)", u.name));
                }
                // A user is a stalwart but became inactive
                (true, false, _, _) => {
                    u.stalwart = false;
                    left.push(u.id);
                    left_logs.push(format!("@{} (inactivity)", u.name));
                }
                // A user is not a stalwart, but qualified and there are seats left
                (false, true, true, seats) if seats > 0 => {
                    u.stalwart = true;
                    joined.push(u.id);
                    joined_logs.push(format!("@{}", u.name));
                    stalwart_seats = stalwart_seats.saturating_sub(1);
                    u.notify(format!(
                        "Congratulations! You are a {} stalwart now!",
                        CONFIG.name
                    ));
                }
                _ => {}
            };
        }

        if joined.is_empty() && left.is_empty() {
            return;
        }

        if let Some(realm) = self.realms.get_mut(CONFIG.dao_realm) {
            for user_id in joined {
                realm.controllers.insert(user_id);
            }
            for user_id in left {
                realm.controllers.remove(&user_id);
            }
        }

        self.logger.info(format!(
            "Stalwart election ⚔️: {} joined; {} have left; `{}` seats vacant.",
            if joined_logs.is_empty() {
                "no new users".to_string()
            } else {
                joined_logs.join(", ")
            },
            if left_logs.is_empty() {
                "no users".to_string()
            } else {
                left_logs.join(", ")
            },
            stalwart_seats
        ));
    }

    pub async fn withdraw_rewards(principal: Principal) -> Result<(), String> {
        let fee = invoices::fee().e8s();
        let (user_id, principal, rewards) = mutate(|state| {
            let user = state
                .principal_to_user_mut(principal)
                .ok_or("no user found".to_string())?;

            let id = user.id;
            let principal = user.principal;
            let rewards = user
                .treasury_e8s
                .checked_sub(fee)
                .ok_or("funds smaller than the fee".to_string())?;

            user.treasury_e8s = 0;

            Ok::<(u64, candid::Principal, u64), String>((id, principal, rewards))
        })?;

        if let Err(err) = icrc_transfer(
            MAINNET_LEDGER_CANISTER_ID,
            Some(USER_ICP_SUBACCOUNT.to_vec()),
            account(principal),
            rewards as u128,
        )
        .await
        {
            mutate(|state| {
                if let Some(user) = state.users.get_mut(&user_id) {
                    user.treasury_e8s += rewards
                }
            });
            return Err(err);
        }
        Ok(())
    }

    pub async fn mint_credits(principal: Principal, kilo_credits: u64) -> Result<Invoice, String> {
        if kilo_credits > CONFIG.max_credits_mint_kilos {
            return Err(format!(
                "can't mint more than {} thousands of credits",
                CONFIG.max_credits_mint_kilos
            ));
        }

        let e8s_for_one_xdr = read(|state| state.e8s_for_one_xdr);
        let invoice = Invoices::outstanding(&principal, kilo_credits, e8s_for_one_xdr).await?;

        mutate(|state| {
            if invoice.paid {
                if let Some(user) = state.principal_to_user_mut(principal) {
                    user.change_credits(
                        ((invoice.paid_e8s as f64 / invoice.e8s as f64)
                            * CONFIG.credits_per_xdr as f64) as Credits,
                        CreditsDelta::Plus,
                        "top up with ICP".to_string(),
                    )?;
                    state.accounting.close(&principal);
                }
            }
            Ok(invoice)
        })
    }

    pub fn validate_username(&self, name: &str) -> Result<(), String> {
        let name = name.to_lowercase();
        if self.users.values().any(|user| {
            std::iter::once(&user.name)
                .chain(user.previous_names.iter())
                .map(|name| name.to_lowercase())
                .any(|existing_name| existing_name == name)
        }) {
            return Err("taken".into());
        }
        if name.len() < 2 || name.len() > 16 {
            return Err("should be between 2 and 16 characters".into());
        }
        if !name
            .chars()
            .all(|c| char::is_ascii(&c) && char::is_alphanumeric(c))
        {
            return Err("should be a latin alpha-numeric string".into());
        }
        if name
            .chars()
            .next()
            .map(|c| !char::is_ascii_alphabetic(&c))
            .unwrap_or_default()
        {
            return Err("first character can't be a number".into());
        }
        if name.chars().all(|c| char::is_ascii_digit(&c)) {
            return Err("should have at least one character".into());
        }
        if ["all", "stalwarts", "dao"].contains(&name.as_str()) {
            return Err("reserved handle".into());
        }
        Ok(())
    }

    pub fn posts_by_tags(
        &self,
        realm: Option<RealmId>,
        tags: Vec<String>,
        users: Vec<UserId>,
        page: usize,
        offset: PostId,
    ) -> Box<dyn Iterator<Item = &'_ Post> + '_> {
        let query: HashSet<_> = tags.into_iter().map(|tag| tag.to_lowercase()).collect();
        Box::new(
            self.posts_with_tags(realm, offset, true)
                .filter(move |post| {
                    (users.is_empty() || users.contains(&post.user))
                        && post
                            .tags
                            .iter()
                            .map(|tag| tag.to_lowercase())
                            .collect::<HashSet<_>>()
                            .is_superset(&query)
                })
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size),
        )
    }

    fn posts_with_tags<'a>(
        &'a self,
        realm_id: Option<RealmId>,
        offset: PostId,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        Box::new(
            self.posts_with_tags
                .iter()
                .rev()
                .skip_while(move |post_id| offset > 0 && *post_id > &offset)
                .filter_map(move |i| Post::get(self, i))
                .filter(move |post| {
                    !post.is_deleted()
                        && (with_comments || post.parent.is_none())
                        && (realm_id.is_none() || post.realm == realm_id)
                }),
        )
    }

    pub fn last_posts<'a>(
        &'a self,
        realm_id: Option<RealmId>,
        offset: PostId,
        genesis: Time,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let iter: Box<dyn Iterator<Item = _>> =
            match realm_id.and_then(|realm_id| self.realms.get(&realm_id)) {
                Some(realm) => Box::new(
                    realm
                        .posts
                        .iter()
                        .rev()
                        .skip_while(move |post_id| offset > 0 && *post_id > &offset)
                        .copied(),
                ),
                _ => {
                    if with_comments {
                        let last_id = if offset > 0 {
                            offset
                        } else {
                            self.next_post_id
                        };
                        Box::new((0..last_id).rev())
                    } else {
                        Box::new(
                            self.root_posts_index
                                .iter()
                                .rev()
                                .skip_while(move |post_id| offset > 0 && *post_id > &offset)
                                .copied(),
                        )
                    }
                }
            };
        Box::new(
            iter.filter_map(move |i| Post::get(self, &i))
                .take_while(move |post| post.creation_timestamp() >= genesis)
                .filter(move |post| !post.is_deleted()),
        )
    }

    pub fn recent_tags(&self, realm: Option<RealmId>, n: u64) -> Vec<(String, u64)> {
        let mut tags: HashMap<String, u64> = Default::default();
        let mut tags_found = 0;
        'OUTER: for post in self
            .posts_with_tags(realm, 0, true)
            .take_while(|post| !post.archived)
        {
            for tag in &post.tags {
                let counter = tags.entry(tag.clone()).or_insert(0);
                // We only count tags occurrences on root posts, if they have comments or reactions
                if post.parent.is_some() || post.reactions.is_empty() && post.children.is_empty() {
                    continue;
                }
                *counter += 1;
                if *counter == 2 {
                    tags_found += 1;
                }
            }
            if tags_found >= n {
                break 'OUTER;
            }
        }
        tags.into_iter().filter(|(_, count)| *count > 1).collect()
    }

    /// Returns an iterator of posts from the root post to the post `id`.
    pub fn thread(&self, id: PostId) -> Box<dyn Iterator<Item = PostId>> {
        let mut result = Vec::new();
        let mut curr = id;
        while let Some(Post { id, parent, .. }) = Post::get(self, &curr) {
            result.push(*id);
            if let Some(parent_id) = parent {
                curr = *parent_id
            } else {
                break;
            }
        }
        Box::new(result.into_iter().rev())
    }

    pub fn user(&self, handle: &str) -> Option<&User> {
        match Principal::from_text(handle) {
            Ok(principal) => self.principal_to_user(principal),
            _ => handle
                .parse::<u64>()
                .ok()
                .and_then(|id| self.users.get(&id))
                .or_else(|| {
                    self.users.values().find(|user| {
                        std::iter::once(&user.name)
                            .chain(user.previous_names.iter())
                            .any(|name| name.to_lowercase() == handle.to_lowercase())
                    })
                }),
        }
    }

    pub fn change_principal(&mut self, new_principal: Principal) -> Result<bool, String> {
        let old_principal = match self.principal_change_requests.remove(&new_principal) {
            Some(value) => value,
            None => return Ok(false),
        };
        if self.voted_on_pending_proposal(old_principal) {
            return Err("pending proposal with the current principal as voter exists".into());
        }
        if new_principal == Principal::anonymous() {
            return Err("wrong principal".into());
        }
        if self.principals.contains_key(&new_principal) {
            return Err("principal already assigned to a user".to_string());
        }
        let old_account = account(old_principal);
        let balance = self.balances.get(&old_account).copied().unwrap_or_default();
        let fee = token::icrc1_fee();
        if 0 < balance && balance <= fee as Token {
            return Err("token balance is lower than the fee".to_string());
        }
        let user_id = self
            .principals
            .remove(&old_principal)
            .ok_or("no principal found")?;
        self.principals.insert(new_principal, user_id);
        let user = self.users.get_mut(&user_id).expect("no user found");
        assert_eq!(user.principal, old_principal);
        user.principal = new_principal;
        user.account = AccountIdentifier::new(&new_principal, &DEFAULT_SUBACCOUNT).to_string();
        token::transfer(
            self,
            time(),
            old_account.owner,
            TransferArgs {
                from_subaccount: old_account.subaccount.clone(),
                to: account(new_principal),
                amount: balance.saturating_sub(fee as Token) as u128,
                fee: Some(fee),
                memo: Default::default(),
                created_at_time: None,
            },
        )
        .expect("transfer failed");
        Ok(true)
    }

    pub fn principal_to_user(&self, principal: Principal) -> Option<&User> {
        self.principals
            .get(&principal)
            .and_then(|id| self.users.get(id))
    }

    pub fn principal_to_user_mut(&mut self, principal: Principal) -> Option<&mut User> {
        let id = self.principals.get(&principal)?;
        self.users.get_mut(id)
    }

    fn new_user_id(&mut self) -> UserId {
        let id = self.next_user_id;
        self.next_user_id += 1;
        id
    }

    fn new_post_id(&mut self) -> PostId {
        let id = self.next_post_id;
        self.next_post_id += 1;
        id
    }

    pub fn logs(&self) -> Box<dyn Iterator<Item = &'_ Event> + '_> {
        Box::new(self.logger.events.values().flatten())
    }

    pub fn recovery_state(&self) -> (String, Vec<Principal>) {
        let emergency_votes = self.emergency_votes.values().sum::<Token>() as f32
            / self.active_voting_power(time()).max(1) as f32
            * 100.0;
        let emergency_release = format!(
            "Binary set: {}, votes: {}% (required: {}%)",
            !self.emergency_binary.is_empty(),
            emergency_votes as u32,
            CONFIG.proposal_approval_threshold
        );
        (
            emergency_release,
            self.emergency_votes.keys().cloned().collect(),
        )
    }

    pub fn stats(&self, now: Time) -> Stats {
        let mut stalwarts = Vec::new();
        let mut users_online = 0;
        let mut invited_users = 0;
        let mut active_users = 0;
        let mut bots = Vec::new();
        let mut credits = 0;
        for user in self.users.values() {
            if user.stalwart {
                stalwarts.push(user);
            }
            if now < user.last_activity + CONFIG.online_activity_minutes {
                users_online += 1;
            }
            if user.is_bot() {
                bots.push(user.id);
            }
            if user.invited_by.is_some() {
                invited_users += 1;
            }
            if user.active_within_weeks(now, 1) {
                active_users += 1;
            }
            credits += user.credits();
        }
        stalwarts.sort_unstable_by_key(|u| u.id);
        let posts = self.root_posts_index.len();
        let volume_day = self
            .ledger
            .iter()
            .rev()
            .take_while(|tx| tx.timestamp + DAY >= now)
            .map(|tx| tx.amount)
            .sum();
        let volume_week = self
            .ledger
            .iter()
            .rev()
            .take_while(|tx| tx.timestamp + WEEK >= now)
            .map(|tx| tx.amount)
            .sum();
        let fees_burned = self.ledger.iter().map(|tx| tx.fee).sum();

        Stats {
            fees_burned,
            volume_day,
            volume_week,
            minting_ratio: self.minting_ratio(),
            e8s_for_one_xdr: self.e8s_for_one_xdr,
            e8s_revenue_per_1k: self.last_revenues.iter().sum::<u64>()
                / self.last_revenues.len().max(1) as u64,
            team_tokens: self.team_tokens.clone(),
            meta: format!("Memory health: {}", self.memory.health("MB")),
            module_hash: self.module_hash.clone(),
            canister_id: ic_cdk::id(),
            last_upgrade: self.last_upgrade,
            last_weekly_chores: self.last_weekly_chores,
            last_daily_chores: self.last_daily_chores,
            last_hourly_chores: self.last_hourly_chores,
            canister_cycle_balance: canister_balance(),
            users: self.users.len(),
            posts,
            comments: Post::count(self) - posts,
            credits,
            burned_credits: self.burned_cycles,
            burned_credits_total: self.burned_cycles_total,
            total_revenue_shared: self.total_revenue_shared,
            total_rewards_shared: self.total_rewards_shared,
            account: invoices::main_account().to_string(),
            users_online,
            stalwarts: stalwarts.into_iter().map(|u| u.id).collect(),
            bots,
            state_size: stable64_size() << 16,
            invited_users,
            active_users,
            circulating_supply: self.balances.values().sum(),
            buckets: self
                .storage
                .buckets
                .iter()
                .map(|(id, size)| (id.to_string(), *size))
                .collect(),
        }
    }

    pub fn vote_on_report(
        &mut self,
        principal: Principal,
        domain: String,
        id: u64,
        vote: bool,
    ) -> Result<(), String> {
        let reporter = self.principal_to_user(principal).ok_or("no user found")?;
        let reporter_id = reporter.id;
        if !reporter.stalwart {
            return Err("only stalwarts can vote on reports".into());
        }
        let stalwarts = self.users.values().filter(|u| u.stalwart).count();
        let (user_id, report, penalty, subject) = match domain.as_str() {
            "post" => Post::mutate(
                self,
                &id,
                |post| -> Result<(UserId, Report, Credits, String), String> {
                    post.vote_on_report(stalwarts, reporter_id, vote)?;
                    let post_user = post.user;
                    let post_report = post.report.clone().ok_or("no report")?;
                    Ok((
                        post_user,
                        post_report,
                        CONFIG.reporting_penalty_post,
                        format!("post [{0}](#/post/{0})", id),
                    ))
                },
            )?,
            "misbehaviour" => {
                if reporter_id == id {
                    return Err("votes on own reports are not accepted".into());
                }
                let report = self
                    .users
                    .get_mut(&id)
                    .and_then(|u| u.report.as_mut())
                    .ok_or("no user found")?;
                report.vote(stalwarts, reporter_id, vote)?;
                (
                    id,
                    report.clone(),
                    CONFIG.reporting_penalty_misbehaviour,
                    format!("user [{0}](#/user/{0})", id),
                )
            }
            _ => return Err("unknown report type".into()),
        };
        if report.closed {
            if domain == "post" && report.rejected() {
                self.users
                    .get_mut(&user_id)
                    .expect("no user found")
                    .post_reports
                    .remove(&id);
            }
            reports::finalize_report(self, &report, &domain, penalty, user_id, subject)
        } else {
            Ok(())
        }
    }

    pub fn vote_on_poll(
        &mut self,
        principal: Principal,
        time: u64,
        post_id: PostId,
        vote: u16,
        anonymously: bool,
    ) -> Result<(), String> {
        let user = self
            .principal_to_user(principal)
            .ok_or_else(|| "no user found".to_string())?;
        let (user_id, user_realms) = (user.id, user.realms.clone());
        Post::mutate(self, &post_id, |post| {
            post.vote_on_poll(user_id, user_realms.clone(), time, vote, anonymously)
        })
    }

    pub fn report(
        &mut self,
        principal: Principal,
        domain: String,
        id: u64,
        reason: String,
    ) -> Result<(), String> {
        if reason.len() > CONFIG.max_report_length {
            return Err("reason too long".into());
        }
        let credits_required = if domain == "post" {
            CONFIG.reporting_penalty_post
        } else {
            CONFIG.reporting_penalty_misbehaviour
        } / 2;
        let user_id = match self.principal_to_user(principal) {
            Some(user) if user.total_balance() < 10 * CONFIG.transaction_fee => {
                return Err("no reports with low token balance".into())
            }
            Some(user) if user.rewards() < 0 => {
                return Err("no reports with negative reward balance possible".into())
            }
            Some(user) if user.credits() >= credits_required => user.id,
            _ => {
                return Err(format!(
                    "at least {} credits needed for this report",
                    credits_required
                ))
            }
        };
        let report = Report {
            reporter: user_id,
            reason,
            timestamp: time(),
            ..Default::default()
        };

        match domain.as_str() {
            "post" => {
                let post_user = Post::mutate(self, &id, |post| {
                    if post.report.as_ref().map(|r| !r.closed).unwrap_or_default() {
                        return Err("this post is already reported".into());
                    }
                    post.report = Some(report.clone());
                    Ok(post.user)
                })?;
                self.notify_with_predicate(
                    &|u| u.stalwart && u.id != user_id,
                    "This post was reported. Please review the report!",
                    Predicate::ReportOpen(id),
                );
                let post_author = self.users.get_mut(&post_user).expect("no user found");
                post_author.post_reports.insert(id, time());
                post_author.notify(format!(
                    "Your [post](#/post/{}) was reported. Consider deleting it to avoid rewards and credit penalties. The reason for the report: {}",
                    id, &report.reason
                ));
            }
            "misbehaviour" => {
                let misbehaving_user = self.users.get_mut(&id).ok_or("no user found")?;
                if misbehaving_user
                    .report
                    .as_ref()
                    .map(|r| !r.closed)
                    .unwrap_or_default()
                {
                    return Err("this user is already reported".into());
                }
                misbehaving_user.report = Some(report);
                let user_name = misbehaving_user.name.clone();
                self.notify_with_predicate(
                    &|u| u.stalwart && u.id != id,
                    format!("The user @{} was reported. Please open their profile and review the report!", user_name),
                    Predicate::UserReportOpen(id),
                );
            }
            _ => unimplemented!(),
        }

        Ok(())
    }

    pub fn delete_post(
        &mut self,
        principal: Principal,
        post_id: PostId,
        versions: Vec<String>,
    ) -> Result<(), String> {
        let post = Post::get(self, &post_id).ok_or("no post found")?.clone();
        if self.principal_to_user(principal).map(|user| user.id) != Some(post.user) {
            return Err("not authorized".into());
        }

        let has_open_report = post.report.map(|report| !report.closed).unwrap_or_default();

        let comments_tree_penalty =
            post.tree_size as Credits * CONFIG.post_deletion_penalty_factor as Credits;
        let rewards = config::reaction_rewards();
        let reaction_costs = post
            .reactions
            .iter()
            .filter_map(|(r_id, users)| {
                let cost = rewards.get(r_id).copied().unwrap_or_default();
                (cost > 0).then_some((users, cost as Credits))
            })
            .collect::<Vec<_>>();

        let costs: Credits = CONFIG.post_cost
            + reaction_costs.iter().map(|(_, cost)| *cost).sum::<u64>()
            + comments_tree_penalty;
        if costs > self.users.get(&post.user).ok_or("no user found")?.credits() {
            return Err(format!(
                "not enough credits (this post requires {} credits to be deleted)",
                costs
            ));
        }

        let mut rewards_penalty = post.children.len() as i64 * CONFIG.response_reward as i64;

        // refund rewards
        for (users, amount) in reaction_costs {
            for user_id in users {
                self.credit_transfer(
                    post.user,
                    *user_id,
                    amount,
                    0,
                    Destination::Credits,
                    format!("rewards refund after deletion of post {}", post.id),
                    None,
                )?;
                rewards_penalty = rewards_penalty.saturating_add(amount as i64);
            }
        }

        // penalize for comments tree destruction
        self.charge_in_realm(
            post.user,
            CONFIG.post_cost + comments_tree_penalty,
            post.realm.as_ref(),
            format!("deletion of post [{0}](#/post/{0})", post.id),
        )?;

        // subtract all rewards from rewards
        let user = self.users.get_mut(&post.user).expect("no user found");
        user.change_rewards(
            -rewards_penalty,
            format!("deletion of post [{0}](#/post/{0})", post.id),
        );
        user.post_reports.remove(&post.id);

        match &post.extension {
            Some(Extension::Proposal(proposal_id)) => {
                if let Some(proposal) = self.proposals.iter_mut().find(|p| &p.id == proposal_id) {
                    proposal.status = Status::Cancelled
                }
            }
            Some(Extension::Poll(_)) => {
                self.pending_polls.remove(&post_id);
            }
            _ => {}
        };

        Post::mutate(self, &post_id, |post| {
            post.delete(versions.clone());
            Ok(())
        })
        .expect("couldn't delete post");

        if has_open_report {
            self.denotify_users(&|u| u.stalwart);
        }

        Ok(())
    }

    pub fn react(
        &mut self,
        principal: Principal,
        post_id: PostId,
        reaction: u16,
        time: Time,
    ) -> Result<(), String> {
        let delta: i64 = match CONFIG.reactions.iter().find(|(id, _)| id == &reaction) {
            Some((_, delta)) => *delta,
            _ => return Err("unknown reaction".into()),
        };
        let user = self
            .principal_to_user(principal)
            .ok_or("no user for principal found")?;
        let user_id = user.id;
        let user_credits = user.credits();
        let user_balance = user.total_balance();
        let user_controversial = user.controversial();
        let post = Post::get(self, &post_id).ok_or("post not found")?.clone();
        if post.is_deleted() {
            return Err("post deleted".into());
        }
        if post.user == user.id {
            return Err("reactions to own posts are forbidden".into());
        }
        if post
            .reactions
            .values()
            .flatten()
            .any(|user_id| user_id == &user.id)
        {
            return Err("multiple reactions are forbidden".into());
        }

        let log = format!("reaction to post [{0}](#/post/{0})", post_id);
        // Users initiate a credit transfer for upvotes, but burn their own credits on
        // downvotes + credits and rewards of the author
        if delta < 0 {
            if user_controversial {
                return Err(
                    "no downvotes for users with pending reports or negative reward balance".into(),
                );
            }
            if user.balance < token::base() {
                return Err("no downvotes for users with low token balance".into());
            }
            if self
                .users
                .get(&post.user)
                .map(|user| user.blacklist.contains(&user_id))
                .unwrap_or_default()
            {
                return Err("you cannot react on posts of users who blocked you".into());
            }

            let user = self.users.get_mut(&post.user).expect("user not found");
            user.change_rewards(delta, log.clone());
            user.downvotes.insert(user_id, time);
            self.charge_in_realm(
                user_id,
                delta.unsigned_abs().min(user_credits),
                post.realm.as_ref(),
                log.clone(),
            )?;
            self.charge_in_realm(
                post.user,
                delta
                    .unsigned_abs()
                    .min(self.users.get(&post.user).expect("no user found").credits()),
                post.realm.as_ref(),
                log,
            )
            .expect("couldn't charge user");
        } else {
            let mut recipients = vec![post.user];
            if let Some(Extension::Repost(post_id)) = post.extension.as_ref() {
                let original_author = Post::get(self, post_id)
                    .expect("no reposted post found")
                    .user;
                if original_author != user_id {
                    recipients.push(original_author)
                }
            }
            let eff_delta = (delta / recipients.len() as i64) as Credits;
            let fee = config::reaction_fee(reaction);
            let eff_fee = fee / recipients.len() as Credits;
            // If delta is not divisible by 2, the original post author gets the rest
            let params = vec![
                (eff_delta, eff_fee),
                (
                    eff_delta
                        + delta.saturating_sub(recipients.len() as i64 * eff_delta as i64)
                            as Credits,
                    eff_fee + fee.saturating_sub(recipients.len() as u64 * eff_fee) as Credits,
                ),
            ];

            for (recipient, (delta, fee)) in recipients.iter().zip(params) {
                self.credit_transfer(
                    user_id,
                    *recipient,
                    delta,
                    fee,
                    Destination::Rewards,
                    log.clone(),
                    None,
                )?;
                self.principal_to_user_mut(principal)
                    .expect("no user for principal found")
                    .karma_donations
                    .entry(*recipient)
                    .and_modify(|donated| *donated = donated.saturating_add(delta))
                    .or_insert(delta);
            }
        }

        self.principal_to_user_mut(principal)
            .expect("no user for principal found")
            .last_activity = time;
        Post::mutate(self, &post_id, |post| {
            post.reactions.entry(reaction).or_default().insert(user_id);
            if !user_controversial {
                post.make_hot(user_id, user_balance);
            }
            Ok(())
        })
    }

    pub fn toggle_following_user(&mut self, principal: Principal, followee_id: UserId) -> bool {
        let (added, (user_id, name, about, num_followers, user_filter)) = {
            let user = match self.principal_to_user_mut(principal) {
                Some(user) => user,
                _ => return false,
            };
            if user.id == followee_id {
                return false;
            }
            (
                if user.followees.contains(&followee_id) {
                    user.followees.remove(&followee_id);
                    false
                } else {
                    user.followees.insert(followee_id);
                    user.filters.users.remove(&followee_id);
                    true
                },
                (
                    user.id,
                    user.name.clone(),
                    user.about.clone(),
                    user.followers.len(),
                    user.get_filter(),
                ),
            )
        };
        let followee = self.users.get_mut(&followee_id).expect("User not found");
        let about = if about.is_empty() { "no info" } else { &about };
        if added {
            followee.followers.insert(user_id);
            if followee.accepts(user_id, &user_filter) {
                followee.notify(format!(
                    "@{} followed you ({}, `{}` followers)",
                    name, about, num_followers
                ));
            }
        } else {
            followee.followers.remove(&user_id);
        }
        added
    }

    pub fn migrate(
        &mut self,
        principal: Principal,
        new_principal_str: String,
    ) -> Result<(), String> {
        if self.voted_on_pending_proposal(principal) {
            return Err("pending proposal with the current principal as voter exists".into());
        }
        let new_principal = Principal::from_text(new_principal_str).map_err(|e| e.to_string())?;
        if new_principal == Principal::anonymous() {
            return Err("wrong principal".into());
        }
        if self.principal_to_user(new_principal).is_some() {
            return Err("principal already assigned to a user".into());
        }
        if self
            .ledger
            .iter()
            .any(|tx| tx.to.owner == new_principal || tx.from.owner == new_principal)
        {
            return Err("this principal cannot be used".into());
        }

        let old_balance = self
            .balances
            .get(&account(principal))
            .copied()
            .unwrap_or_default();
        let all_balances = self.balances.values().sum::<Token>();

        let user_id = self
            .principals
            .remove(&principal)
            .ok_or("no principal found")?;
        if self.migrations.contains(&user_id) {
            return Err("this user has migrated".into());
        }

        self.principals.insert(new_principal, user_id);

        let user = self.users.get_mut(&user_id).expect("no user found");
        assert_eq!(user.principal, principal, "unexpected old principal");

        user.principal = new_principal;
        user.account = AccountIdentifier::new(&new_principal, &DEFAULT_SUBACCOUNT).to_string();
        for tx in &mut self.ledger {
            if tx.to.owner == principal {
                tx.to.owner = new_principal;
            }
            if tx.from.owner == principal {
                tx.from.owner = new_principal;
            }
        }
        match token::balances_from_ledger(&self.ledger) {
            Ok(balances) => {
                let user = self.users.get_mut(&user_id).expect("no user found");
                user.balance = balances
                    .get(&account(user.principal))
                    .copied()
                    .unwrap_or_default();
                user.cold_balance = user
                    .cold_wallet
                    .and_then(|principal| balances.get(&account(principal)).copied())
                    .unwrap_or_default();
                self.balances = balances;
            }
            Err(err) => panic!("can't migrate: {:?}", err),
        }

        assert_eq!(
            old_balance,
            self.balances
                .get(&account(new_principal))
                .copied()
                .unwrap_or_default()
        );
        assert_eq!(all_balances, self.balances.values().sum::<Token>());
        self.migrations.insert(user_id);
        Ok(())
    }
}

// Checks if any feed represents the superset for the given tag set.
// The `strict` option requires the sets to be equal.
fn covered_by_feeds(
    feeds: &[BTreeSet<String>],
    tags: &BTreeSet<String>,
    strict: bool,
) -> Option<usize> {
    for (i, feed) in feeds.iter().enumerate() {
        if strict && tags.len() != feed.len() {
            continue;
        }
        if feed.iter().all(|tag| tags.contains(tag)) {
            return Some(i);
        }
    }
    None
}

pub fn parse_amount(amount: &str, token_decimals: u8) -> Result<u64, String> {
    let parse = |s: &str| {
        s.parse::<u64>()
            .map_err(|err| format!("couldn't parse as u64: {:?}", err))
    };
    match &amount.split('.').collect::<Vec<_>>().as_slice() {
        [tokens] => Ok(parse(tokens)? * 10_u64.pow(token_decimals as u32)),
        [tokens, after_comma] => {
            let mut after_comma = after_comma.to_string();
            while after_comma.len() < token_decimals as usize {
                after_comma.push('0');
            }
            let after_comma = &after_comma[..token_decimals as usize];
            Ok(parse(tokens)? * 10_u64.pow(token_decimals as u32) + parse(after_comma)?)
        }
        _ => Err(format!("can't parse amount {}", amount)),
    }
}

pub fn display_tokens(amount: u64, decimals: u32) -> String {
    let base = 10_u64.pow(decimals);
    if decimals == 8 {
        format!("{}.{:08}", amount / base, (amount % base) as usize)
    } else {
        format!("{}.{:02}", amount / base, (amount % base) as usize)
    }
}

#[cfg(test)]
pub(crate) mod tests {

    use super::*;
    use crate::STATE;
    use post::Post;

    pub fn pr(n: u8) -> Principal {
        let v = vec![0, n];
        Principal::from_slice(&v)
    }

    fn create_realm(state: &mut State, user: Principal, name: String) -> Result<(), String> {
        let realm = Realm {
            description: "Test description".into(),
            controllers: vec![0].into_iter().collect(),
            ..Default::default()
        };
        state.create_realm(user, name, realm)
    }

    pub fn create_user(state: &mut State, p: Principal) -> UserId {
        create_user_with_params(state, p, &p.to_string().replace('-', ""), 1000)
    }

    pub fn create_user_with_credits(state: &mut State, p: Principal, credits: Credits) -> UserId {
        create_user_with_params(state, p, &p.to_string().replace('-', ""), credits)
    }

    pub fn insert_balance(state: &mut State, principal: Principal, amount: Token) {
        state.minting_mode = true;
        token::mint(state, account(principal), amount);
        state.minting_mode = false;
        if let Some(user) = state.principal_to_user_mut(principal) {
            user.balance = amount;
            user.change_rewards((amount / token::base()) as i64, "");
        }
    }

    fn create_user_with_params(
        state: &mut State,
        p: Principal,
        name: &str,
        credits: Credits,
    ) -> UserId {
        state
            .new_user(p, 0, name.to_string(), Some(credits))
            .unwrap()
    }

    #[test]
    fn test_active_voting_power() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            for i in 0..3 {
                create_user(state, pr(i));
                insert_balance(state, pr(i), (((i + 1) as u64) << 2) * 10000);
            }

            let voters = state.active_voters(0).collect::<BTreeMap<_, _>>();
            assert_eq!(*voters.get(&0).unwrap(), (1 << 2) * 10000);
            assert_eq!(*voters.get(&1).unwrap(), (2 << 2) * 10000);
            assert_eq!(*voters.get(&2).unwrap(), (3 << 2) * 10000);

            // link cold wallet
            let cold_balance = 1000000;
            insert_balance(state, pr(200), cold_balance);
            let user = state.users.get(&1).unwrap();
            assert_eq!(user.total_balance(), 80000);
            assert_eq!(state.principals.len(), 3);
            state.link_cold_wallet(pr(200), 1).unwrap();
            assert_eq!(state.principals.len(), 4);
            assert_eq!(state.principal_to_user(pr(200)).unwrap().id, 1);
            let user = state.users.get(&1).unwrap();
            assert_eq!(user.total_balance(), 80000 + cold_balance);
            assert_eq!(
                state.link_cold_wallet(pr(200), 0),
                Err("this wallet is linked already".into())
            );
            let voters = state.active_voters(0).collect::<BTreeMap<_, _>>();
            assert_eq!(*voters.get(&1).unwrap(), (2 << 2) * 10000 + cold_balance);

            state.proposals.push(Proposal {
                id: 0,
                proposer: 0,
                timestamp: 0,
                post_id: 0,
                status: Status::Open,
                payload: Payload::Noop,
                bulletins: vec![(1, false, 1000)],
                voting_power: 1000000,
            });
            assert_eq!(
                state.unlink_cold_wallet(pr(200)),
                Err("a vote on a pending proposal detected".into())
            );

            state.proposals[0].status = Status::Executed;
            assert!(state.unlink_cold_wallet(pr(200)).is_ok(),);
            let user = state.principal_to_user(pr(1)).unwrap();
            assert_eq!(user.id, 1);
            assert!(user.cold_wallet.is_none());
            assert_eq!(state.principals.len(), 3);

            let voters = state.active_voters(0).collect::<BTreeMap<_, _>>();
            assert_eq!(*voters.get(&1).unwrap(), (2 << 2) * 10000);

            // check user acitivity
            let now = 4 * WEEK;
            state.principal_to_user_mut(pr(1)).unwrap().last_activity = now;
            let voters = state.active_voters(now).collect::<BTreeMap<_, _>>();
            assert_eq!(voters.len(), 1);
            assert_eq!(*voters.get(&1).unwrap(), (2 << 2) * 10000);
        })
    }

    #[test]
    fn test_display_tokens() {
        assert_eq!(display_tokens(10000000, 8), "0.10000000");
        assert_eq!(display_tokens(123456789, 8), "1.23456789");
        assert_eq!(display_tokens(34544, 2), "345.44");
    }

    #[test]
    fn test_amount_parsing() {
        assert_eq!(parse_amount("12.34", 8), Ok(1234000000));
        assert_eq!(parse_amount("0.0034", 8), Ok(340000));
        assert_eq!(parse_amount("00.67", 2), Ok(67));
        assert_eq!(parse_amount("1.25", 2), Ok(125));
        assert_eq!(parse_amount("123.4567", 2), Ok(12345));
        assert_eq!(parse_amount("777", 2), Ok(77700));
        assert_eq!(parse_amount("0777", 2), Ok(77700));
        assert!(parse_amount("34,56", 2).is_err());
    }

    #[test]
    fn test_donated_rewards() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            let user_0 = create_user_with_params(state, pr(0), "alice", 1000);
            let user_1 = create_user_with_params(state, pr(1), "bob", 100);
            let user_2 = create_user_with_params(state, pr(2), "eve", 50);
            let post_0 =
                Post::create(state, "A".to_string(), &[], pr(1), 0, None, None, None).unwrap();
            let post_1 =
                Post::create(state, "A".to_string(), &[], pr(2), 0, None, None, None).unwrap();
            assert!(state.react(pr(0), post_0, 100, WEEK).is_ok());
            assert!(state.react(pr(0), post_1, 50, WEEK).is_ok());

            let user = state.users.get(&user_0).unwrap();
            assert_eq!(user.karma_donations.len(), 2);
            assert_eq!(user.karma_donations.get(&user_1).unwrap(), &20);
            assert_eq!(user.karma_donations.get(&user_2).unwrap(), &10);

            let post_2 =
                Post::create(state, "B".to_string(), &[], pr(2), 0, None, None, None).unwrap();
            assert!(state.react(pr(0), post_2, 100, WEEK).is_ok());
            let user = state.users.get(&user_0).unwrap();
            assert_eq!(user.karma_donations.len(), 2);
            assert_eq!(user.karma_donations.get(&user_2).unwrap(), &30);
        })
    }

    #[test]
    fn test_credit_transfer() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            let id1 = create_user_with_params(state, pr(0), "peter", 10000);
            let id2 = create_user_with_params(state, pr(1), "peter", 0);

            assert_eq!(state.users.get(&id2).unwrap().credits(), 0);
            state
                .credit_transfer(
                    id1,
                    id2,
                    1000,
                    CONFIG.credit_transaction_fee,
                    Destination::Credits,
                    "",
                    None,
                )
                .unwrap();
            assert_eq!(state.users.get(&id2).unwrap().credits(), 1000);
            state
                .credit_transfer(
                    id1,
                    id2,
                    1000,
                    CONFIG.credit_transaction_fee,
                    Destination::Credits,
                    "",
                    None,
                )
                .unwrap();
            assert_eq!(state.users.get(&id2).unwrap().credits(), 2000);
            assert_eq!(
                state.users.get(&id1).unwrap().credits(),
                10000 - 2 * (1000 + CONFIG.credit_transaction_fee)
            );
        });
    }

    #[actix_rt::test]
    async fn test_name_change() {
        let id = STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            create_user_with_params(state, pr(0), "peter", 10000)
        });

        read(|state| {
            let user = state.users.get(&id).unwrap();
            assert_eq!(user.name, "peter".to_string());
            assert!(user.previous_names.is_empty());
        });

        // update with wrong principal
        assert!(User::update(
            pr(1),
            Some("john".into()),
            Default::default(),
            vec![],
            Default::default(),
            false,
            false,
            false
        )
        .is_err());

        // correct update
        assert!(User::update(
            pr(0),
            Some("john".into()),
            Default::default(),
            vec![],
            Default::default(),
            false,
            false,
            false
        )
        .is_ok());

        read(|state| {
            let user = state.users.get(&id).unwrap();
            assert_eq!(user.name, "john".to_string());
            assert_eq!(user.previous_names.as_slice(), &["peter"]);
        });

        // The old name is reserved now
        assert_eq!(
            State::create_user(pr(2), "peter".into(), None).await,
            Err("taken".to_string())
        );
    }

    #[test]
    fn test_new_rewards_collection() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            for (i, rewards) in vec![125, -11, 0, 672].into_iter().enumerate() {
                let id = create_user(state, pr(i as u8));
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(rewards, "");
                user.miner = i == 4;
            }

            let new_rewards = state.collect_new_rewards();

            let user = state.principal_to_user(pr(0)).unwrap();
            assert_eq!(*new_rewards.get(&user.id).unwrap(), 125);
            assert_eq!(user.rewards(), 0);

            let user = state.principal_to_user(pr(1)).unwrap();
            // no new rewards was collected
            assert!(!new_rewards.contains_key(&user.id));
            assert_eq!(user.rewards(), -11);

            let user = state.principal_to_user(pr(2)).unwrap();
            // no new rewards was collected
            assert!(!new_rewards.contains_key(&user.id));
            assert_eq!(user.rewards(), 0);

            let user = state.principal_to_user(pr(3)).unwrap();
            // no new rewards was collected becasue the user is a miner
            assert_eq!(user.rewards(), 0);
        });
    }

    #[test]
    fn test_revenue_collection() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            let now = WEEK * CONFIG.voting_power_activity_weeks;

            for (i, (balance, total_rewards, last_activity)) in vec![
                // Active user with 100 tokens and no rewards
                (10000, 0, now),
                // Active, with 200 tokens and some rewards
                (20000, 25, now),
                // Inactive, with 300 tokens and some rewards
                (30000, 25, 0),
            ]
            .into_iter()
            .enumerate()
            {
                let principal = pr(i as u8);
                let id = create_user(state, principal);
                let user = state.users.get_mut(&id).unwrap();
                // remove first whatever rewards is there
                user.change_rewards(-user.rewards(), "");
                user.change_rewards(total_rewards, "");
                user.last_activity = last_activity;
                insert_balance(state, principal, balance);
            }

            let revenue = state.collect_revenue(now, 1000000);
            assert_eq!(revenue.len(), 0);
            state.burned_cycles = 5000;
            let revenue = state.collect_revenue(now, 1000000);
            assert_eq!(revenue.len(), 2);
            assert_eq!(*revenue.get(&0).unwrap(), 1666666);
            assert_eq!(*revenue.get(&1).unwrap(), 3333333);
        });
    }

    #[test]
    fn test_minting() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            let insert_rewards = |state: &mut State, donor_id, user_id, rewards| {
                state
                    .users
                    .get_mut(&donor_id)
                    .unwrap()
                    .karma_donations
                    .insert(user_id, rewards)
            };

            for i in 0..5 {
                create_user(state, pr(i));
                state.principal_to_user_mut(pr(i)).unwrap().miner = true;
                insert_balance(state, pr(i), (((i + 1) as u64) << 2) * 10000);
                for j in 0..5 {
                    if i != j {
                        insert_rewards(state, i as u64, j as u64, ((j + 1) * (i + 1)) as u64 * 100);
                    }
                }
            }

            let minting_acc = account(Principal::anonymous());
            state
                .balances
                .insert(minting_acc.clone(), CONFIG.maximum_supply);

            // no minting hapened due to max supply
            assert_eq!(state.balances.get(&account(pr(0))).unwrap(), &40000);
            state.minting_mode = true;
            state.mint();
            assert_eq!(state.balances.get(&account(pr(0))).unwrap(), &40000);

            state.balances.remove(&minting_acc);

            // user 3 switches to non-miner
            state.principal_to_user_mut(pr(3)).unwrap().miner = false;
            assert_eq!(*state.balances.get(&account(pr(3))).unwrap(), 160000);

            state.minting_mode = true;
            state.mint();

            // we cleaned up all donations accounting
            for u in state.users.values() {
                assert!(u.karma_donations.is_empty());
            }

            assert_eq!(state.balances.len(), 5);
            assert_eq!(*state.balances.get(&account(pr(0))).unwrap(), 95155);
            assert_eq!(*state.balances.get(&account(pr(1))).unwrap(), 173510);
            assert_eq!(*state.balances.get(&account(pr(2))).unwrap(), 249761);
            // non-miner didn't get anything
            assert_eq!(*state.balances.get(&account(pr(3))).unwrap(), 160000);
            assert_eq!(*state.balances.get(&account(pr(4))).unwrap(), 366688);

            // increase minting ratio
            assert_eq!(state.minting_ratio(), 1);
            insert_balance(state, pr(4), 10000000);
            assert_eq!(state.minting_ratio(), 2);

            // Test circuit breaking
            insert_rewards(state, 4, 3, 301);
            insert_rewards(state, 4, 4, 60_000);

            // Tokens were not minted to to circuit breaking
            state.minting_mode = true;
            state.mint();
            assert_eq!(*state.balances.get(&account(pr(2))).unwrap(), 249761);
            assert_eq!(*state.balances.get(&account(pr(3))).unwrap(), 160000);

            // increase minting ratio to 512:1
            state.balances.insert(account(pr(7)), 60000000);
            assert_eq!(state.minting_ratio(), 128);
        })
    }

    #[test]
    fn test_minting_ratio() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            assert_eq!(state.minting_ratio(), 1);

            for (supply, ratio) in vec![
                (1, 1),
                (10000000, 2),
                (20000000, 4),
                (30000000, 8),
                (40000000, 16),
                (50000000, 32),
                (60000000, 64),
                (70000000, 128),
                (80000000, 256),
                (90000000, 512),
            ]
            .into_iter()
            {
                state
                    .balances
                    .insert(account(Principal::anonymous()), supply);
                assert_eq!(state.minting_ratio(), ratio);
            }
        })
    }

    #[test]
    fn test_poll_conclusion() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            // create users each having 25 + i*10, e.g.
            // user 1: 35, user 2: 45, user 3: 55, etc...
            for i in 1..11 {
                let p = pr(i);
                let id = create_user(state, p);
                insert_balance(state, p, (i as u64 * 10) * 100);
                let user = state.users.get_mut(&id).unwrap();
                // we create the same amount of new and hard rewards so that we have both rewards and
                // balances after minting
                user.change_rewards(i as i64 * 10, "test");
            }

            // mint tokens
            state.mint();

            let post_id = Post::create(
                state,
                "Test".to_string(),
                &[],
                pr(1),
                0,
                None,
                None,
                Some(Extension::Poll(Poll {
                    options: vec!["A".into(), "B".into(), "C".into()],
                    deadline: 72,
                    ..Default::default()
                })),
            )
            .unwrap();

            let now = Post::mutate(state, &post_id, |post| {
                let mut votes = BTreeMap::new();
                votes.insert(0, vec![1, 2, 3].into_iter().collect());
                votes.insert(1, vec![4, 5, 6].into_iter().collect());
                votes.insert(2, vec![7, 8, 9].into_iter().collect());
                if let Some(Extension::Poll(poll)) = post.extension.as_mut() {
                    poll.votes = votes;
                }
                Ok(post.timestamp())
            })
            .unwrap();
            assert_eq!(state.pending_polls.len(), 1);
            state.conclude_polls(now + 24 * HOUR);
            assert_eq!(state.pending_polls.len(), 1);
            state.conclude_polls(now + 3 * 24 * HOUR);
            assert_eq!(state.pending_polls.len(), 0);
            if let Some(Extension::Poll(poll)) =
                Post::get(state, &post_id).unwrap().extension.as_ref()
            {
                // Here we can see that by rewards the difference is way smaller becasue values are
                // normalized by the square root.
                assert_eq!(*poll.weighted_by_tokens.get(&0).unwrap(), 9000);
                assert_eq!(*poll.weighted_by_tokens.get(&1).unwrap(), 18000);
                assert_eq!(*poll.weighted_by_tokens.get(&2).unwrap(), 27000);
            } else {
                panic!("should be a poll")
            }
        });
    }

    #[test]
    fn test_principal_change() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            for i in 1..3 {
                let p = pr(i);
                create_user(state, p);
                insert_balance(state, p, i as u64 * 111 * 100);
                let user = state.principal_to_user_mut(pr(i)).unwrap();
                user.change_rewards(i as i64 * 111, "test");
            }

            // mint tokens
            state.mint();
            assert_eq!(*state.balances.get(&account(pr(1))).unwrap(), 11100);

            let user = state.principal_to_user_mut(pr(1)).unwrap();
            user.stalwart = true;
            let user_id = user.id;
            let proposal_id = proposals::propose(
                state,
                pr(1),
                "test".into(),
                Payload::Reward(proposals::Reward {
                    receiver: pr(2).to_string(),
                    votes: Default::default(),
                    minted: 0,
                }),
                time(),
            )
            .expect("couldn't propose");
            proposals::vote_on_proposal(state, 0, pr(1), proposal_id, false, "1").unwrap();

            let new_principal_str: String =
                "yh4uw-lqajx-4dxcu-rwe6s-kgfyk-6dicz-yisbt-pjg7v-to2u5-morox-hae".into();
            let new_principal = Principal::from_text(new_principal_str).unwrap();
            assert_eq!(state.change_principal(new_principal), Ok(false));
            state.principal_change_requests.insert(new_principal, pr(1));

            match state.change_principal(new_principal) {
                Err(err)
                    if err
                        .contains("pending proposal with the current principal as voter exist") => {
                }
                val => panic!("unexpected outcome: {:?}", val),
            };

            state.proposals.get_mut(0).unwrap().status = Status::Executed;
            state.principal_change_requests.insert(new_principal, pr(1));

            assert_eq!(state.principals.len(), 2);
            assert_eq!(state.change_principal(new_principal), Ok(true));
            assert_eq!(state.principals.len(), 2);

            assert_eq!(state.principal_to_user(new_principal).unwrap().id, user_id);
            assert!(state.balances.get(&account(pr(1))).is_none());
            assert_eq!(
                *state.balances.get(&account(new_principal)).unwrap(),
                11100 - CONFIG.transaction_fee
            );
            let user = state.users.get(&user_id).unwrap();
            assert_eq!(user.principal, new_principal);
            assert_eq!(
                user.account,
                AccountIdentifier::new(&user.principal, &DEFAULT_SUBACCOUNT).to_string()
            );
        });
    }

    #[test]
    fn test_realm_whitelist() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
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
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
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
            assert_eq!(state.principal_to_user(pr(0)).unwrap().rewards(), 1000);
            assert_eq!(state.principal_to_user(pr(1)).unwrap().rewards(), 1000);
            assert_eq!(state.principal_to_user(pr(2)).unwrap().rewards(), 0);
            assert_eq!(state.burned_cycles, 500);
            state.distribute_realm_revenue(WEEK + WEEK / 2);
            assert_eq!(state.realms.values().next().unwrap().revenue, 0);
            let expected_revenue = (200 / 100 * CONFIG.realm_revenue_percentage / 2) as i64;
            assert_eq!(state.burned_cycles, 500 - 2 * expected_revenue);
            assert_eq!(
                state.principal_to_user(pr(0)).unwrap().rewards(),
                1000 + expected_revenue
            );
            assert_eq!(
                state.principal_to_user(pr(1)).unwrap().rewards(),
                1000 + expected_revenue
            );
            assert_eq!(state.principal_to_user(pr(2)).unwrap().rewards(), 0);
        })
    }

    #[test]
    fn test_realm_change() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
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

    fn realm_posts(state: &State, name: &str) -> Vec<PostId> {
        state
            .last_posts(None, 0, 0, true)
            .filter(|post| post.realm.as_ref() == Some(&name.to_string()))
            .map(|post| post.id)
            .collect::<Vec<_>>()
    }

    #[test]
    fn test_post_deletion() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            let id = create_user_with_credits(state, pr(0), 2000);
            let user = state.users.get_mut(&id).unwrap();
            assert_eq!(user.rewards(), 0);
            let upvoter_id = create_user(state, pr(1));
            let user = state.users.get_mut(&upvoter_id).unwrap();
            let upvoter_credits = user.credits();
            user.change_rewards(1000, "test");
            let uid = create_user(state, pr(2));
            create_user(state, pr(3));
            state
                .users
                .get_mut(&uid)
                .unwrap()
                .change_rewards(1000, "test");

            let post_id =
                Post::create(state, "Test".to_string(), &[], pr(0), 0, None, None, None).unwrap();

            // Create 2 comments
            let mut comment_id = 0;
            for i in 1..=2 {
                comment_id = Post::create(
                    state,
                    "Comment".to_string(),
                    &[],
                    pr(i),
                    0,
                    Some(post_id),
                    None,
                    None,
                )
                .unwrap();
            }

            let leaf = Post::create(
                state,
                "Leaf".to_string(),
                &[],
                pr(0),
                0,
                Some(comment_id),
                None,
                None,
            )
            .unwrap();

            assert_eq!(Post::get(state, &post_id).unwrap().tree_size, 3);
            assert_eq!(Post::get(state, &comment_id).unwrap().tree_size, 1);
            assert_eq!(Post::get(state, &leaf).unwrap().tree_size, 0);

            // React from both users
            assert!(state.react(pr(1), post_id, 100, 0).is_ok());
            assert!(state.react(pr(2), post_id, 50, 0).is_ok());

            assert_eq!(
                state.users.get(&id).unwrap().rewards() as Credits,
                20 + 10 + 2 * CONFIG.response_reward
            );

            assert_eq!(
                state.users.get_mut(&upvoter_id).unwrap().credits(),
                // reward + fee + post creation
                upvoter_credits - 20 - 3 - 2
            );

            let versions = vec!["a".into(), "b".into()];
            assert_eq!(
                state.delete_post(pr(1), post_id, versions.clone()),
                Err("not authorized".into())
            );

            state
                .charge(id, state.users.get(&id).unwrap().credits(), "")
                .unwrap();
            assert_eq!(
                state.delete_post(pr(0), post_id, versions.clone()),
                Err("not enough credits (this post requires 62 credits to be deleted)".into())
            );

            state
                .users
                .get_mut(&id)
                .unwrap()
                .change_credits(1000, CreditsDelta::Plus, "")
                .unwrap();

            assert_eq!(&Post::get(state, &0).unwrap().body, "Test");
            assert_eq!(state.delete_post(pr(0), post_id, versions.clone()), Ok(()));
            assert_eq!(&Post::get(state, &0).unwrap().body, "");
            assert_eq!(Post::get(state, &0).unwrap().hashes.len(), versions.len());

            assert_eq!(
                state.users.get(&upvoter_id).unwrap().credits(),
                // reward received back
                upvoter_credits - 20 - 3 - 2 + 20
            );
            assert_eq!(state.users.get(&id).unwrap().rewards(), 0);

            assert_eq!(
                state.react(pr(1), post_id, 1, 0),
                Err("post deleted".into())
            );
        });
    }

    #[actix_rt::test]
    async fn test_realms() {
        let (p1, realm_name) = STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
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
                Err("no user found".to_string())
            );

            assert_eq!(
                create_realm(state, p1, name.clone(),),
                Err(
                    "couldn't charge 1000 credits for realm creation: not enough credits"
                        .to_string()
                )
            );

            assert_eq!(
                create_realm(
                    state,
                    p0,
                    "THIS_NAME_IS_IMPOSSIBLY_LONG_AND_WILL_NOT_WORK".to_string()
                ),
                Err("realm name too long".to_string())
            );

            assert_eq!(
                state.create_realm(p0, name.clone(), Realm::default()),
                Err("no controllers specified".to_string())
            );

            assert_eq!(
                create_realm(state, p0, "TEST NAME".to_string(),),
                Err("realm name should be an alpha-numeric string".to_string(),)
            );

            assert_eq!(create_realm(state, p0, name.clone(),), Ok(()));

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
                Err("no user found".to_string())
            );

            assert_eq!(
                state.edit_realm(p0, "WRONGNAME".to_string(), Realm::default()),
                Err("no realm found".to_string())
            );

            assert_eq!(
                state.edit_realm(p1, name.clone(), Realm::default()),
                Err("not authorized".to_string())
            );

            let realm = Realm {
                controllers,
                description: "New test description".into(),
                ..Default::default()
            };
            assert_eq!(state.edit_realm(p0, name.clone(), realm), Ok(()));

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
            let post_id = Post::create(
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
                Post::get(state, &post_id).unwrap().realm,
                Some(name.clone())
            );
            assert!(realm_posts(state, &name).contains(&post_id));

            // Posting without realm creates the post in the global realm
            let post_id = Post::create(
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

            assert_eq!(Post::get(state, &post_id).unwrap().realm, None,);

            // comments are possible even if user is not in the realm
            assert_eq!(
                Post::create(
                    state,
                    "comment".to_string(),
                    &[],
                    p0,
                    0,
                    Some(0),
                    None,
                    None
                ),
                Ok(2)
            );

            assert!(state.toggle_realm_membership(p0, name.clone()));
            assert_eq!(state.realms.get(&name).unwrap().num_members, 2);

            assert_eq!(
                Post::create(
                    state,
                    "comment".to_string(),
                    &[],
                    p0,
                    0,
                    Some(0),
                    None,
                    None
                ),
                Ok(3)
            );

            assert!(realm_posts(state, &name).contains(&2));

            // Create post without a realm

            let post_id = Post::create(
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
            let comment_id = Post::create(
                state,
                "comment".to_string(),
                &[],
                p0,
                0,
                Some(post_id),
                None,
                None,
            )
            .unwrap();

            assert_eq!(Post::get(state, &comment_id).unwrap().realm, None);

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

            assert_eq!(
                Post::create(
                    state,
                    "test".to_string(),
                    &[],
                    p1,
                    0,
                    None,
                    Some(realm_name.clone()),
                    None
                ),
                Ok(6)
            );
            assert_eq!(state.realms.get(&realm_name).unwrap().posts.len(), 1);

            assert!(state
                .users
                .get(&_u1)
                .unwrap()
                .realms
                .contains(&"TAGGRDAO".to_string()));
            (p1, realm_name)
        });

        // Move the post to non-joined realm
        assert_eq!(
            Post::edit(
                6,
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
            assert_eq!(Post::get(state, &6).unwrap().realm, Some(realm_name));
            assert_eq!(state.realms.get("TAGGRDAO").unwrap().posts.len(), 1);
        });
        assert_eq!(
            Post::edit(
                6,
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
                Post::get(state, &6).unwrap().realm,
                Some("TAGGRDAO".to_string())
            );
        });
    }

    #[test]
    fn test_covered_by_feed() {
        let m = |v: Vec<&str>| v.into_iter().map(|v| v.to_string()).collect();
        let tests = vec![
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m(vec!["tag1"]),
                true,
                None,
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m(vec!["tag1", "tag2"]),
                false,
                Some(0),
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m(vec!["tag1", "tag2"]),
                true,
                Some(0),
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m(vec!["tag1", "tag2", "tag3"]),
                true,
                None,
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m(vec!["tag1", "tag2", "tag3"]),
                false,
                Some(0),
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m(vec!["tagX", "tag2", "tag3"]),
                false,
                Some(1),
            ),
        ];

        for (i, t) in tests.iter().enumerate() {
            let (feeds, tags, strict, result) = t;
            if covered_by_feeds(feeds, tags, *strict) != *result {
                panic!("Test {} failed", i)
            }
        }
    }

    #[test]
    fn test_user_by_handle() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            let u1 = create_user_with_params(state, pr(0), "user1", 1000);
            let u2 = create_user_with_params(state, pr(1), "user2", 1000);
            let u3 = create_user_with_params(state, pr(2), "user3", 1000);
            let cold_wallet = pr(254);
            state.link_cold_wallet(pr(254), u2).unwrap();

            assert_eq!(state.user("user1").unwrap().id, u1);
            assert_eq!(state.user("0").unwrap().id, u1);
            assert_eq!(state.user("user2").unwrap().id, u2);
            assert_eq!(state.user("1").unwrap().id, u2);
            assert_eq!(state.user("user3").unwrap().id, u3);
            assert_eq!(state.user("2").unwrap().id, u3);
            assert!(state.user("user22").is_none());
            assert_eq!(state.user(&pr(2).to_text()).unwrap().id, u3);
            assert_eq!(state.user(&cold_wallet.to_text()).unwrap().id, u2);
        });
    }

    #[test]
    fn test_inverse_filter() {
        STATE.with(|cell| cell.replace(Default::default()));

        mutate(|state| {
            // create a post author and one post for its principal
            let p = pr(0);
            let post_author_id = create_user_with_credits(state, p, 2000);

            assert!(create_realm(state, p, "TESTREALM".into(),).is_ok());
            state.toggle_realm_membership(p, "TESTREALM".into());
            let caller = pr(1);
            let _ = create_user(state, caller);

            let post_id = Post::create(
                state,
                "This is a post #abc".to_string(),
                &[],
                p,
                0,
                None,
                Some("TESTREALM".into()),
                None,
            )
            .unwrap();

            // without filters we see the new post
            let post_visible = |state: &State| {
                let inverse_filters = state.principal_to_user(caller).map(|user| &user.filters);
                state
                    .last_posts(None, 0, 0, true)
                    .filter(|post| {
                        inverse_filters
                            .map(|filters| !post.matches_filters(filters))
                            .unwrap_or(true)
                    })
                    .any(|post| post.id == post_id)
            };
            assert!(post_visible(state));

            // after muting with a filter we don't see the post and see again after unmuting
            for (filter, value) in [
                ("user", format!("{}", post_author_id).as_str()),
                ("realm", "TESTREALM"),
                ("tag", "abc"),
            ]
            .iter()
            {
                state
                    .principal_to_user_mut(caller)
                    .unwrap()
                    .toggle_filter(filter.to_string(), value.to_string())
                    .unwrap();
                assert!(!post_visible(state));
                state
                    .principal_to_user_mut(caller)
                    .unwrap()
                    .toggle_filter(filter.to_string(), value.to_string())
                    .unwrap();
                assert!(post_visible(state));
            }
        });
    }

    #[test]
    fn test_personal_feed() {
        STATE.with(|cell| cell.replace(Default::default()));

        mutate(|state| {
            // create a post author and one post for its principal
            let p = pr(0);
            let post_author_id = create_user(state, p);
            let post_id = Post::create(
                state,
                "This is a #post with #tags".to_string(),
                &[],
                p,
                0,
                None,
                None,
                None,
            )
            .unwrap();

            // create a user and make sure his feed is empty
            let pr1 = pr(1);
            let user_id = create_user(state, pr1);
            assert!(state
                .user(&user_id.to_string())
                .unwrap()
                .personal_feed(state, 0, 0)
                .next()
                .is_none());

            // now we follow post_author_id
            let _user = state.users.get_mut(&user_id).unwrap();
            assert!(state.toggle_following_user(pr1, post_author_id));

            // make sure the feed contains exactly one post from post_author_id
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 1);
            assert!(feed.contains(&post_id));

            // now we follow a feed #post+#tags
            let user = state.users.get_mut(&user_id).unwrap();
            assert!(user.toggle_following_feed(
                vec!["post".to_owned(), "tags".to_owned()]
                    .into_iter()
                    .collect()
            ));

            // make sure the feed still contains the same post
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 1);
            assert!(feed.contains(&post_id));

            // now a different post with the same tags appears
            let p = pr(2);
            let _post_author_id = create_user(state, p);
            let post_id2 = Post::create(
                state,
                "This is a different #post, but with the same #tags and one #more".to_string(),
                &[],
                p,
                0,
                None,
                None,
                None,
            )
            .unwrap();

            // make sure the feed contains both posts
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 2);
            assert!(feed.contains(&post_id));
            assert!(feed.contains(&post_id2));

            // yet another post appears
            let p = pr(3);
            let _post_author_id = create_user(state, p);
            let post_id3 = Post::create(
                state,
                "Different #post, different #feed".to_string(),
                &[],
                p,
                0,
                None,
                None,
                None,
            )
            .unwrap();

            // make sure the feed contains the same old posts
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 2);
            assert!(feed.contains(&post_id));
            assert!(feed.contains(&post_id2));

            // now we follow a feed "post"
            let user = state.users.get_mut(&user_id).unwrap();
            let tags: Vec<_> = vec!["post".to_string()].into_iter().collect();
            assert!(user.toggle_following_feed(tags.clone()));
            // make sure the feed contains the new post
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 3);
            assert!(feed.contains(&post_id));
            assert!(feed.contains(&post_id2));
            assert!(feed.contains(&post_id3));

            // Make sure we can unsubscribe and the feed gets back to 2 posts
            let user = state.users.get_mut(&user_id).unwrap();
            assert!(!user.toggle_following_feed(tags));
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 2);
            assert!(feed.contains(&post_id));
            assert!(feed.contains(&post_id2));

            // testing inverse filters
            let user = state.users.get_mut(&user_id).unwrap();
            user.toggle_filter("tag".into(), "more".into()).unwrap();
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert!(feed.contains(&post_id));
            assert!(!feed.contains(&post_id2));
            let user = state.users.get_mut(&user_id).unwrap();
            user.toggle_filter("user".into(), "0".into()).unwrap();
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed(state, 0, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert!(!feed.contains(&post_id));
        });
    }

    #[test]
    fn test_clean_up() {
        STATE.with(|cell| cell.replace(Default::default()));
        mutate(|state| {
            let inactive_id1 = create_user_with_credits(state, pr(1), 1500);
            let inactive_id2 = create_user_with_credits(state, pr(2), 1100);
            let inactive_id3 = create_user_with_credits(state, pr(3), 180);
            let active_id = create_user_with_credits(state, pr(4), 1300);

            let user = state.users.get_mut(&inactive_id1).unwrap();
            user.change_rewards(25, "");
            assert_eq!(user.rewards(), 25);
            let user = state.users.get_mut(&active_id).unwrap();
            user.change_rewards(25, "");
            assert_eq!(user.rewards(), 25);

            let now = WEEK * 27;
            state.users.get_mut(&active_id).unwrap().last_activity = now;

            state.clean_up(now);
            state.charge_for_inactivity(now);

            let penalty = CONFIG.inactivity_penalty;

            // penalized
            let user = state.users.get_mut(&inactive_id1).unwrap();
            assert_eq!(user.credits(), 1500 - penalty);
            assert_eq!(user.rewards(), 0);
            // not penalized due to low balance, but rewards penalized
            let user = state.users.get_mut(&inactive_id2).unwrap();
            assert_eq!(user.credits(), 1055);
            assert_eq!(user.rewards(), 0);
            // penalized to the minimum balance
            let user = state.users.get_mut(&inactive_id3).unwrap();
            assert_eq!(user.credits(), penalty * 4);
            // Active user not penalized
            let user = state.users.get_mut(&active_id).unwrap();
            assert_eq!(user.credits(), 1300);
            assert_eq!(user.rewards(), 25);

            // check rewards budgets
            for (id, rewards) in &[
                (inactive_id1, 100),
                (inactive_id2, 1000),
                (inactive_id3, 10000),
                (active_id, 20000),
            ] {
                let user = state.users.get_mut(id).unwrap();
                user.change_rewards(*rewards, "");
                user.take_positive_rewards();
            }

            state.balances.insert(account(pr(5)), 20000000);
            assert_eq!(state.minting_ratio(), 4);

            state
                .users
                .get_mut(&inactive_id1)
                .unwrap()
                .karma_donations
                .insert(0, 1000);

            assert!(!state
                .users
                .get_mut(&inactive_id1)
                .unwrap()
                .karma_donations
                .is_empty());

            state.clean_up(WEEK);
        })
    }

    #[test]
    fn test_credits_accounting() {
        STATE.with(|cell| cell.replace(Default::default()));
        mutate(|state| {
            let p0 = pr(0);
            let post_author_id = create_user_with_credits(state, p0, 2000);
            let post_id =
                Post::create(state, "test".to_string(), &[], p0, 0, None, None, None).unwrap();
            let p = pr(1);
            let p2 = pr(2);
            let p3 = pr(3);

            let lurker_id = create_user(state, p);
            create_user(state, p2);
            create_user(state, p3);
            insert_balance(state, p3, 10 * token::base());
            let c = CONFIG;
            assert_eq!(state.burned_cycles as Credits, c.post_cost);
            // make author to a new user
            let author = state.users.get(&post_author_id).unwrap();
            let lurker = state.users.get(&lurker_id).unwrap();
            assert_eq!(author.credits(), 2 * c.credits_per_xdr - c.post_cost);
            assert_eq!(lurker.credits(), c.credits_per_xdr);

            // react on the new post
            assert!(state.react(pr(111), post_id, 1, 0).is_err());
            assert_eq!(
                state.users.get(&post_author_id).unwrap().credits(),
                2 * c.credits_per_xdr - c.post_cost
            );
            assert!(state.react(p, post_id, 50, 0).is_ok());
            assert!(state.react(p, post_id, 100, 0).is_err());
            assert!(state.react(p2, post_id, 100, 0).is_ok());
            let reaction_costs_1 = 12;
            let burned_credits_by_reactions = 2 + 3;
            let mut rewards_from_reactions = 10 + 20;

            // try to self upvote (should be a no-op)
            assert!(state.react(p0, post_id, 100, 0).is_err());

            let author = state.users.get(&post_author_id).unwrap();
            assert_eq!(author.credits(), 2 * c.credits_per_xdr - c.post_cost);
            assert_eq!(author.rewards(), rewards_from_reactions);
            assert_eq!(
                state.burned_cycles as Credits,
                c.post_cost + burned_credits_by_reactions
            );

            let lurker = state.users.get(&lurker_id).unwrap();
            assert_eq!(lurker.credits(), c.credits_per_xdr - reaction_costs_1);

            // downvote
            assert!(state.react(p3, post_id, 1, 0).is_ok());
            let reaction_penalty = 3;
            rewards_from_reactions -= 3;
            let author = state.users.get(&post_author_id).unwrap();
            let lurker_3 = state.principal_to_user(p3).unwrap();
            assert_eq!(
                author.credits(),
                2 * c.credits_per_xdr - c.post_cost - reaction_penalty
            );
            assert_eq!(author.rewards(), rewards_from_reactions);
            assert_eq!(lurker_3.credits(), c.credits_per_xdr - 3);
            assert_eq!(
                state.burned_cycles,
                (c.post_cost + burned_credits_by_reactions + 2 * 3) as i64
            );

            Post::create(state, "test".to_string(), &[], p0, 0, Some(0), None, None).unwrap();

            let c = CONFIG;
            assert_eq!(
                state.burned_cycles,
                (2 * c.post_cost + burned_credits_by_reactions + 2 * 3) as i64
            );
            let author = state.users.get(&post_author_id).unwrap();
            assert_eq!(
                author.credits(),
                2 * c.credits_per_xdr - c.post_cost - c.post_cost - reaction_penalty
            );

            let author = state.users.get_mut(&post_author_id).unwrap();
            author
                .change_credits(author.credits(), CreditsDelta::Minus, "")
                .unwrap();

            assert!(Post::create(state, "test".to_string(), &[], p0, 0, None, None, None).is_err());

            assert_eq!(
                state.react(p, post_id, 10, 0),
                Err("multiple reactions are forbidden".into())
            );
            create_user(state, pr(10));
            let lurker = state.principal_to_user_mut(pr(10)).unwrap();
            lurker
                .change_credits(lurker.credits(), CreditsDelta::Minus, "")
                .unwrap();
            assert_eq!(
                state.react(pr(10), post_id, 10, 0),
                Err("not enough credits".into())
            );

            // Create a new user and a new post
            let user_id111 = create_user_with_params(state, pr(55), "user111", 2000);
            let id =
                Post::create(state, "t".to_string(), &[], pr(55), 0, Some(0), None, None).unwrap();

            // add 6 credits and decrease the weekly budget to 8
            let lurker = state.principal_to_user_mut(pr(10)).unwrap();
            lurker.change_credits(100, CreditsDelta::Plus, "").unwrap();
            let lurker_principal = lurker.principal;
            assert!(state.react(lurker_principal, id, 50, 0).is_ok());
            assert_eq!(state.users.get(&user_id111).unwrap().rewards(), 10);

            // another reaction on a new post
            let id =
                Post::create(state, "t".to_string(), &[], pr(55), 0, Some(0), None, None).unwrap();
            assert!(state.react(lurker_principal, id, 50, 0).is_ok());

            assert_eq!(state.users.get(&user_id111).unwrap().rewards(), 20);

            // another reaction on a new post
            let id =
                Post::create(state, "t".to_string(), &[], pr(55), 0, Some(0), None, None).unwrap();
            assert!(state.react(lurker_principal, id, 50, 0).is_ok());

            assert_eq!(state.users.get(&user_id111).unwrap().rewards(), 30);
        })
    }

    #[test]
    fn test_credits_accounting_reposts() {
        STATE.with(|cell| cell.replace(Default::default()));
        mutate(|state| {
            create_user_with_credits(state, pr(0), 2000);
            create_user_with_credits(state, pr(1), 2000);
            create_user(state, pr(2));
            let c = CONFIG;

            for (reaction, total_fee) in &[(10, 1), (50, 2), (101, 3)] {
                state.burned_cycles = 0;
                let post_id =
                    Post::create(state, "test".to_string(), &[], pr(0), 0, None, None, None)
                        .unwrap();
                let post_id2 = Post::create(
                    state,
                    "test".to_string(),
                    &[],
                    pr(1),
                    0,
                    None,
                    None,
                    Some(Extension::Repost(post_id)),
                )
                .unwrap();

                assert!(state.react(pr(2), post_id2, *reaction, 0).is_ok());
                assert_eq!(state.burned_cycles as Credits, 2 * c.post_cost + total_fee);
            }
        })
    }

    #[test]
    fn test_following() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            let p = pr(0);
            let id = create_user(state, p);

            let u1 = create_user(state, pr(1));
            let u2 = create_user(state, pr(2));
            let u3 = create_user(state, pr(3));

            assert!(state.toggle_following_user(p, 1));
            assert!(state.toggle_following_user(p, 2));
            assert!(state.toggle_following_user(p, 3));

            let f1 = &state.user(&u1.to_string()).unwrap().followers;
            assert_eq!(f1.len(), 1);
            assert!(f1.contains(&id));
            let f2 = &state.user(&u2.to_string()).unwrap().followers;
            assert_eq!(f2.len(), 1);
            assert!(f2.contains(&id));
            let f3 = &state.user(&u3.to_string()).unwrap().followers;
            assert_eq!(f3.len(), 1);
            assert!(f3.contains(&id));

            assert!(!state.toggle_following_user(p, 1));
            assert!(!state.toggle_following_user(p, 2));
            assert!(!state.toggle_following_user(p, 3));

            let f1 = &state.user(&u1.to_string()).unwrap().followers;
            assert!(!f1.contains(&id));
            let f2 = &state.user(&u2.to_string()).unwrap().followers;
            assert!(!f2.contains(&id));
            let f3 = &state.user(&u3.to_string()).unwrap().followers;
            assert!(!f3.contains(&id));

            let tags: Vec<_> = vec!["tag1".to_string(), "tag2".to_string()]
                .into_iter()
                .collect();
            let tags2: Vec<_> = vec!["tag1".to_owned()].into_iter().collect();
            let user = state.users.get_mut(&id).unwrap();
            assert!(user.toggle_following_feed(tags.clone()));
            assert!(user.toggle_following_feed(tags2.clone()));
            assert!(!user.toggle_following_feed(tags));
            assert!(!user.toggle_following_feed(tags2));
        })
    }

    #[test]
    fn test_stalwarts() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            state.load();

            assert!(state.realms.contains_key(CONFIG.dao_realm));
            assert!(state
                .realms
                .get(CONFIG.dao_realm)
                .unwrap()
                .controllers
                .is_empty());

            let now = CONFIG.min_stalwart_account_age_weeks as u64 * WEEK;

            for i in 0..200 {
                let id = create_user(state, pr(i as u8));
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(i as i64, "");
                user.take_positive_rewards();
                // every second user was active
                if i % 2 == 0 {
                    user.last_activity = now;
                    user.active_weeks = CONFIG.min_stalwart_activity_weeks as u32;
                    user.timestamp = 0;
                    user.take_positive_rewards();
                }
            }

            state.recompute_stalwarts(now + WEEK * 2);

            assert!(!state
                .realms
                .get(CONFIG.dao_realm)
                .unwrap()
                .controllers
                .is_empty());

            for i in 0..200 {
                insert_balance(state, pr(i as u8), i * 100);
            }

            state.recompute_stalwarts(now + WEEK * 3);
            assert_eq!(
                state
                    .users
                    .values()
                    .filter_map(|u| u.stalwart.then_some(u.id))
                    .collect::<Vec<UserId>>(),
                vec![194, 196, 198]
            );
        })
    }

    #[actix_rt::test]
    async fn test_invites() {
        let principal = pr(1);
        let (id, code, prev_balance) = STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            let id = create_user(state, principal);

            // use too many credits
            assert_eq!(
                state.create_invite(principal, 1111),
                Err("not enough credits".to_string())
            );

            // use enough credits and make sure they were deducted
            let prev_balance = state.users.get(&id).unwrap().credits();
            assert_eq!(state.create_invite(principal, 111), Ok(()));
            let new_balance = state.users.get(&id).unwrap().credits();
            // no charging yet
            assert_eq!(new_balance, prev_balance);
            let invite = state.invites(principal);
            assert_eq!(invite.len(), 1);
            let (code, credits) = invite.first().unwrap().clone();
            assert_eq!(credits, 111);
            (id, code, prev_balance)
        });

        // use the invite
        assert!(State::create_user(pr(2), "name".to_string(), Some(code))
            .await
            .is_ok());

        let new_balance = mutate(|state| state.users.get(&id).unwrap().credits());
        assert_eq!(new_balance, prev_balance - 111);

        let (id, code, prev_balance) = mutate(|state| {
            let user = state.users.get_mut(&id).unwrap();
            let prev_balance = user.credits();
            assert_eq!(state.create_invite(principal, 222), Ok(()));
            let invite = state.invites(principal);
            let (code, credits) = invite.first().unwrap().clone();
            assert_eq!(credits, 222);
            (id, code, prev_balance)
        });

        let prev_revenue = read(|state| state.burned_cycles);

        assert!(State::create_user(pr(3), "name2".to_string(), Some(code))
            .await
            .is_ok());

        read(|state| {
            let user = state.users.get(&id).unwrap();
            assert_eq!(user.credits(), prev_balance - 222);
            assert_eq!(read(|state| state.burned_cycles), prev_revenue);
        });
    }

    #[test]
    fn test_icp_distribution() {
        mutate(|state| {
            let now = WEEK * 4;
            // Create 10 users with balances and rewards
            for i in 0..10 {
                create_user(state, pr(i));
                let user = state.principal_to_user_mut(pr(i)).unwrap();
                assert!(user.miner);
                user.last_activity = now;
                if i > 0 {
                    user.change_rewards(300, "");
                    insert_balance(state, pr(i), 300 * token::base());
                }
            }

            // Make user pr(3) have a low credits balance
            state
                .principal_to_user_mut(pr(3))
                .unwrap()
                .change_credits(900, CreditsDelta::Minus, "")
                .unwrap();

            // Make user pr(4) have a pending report
            state.principal_to_user_mut(pr(4)).unwrap().report = Some(Default::default());

            // Make user pr(5) inactive
            let user = state.principal_to_user_mut(pr(5)).unwrap();
            user.last_activity = 0;
            user.change_rewards(-user.rewards(), "");

            // Make user pr(6) have negative rewards
            state
                .principal_to_user_mut(pr(6))
                .unwrap()
                .change_rewards(-1000, "");

            // Make user pr(7) non-miner
            state.principal_to_user_mut(pr(7)).unwrap().miner = false;

            // Assume the revenue was 1M credits
            state.burned_cycles = 1_000_000;

            // For simplicity assume 100 e8s for 1 xdr
            state.e8s_for_one_xdr = 100;

            let payout = state.assign_rewards_and_revenue(now, 100000000);

            // Payout will be the amount of burned cycles + rewards of miners,
            // divided by the XDR rate
            assert_eq!(payout, 100330);
            assert_eq!(
                payout,
                state.users.values().map(|u| u.treasury_e8s).sum::<u64>()
            );

            // pr(0) had 0 rewards and 0 tokens
            assert_eq!(state.principal_to_user(pr(0)).unwrap().treasury_e8s, 0);
            // pr(1) had 100 rewards and 10000 tokens
            assert_eq!(state.principal_to_user(pr(1)).unwrap().treasury_e8s, 12545);
            // pr(2) had 200 rewards and 20000 tokens
            assert_eq!(state.principal_to_user(pr(2)).unwrap().treasury_e8s, 12545);
            // pr(3) had 300 rewards and 30000 tokens, but also a low credit balance
            let user = state.principal_to_user(pr(3)).unwrap();
            assert_eq!(user.credits(), 1000);
            assert_eq!(user.treasury_e8s, 12455);
            // pr(4) had a pending report (no effect on VP => revenue ICP)
            assert_eq!(state.principal_to_user(pr(4)).unwrap().treasury_e8s, 12545);
            // pr(5) is inactive and skipped for revenue
            assert_eq!(state.principal_to_user(pr(5)).unwrap().treasury_e8s, 0);
            // pr(6) has negative rewards balance (no effect on VP => revenue ICP)
            assert_eq!(state.principal_to_user(pr(6)).unwrap().treasury_e8s, 12545);
            // pr(7) is not miner, so he gets the highest rewards
            assert_eq!(state.principal_to_user(pr(7)).unwrap().treasury_e8s, 12605);
            assert_eq!(state.principal_to_user(pr(8)).unwrap().treasury_e8s, 12545);
            assert_eq!(state.principal_to_user(pr(9)).unwrap().treasury_e8s, 12545);
        });
    }
}
