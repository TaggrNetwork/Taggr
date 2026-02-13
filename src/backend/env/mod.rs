use self::auction::Auction;
use self::canisters::{icrc_transfer, upgrade_main_canister};
use self::invite::Invite;
use self::invoices::{ICPInvoice, USER_ICP_SUBACCOUNT};
use self::post::{archive_cold_posts, Extension, Post, PostId};
use self::post_iterators::{IteratorMerger, MergeStrategy};
use self::proposals::{Payload, ReleaseInfo, Status};
use self::token::{account, TransferArgs};
use self::user::{Filters, Mode, Notification, Predicate, UserFilter};
use crate::assets::export_token_supply;
use crate::env::user::CreditsDelta;
use crate::proposals::Proposal;
use crate::token::{Account, Token};
use crate::{assets, id, mutate, read, time};
use candid::CandidType;
use candid::Principal;
use config::CONFIG;
use domains::{available_realms, domain_realm_post_filter, DomainConfig, DomainSubConfig};
use ic_cdk::api::management_canister::main::raw_rand;
use ic_cdk::api::performance_counter;
use ic_cdk::api::stable::stable_size;
use ic_cdk::api::{self, canister_balance};
use ic_cdk::spawn;
use ic_ledger_types::{AccountIdentifier, DEFAULT_SUBACCOUNT, MAINNET_LEDGER_CANISTER_ID};
use invoices::BTCInvoice;
use invoices::Invoices;
use realms::{Realm, RealmId};
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::convert::TryFrom;
use token::base;
use user::{Pfp, User, UserId};

pub mod auction;
pub mod bitcoin;
pub mod canisters;
pub mod config;
pub mod delegations;
pub mod domains;
pub mod features;
pub mod invite;
pub mod invoices;
pub mod memory;
#[cfg(not(any(feature = "dev", feature = "staging")))]
pub mod nns_proposals;
pub mod pfp;
pub mod post;
pub mod post_iterators;
pub mod proposals;
pub mod realms;
pub mod reports;
pub mod search;
pub mod storage;
pub mod tip;
pub mod token;
pub mod user;

pub type Credits = u64;
pub type Blob = ByteBuf;
pub type Time = u64;
pub type E8s = u64;

pub const MILLISECOND: u64 = 1_000_000_u64;
pub const SECOND: u64 = 1000 * MILLISECOND;
pub const MINUTE: u64 = 60 * SECOND;
pub const HOUR: u64 = 60 * MINUTE;
pub const DAY: u64 = 24 * HOUR;
pub const WEEK: u64 = 7 * DAY;
pub const MONTH: u64 = 30 * DAY;
pub const YEAR: u64 = 52 * WEEK;

pub const MAX_USER_ID: UserId = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER in JS

#[derive(CandidType, Debug, Serialize, Deserialize)]
pub struct NeuronId {
    pub id: u64,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Event {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
pub struct Stats {
    realms: usize,
    e8s_revenue_per_1k: u64,
    e8s_for_one_xdr: u64,
    bitcoin_treasury_sats: u64,
    bitcoin_treasury_address: String,
    vesting_tokens_of_x: (Token, Token),
    users: usize,
    credits: Credits,
    canister_cycle_balance: u64,
    burned_credits: i64,
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
    active_users_vp: u64,
    invited_users: usize,
    buckets: Vec<(String, u64)>,
    users_online: usize,
    module_hash: String,
    last_release: ReleaseInfo,
    canister_id: Principal,
    circulating_supply: u64,
    meta: String,

    fees_burned: Token,
    volume_day: Token,
    volume_week: Token,
}

#[derive(Default, Serialize, Deserialize)]
pub struct TagIndex {
    pub subscribers: usize,
    // This is a FIFO queue, which works with a BTreeSet and the assumption that post ids are
    // strictly monotonic.
    pub posts: BTreeSet<PostId>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Summary {
    pub title: String,
    description: String,
    items: Vec<String>,
}

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct Timers {
    pub last_weekly: Time,
    pub last_daily: Time,
    pub last_hourly: Time,

    pub weekly_pending: bool,
    pub daily_pending: bool,
    pub hourly_pending: bool,
}

#[derive(Default, Serialize, Deserialize)]
pub struct State {
    pub auction: Auction,

    pub burned_cycles: i64,
    pub posts: BTreeMap<PostId, Post>,
    pub users: BTreeMap<UserId, User>,
    pub principals: HashMap<Principal, UserId>,
    pub next_post_id: PostId,
    pub next_user_id: UserId,
    pub accounting: Invoices,
    pub storage: storage::Storage,

    pub logger: Logger,
    pub invite_codes: BTreeMap<String, Invite>,
    pub realms: BTreeMap<RealmId, Realm>,

    #[serde(skip)]
    pub balances: HashMap<Account, Token>,

    #[serde(skip)]
    // new principal -> old principal
    pub principal_change_requests: BTreeMap<Principal, Principal>,

    total_revenue_shared: u64,
    total_rewards_shared: u64,

    pub proposals: Vec<Proposal>,

    // Contains the pair of two amounts (vested, total_vesting) describing
    // the vesting progress of X (see "Founder's Tokens" in white paper)
    pub vesting_tokens_of_x: (Token, Token),

    pub memory: memory::Memory,

    pub pfps: HashSet<String>,

    pub domains: HashMap<String, DomainConfig>,

    // This runtime flag has to be set in order to mint new tokens.
    #[serde(skip)]
    pub minting_mode: bool,
    #[serde(skip)]
    pub module_hash: String,
    #[serde(skip)]
    pub last_upgrade: u64,

    #[serde(skip)]
    pub token_fees_burned: Token,

    #[serde(skip)]
    pub emergency_binary: Vec<u8>,
    #[serde(skip)]
    pub emergency_votes: BTreeMap<Principal, Token>,

    pending_polls: BTreeSet<PostId>,

    pending_nns_proposals: BTreeMap<u64, PostId>,

    pub last_nns_proposal: u64,

    pub root_posts_index: Vec<PostId>,

    e8s_for_one_xdr: u64,

    #[serde(default)]
    pub sats_for_one_xdr: u64,

    #[serde(default)]
    pub bitcoin_treasury_sats: u64,

    #[serde(default)]
    pub bitcoin_treasury_address: String,

    last_revenues: VecDeque<u64>,

    pub distribution_reports: Vec<Summary>,

    pub tag_indexes: HashMap<String, TagIndex>,

    // Indicates whether the end of the stable memory contains a valid heap snapshot.
    #[serde(skip)]
    pub backup_exists: bool,

    #[serde(skip)]
    pub weekly_chores_delay_votes: HashSet<UserId>,

    pub timers: Timers,

    #[serde(default)]
    // Maps temporal session principals (delegates) created on custom domains to canonical user principals.
    delegations: HashMap<Principal, (Principal, String, Time)>,

    #[serde(skip)]
    pub cold_wallets: HashMap<Principal, UserId>,
}

#[derive(Default, Deserialize, Serialize)]
pub struct Logger {
    pub events: BTreeMap<String, Vec<Event>>,
}

impl Logger {
    fn critical<T: ToString>(&mut self, message: T) {
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

    pub fn clean_up(&mut self, cutoff_time: u64) {
        for events in self.events.values_mut() {
            events.retain(|event| event.timestamp > cutoff_time);
        }
    }
}

#[derive(PartialEq)]
pub enum Destination {
    Rewards,
    Credits,
}

impl State {
    pub fn toggle_account_activation(
        &mut self,
        caller: Principal,
        seed: String,
    ) -> Result<usize, String> {
        if seed.len() > 300 {
            return Err("seed too long".into());
        }

        let (username, len, is_deactivated) = {
            let user = self.principal_to_user_mut(caller).ok_or("user not found")?;
            user.change_credits(
                CONFIG.feature_cost,
                CreditsDelta::Minus,
                "profile privacy change",
            )?;
            let len = user.posts.len();
            let username = user.name.clone();
            user.deactivated = !user.deactivated;
            let is_deactivated = user.deactivated;

            for post_id in user.posts.clone() {
                Post::crypt(self, post_id, &seed);
            }

            (username, len, is_deactivated)
        };

        let _ = self.system_message(
            if is_deactivated {
                format!("Account @{} was deactivated. 😢", username)
            } else {
                format!("Account @{} is active again! 🎉", username)
            },
            CONFIG.dao_realm.into(),
        );

        Ok(len)
    }

    pub fn create_backup(&mut self) {
        if self.backup_exists {
            return;
        }
        // Don't back up invite codes.
        let invites = std::mem::take(&mut self.invite_codes);
        memory::heap_to_stable(self);
        self.invite_codes = invites;
        self.memory.init();
        self.backup_exists = true;
        self.logger.debug("Backup created");
    }

    pub fn register_post_tags(&mut self, post_id: PostId, tags: &BTreeSet<String>) {
        for tag in tags {
            let index = self.tag_indexes.entry(tag.clone()).or_default();
            index.posts.insert(post_id);
            while index.posts.len() > 1000 {
                index.posts.pop_first();
            }
        }
    }

    pub fn delay_weekly_chores(&mut self, caller: Principal) -> bool {
        let Some(user) = self
            .principal_to_user(caller)
            .and_then(|user| user.stalwart.then_some(user))
        else {
            return false;
        };

        // If we shifted already or one is ongoing, exit.
        if self.timers.last_weekly >= time() + WEEK || self.timers.weekly_pending {
            return false;
        }

        self.weekly_chores_delay_votes.insert(user.id);

        let stalwart_count = self.users.values().filter(|user| user.stalwart).count();
        if stalwart_count > 0
            && self.weekly_chores_delay_votes.len() * 100 / stalwart_count
                >= CONFIG.report_confirmation_percentage as usize
        {
            self.timers.last_weekly += WEEK;
            self.logger.info(format!(
                "Minting was delayed by stalwarts: {:?}",
                self.weekly_chores_delay_votes
                    .iter()
                    .map(|id| self
                        .users
                        .get(id)
                        .map(|user| user.name.clone())
                        .unwrap_or_default())
                    .collect::<Vec<_>>()
            ));
        }

        true
    }

    pub fn tags_cost(&self, tags: Box<dyn Iterator<Item = &'_ String> + '_>) -> Credits {
        tags.fold(0, |acc, tag| {
            acc + self
                .tag_indexes
                .get(tag.to_lowercase().as_str())
                .map(|index| index.subscribers)
                .unwrap_or_default()
        }) as Credits
    }

    pub fn link_cold_wallet(&mut self, caller: Principal, user_id: UserId) -> Result<(), String> {
        if self.principal_to_user(caller).is_some() || self.cold_wallets.contains_key(&caller) {
            return Err("this wallet is linked already".into());
        }
        let user = self.users.get_mut(&user_id).ok_or("user not found")?;
        if user.cold_wallet.is_some() {
            return Err("this user has already a cold wallet".into());
        }
        user.cold_wallet = Some(caller);
        user.cold_balance = self
            .balances
            .get(&account(caller))
            .copied()
            .unwrap_or_default();
        self.cold_wallets.insert(caller, user.id);
        Ok(())
    }

    pub fn unlink_cold_wallet(&mut self, caller: Principal) -> Result<(), String> {
        if self.voted_on_emergency_proposal(caller) {
            return Err("a vote on a pending proposal detected".into());
        }
        if let Some(user) = self.principal_to_user_mut(caller) {
            let principal = user.cold_wallet.take();
            user.cold_balance = 0;
            if let Some(principal) = principal {
                self.cold_wallets.remove(&principal);
            }
        }
        Ok(())
    }

    pub fn voted_on_emergency_proposal(&self, principal: Principal) -> bool {
        self.emergency_votes.contains_key(&principal)
    }

    pub async fn finalize_upgrade() {
        let current_hash = canisters::status(id())
            .await
            .ok()
            .and_then(|s| s.module_hash.map(hex::encode))
            .unwrap_or_default();
        mutate(|state| {
            state.module_hash.clone_from(&current_hash);
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

    pub fn active_voters(&self, time: u64) -> Box<dyn Iterator<Item = (UserId, Token)> + '_> {
        Box::new(
            self.users
                .values()
                .filter(move |user| {
                    user.organic()
                        && user.active_within(CONFIG.voting_power_activity_weeks, WEEK, time)
                })
                .map(move |user| (user.id, user.total_balance())),
        )
    }

    pub fn active_voting_power(&self, time: u64) -> Token {
        self.active_voters(time).map(|(_, balance)| balance).sum()
    }

    fn spend_to_user_rewards<T: ToString>(&mut self, user_id: UserId, amount: Credits, log: T) {
        let user = self.users.get_mut(&user_id).expect("user not found");
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
        user_id: UserId,
        amount: Credits,
        log: T,
    ) -> Result<(), String> {
        self.charge_in_realm(user_id, amount, None, log)
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
        let user = self.users.get_mut(&id).ok_or("user not found")?;
        // don't charge for system messages
        if !user.organic() {
            return Ok(());
        }
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
        let sender = self.users.get_mut(&sender_id).ok_or("no sender found")?;
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

    pub fn init(&mut self) {
        self.domains
            .insert("localhost".into(), DomainConfig::default());
        assets::load(&self.domains);
        match token::balances_from_ledger(&mut self.memory.ledger.iter().map(|(_, tx)| tx)) {
            Ok((balances, total_fees)) => {
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
                self.token_fees_burned = total_fees;
            }
            Err(err) => self
                .logger
                .critical(format!("the token ledger is inconsistent: {}", err)),
        }
        if self.principal_to_user(id()).is_none() {
            let canister_id = id();
            let system_user_id = MAX_USER_ID;
            let system_user = User::new(canister_id, system_user_id, time(), id().to_text());
            self.users.insert(system_user_id, system_user);
            self.principals.insert(canister_id, system_user_id);
        }
        if !self.realms.contains_key(CONFIG.dao_realm) {
            self.realms.insert(
                CONFIG.dao_realm.to_string(),
                Realm::new(
                    "The default DAO realm. ".to_string()
                        + "The controller list is updated weekly according to the stalwarts list.",
                ),
            );
        }
        if !self.realms.contains_key(CONFIG.stalwarts_realm) {
            self.realms.insert(
                CONFIG.stalwarts_realm.to_string(),
                Realm::new("The default stalwarts realm. Only stalwarts can post here.".into()),
            );
        }
        if self.auction.amount == 0 {
            self.auction.amount = CONFIG.weekly_auction_size_tokens_max;
        }
        self.last_upgrade = time();
        self.timers.last_hourly = time();
    }

    pub fn realms_posts(
        &self,
        domain: String,
        caller: Principal,
        offset: PostId,
    ) -> Box<dyn Iterator<Item = &'_ Post> + '_> {
        let realm_ids = match self
            .principal_to_user(caller)
            .map(|user| user.realms.as_slice())
        {
            None | Some(&[]) => return Box::new(std::iter::empty()),
            Some(ids) => ids.iter().collect::<BTreeSet<_>>(),
        };

        let iterators: Vec<Box<dyn Iterator<Item = &'_ Post>>> = realm_ids
            .iter()
            .map(move |realm_id| self.last_posts(domain.clone(), Some(realm_id), offset, 0, false))
            .collect();

        Box::new(IteratorMerger::new(MergeStrategy::Or, iterators))
    }

    pub fn hot_posts(
        &self,
        domain: String,
        realm: Option<&RealmId>,
        offset: PostId,
        filter: Option<&dyn Fn(&Post) -> bool>,
    ) -> Box<dyn Iterator<Item = &'_ Post> + '_> {
        let mut hot_posts = self
            .last_posts(domain, realm, offset, 0, false)
            .filter(|post| {
                // we exclude NSFW posts unless the query comes for the realm of the post
                (!post.with_meta(self).1.nsfw || post.realm.as_ref() == realm)
                    && !matches!(post.extension, Some(Extension::Proposal(_)))
                    && filter.map(|f| f(post)).unwrap_or(true)
            })
            .take(1000)
            .collect::<Vec<_>>();
        hot_posts.sort_unstable_by_key(|post| Reverse(post.heat()));
        Box::new(hot_posts.into_iter())
    }

    pub fn toggle_realm_membership(&mut self, principal: Principal, realm_id: RealmId) -> bool {
        let user_id = match self.principal_to_user(principal) {
            Some(user) => user.id,
            _ => return false,
        };

        let Some(user) = self.users.get_mut(&user_id) else {
            return false;
        };

        let Some(realm) = self.realms.get_mut(&realm_id) else {
            return false;
        };

        if user.realms.contains(&realm_id) {
            user.realms.retain(|realm| realm != &realm_id);
            realm.num_members -= 1;
            return false;
        }

        realm.num_members += 1;
        user.realms.push(realm_id.clone());
        user.filters.realms.remove(&realm_id);
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn edit_realm(
        &mut self,
        principal: Principal,
        realm_id: String,
        realm: Realm,
    ) -> Result<(), String> {
        realm.validate()?;

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
            comments_filtering,
            tokens,
            max_downvotes,
            ..
        } = realm;
        let user = self.principal_to_user(principal).ok_or("user not found")?;
        let user_id = user.id;
        let user_name = user.name.clone();
        let realm = self.realms.get_mut(&realm_id).ok_or("no realm found")?;
        if !realm.controllers.contains(&user_id) {
            return Err("not authorized".into());
        }
        if controllers.is_empty() {
            return Err("no controllers specified".into());
        }
        if !logo.is_empty() {
            realm.logo = logo;
        }
        if tokens.as_ref().is_some_and(|t| t.len() > 50) {
            return Err("tokens count above 50".into());
        }
        let description_change = realm.description != description;
        realm.description = description;
        if realm.controllers != controllers {
            let mut old_names = Vec::default();
            let mut new_names = Vec::default();
            for user_id in &realm.controllers {
                let controller = self.users.get_mut(user_id).expect("user not found");
                controller.controlled_realms.remove(&realm_id);
                old_names.push(controller.name.clone());
            }
            for user_id in &controllers {
                let controller = self.users.get_mut(user_id).expect("user not found");
                controller.controlled_realms.insert(realm_id.clone());
                new_names.push(controller.name.clone());
            }
            self.logger.info(format!(
                "Realm /{} controller list was changed from {:?} to {:?}",
                realm_id, old_names, new_names
            ));
        }
        realm.controllers = controllers;
        realm.label_color = label_color;
        realm.theme = theme;
        realm.whitelist = whitelist;
        realm.filter = filter;
        realm.cleanup_penalty = CONFIG.max_realm_cleanup_penalty.min(cleanup_penalty);
        realm.max_downvotes = max_downvotes;
        realm.last_setting_update = time();
        realm.adult_content = adult_content;
        realm.comments_filtering = comments_filtering;
        realm.tokens = tokens;
        if description_change {
            self.notify_with_filter(
                &|user| user.realms.contains(&realm_id),
                format!(
                    "@{} changed the description of the realm /{}! ",
                    user_name, realm_id
                ) + "Please read the new description to avoid potential penalties for rules violation!",
            );
        }
        Ok(())
    }

    pub fn tip(
        &mut self,
        principal: Principal,
        post_id: PostId,
        amount: u64,
    ) -> Result<(), String> {
        let tipper = self.principal_to_user(principal).ok_or("user not found")?;
        let tipper_id = tipper.id;
        let tipper_name = tipper.name.clone();
        // DoS protection
        self.charge(tipper_id, CONFIG.tipping_cost, "tipping".to_string())?;
        let author_id = Post::get(self, &post_id).ok_or("post not found")?.user;
        let author = self.users.get(&author_id).ok_or("user not found")?;
        token::transfer(
            self,
            time(),
            principal,
            TransferArgs {
                from_subaccount: None,
                to: account(author.principal),
                fee: Some(0), // special tipping fee
                amount: amount as u128,
                memo: Some(format!("Tips on post {}", post_id).as_bytes().to_vec()),
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
        let mut user = User::new(principal, id, timestamp, name.clone());
        user.notify(format!("**Welcome!** 🎉 Use #{} as your personal blog, micro-blog or a photo blog. Use #hashtags to connect with others. Make sure you understand [how {0} works](/#/whitepaper). And finally, [say hello](#/new) and start earning rewards!", CONFIG.name));
        if let Some(credits) = credits {
            user.change_credits(credits, CreditsDelta::Plus, "topped up by an invite")
                .expect("couldn't add credits when creating a new user");
        }
        self.principals.insert(principal, user.id);
        self.users.insert(user.id, user);
        self.set_pfp(id, Default::default())
            .expect("couldn't set default pfp");
        let _ = self.system_message(
            format!("@{} joined {}!", name, CONFIG.name),
            CONFIG.dao_realm.into(),
        );
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

    /// Assigns a new Avataggr to the user.
    pub fn set_pfp(&mut self, user_id: UserId, pfp: Pfp) -> Result<(), String> {
        let bytes = pfp::pfp(
            user_id,
            pfp.nonce,
            pfp.palette_nonce,
            pfp.colors,
            /* scale = */ 4,
        );
        let mut hasher = Sha256::new();
        hasher.update(bytes.as_slice());
        let hash = format!("{:x}", hasher.finalize())[..32].to_string();
        // We ignore collisions on genesis (i.e. randomized) avatars.
        if !pfp.genesis && self.pfps.contains(&hash) {
            return Err("avataggr is not unique".into());
        }
        self.users.get_mut(&user_id).ok_or("user not found")?.pfp = pfp;
        self.pfps.insert(hash);
        Ok(())
    }

    pub fn system_message(&mut self, body: String, realm: RealmId) -> Result<PostId, String> {
        Post::create(
            self,
            body,
            Default::default(),
            id(),
            time(),
            None,
            Some(realm),
            None,
        )
    }

    pub fn create_invite(
        &mut self,
        principal: Principal,
        credits: Credits,
        credits_per_user_opt: Option<Credits>,
        realm_id: Option<RealmId>,
    ) -> Result<(), String> {
        let credits_per_user = credits_per_user_opt.unwrap_or(credits);
        if !credits.is_multiple_of(credits_per_user) {
            return Err("credits per user are not a multiple of credits".into());
        }
        let min_credits = CONFIG.min_credits_for_inviting;
        let user = self.principal_to_user(principal).ok_or("user not found")?;

        let min_age_days = 7;
        if user.invited_by.is_some() && user.account_age(DAY) < min_age_days {
            return Err(format!(
                "cannot create invites from account with age below {} days",
                min_age_days
            ));
        }

        if credits_per_user < min_credits {
            return Err(format!(
                "smallest invite must contain {} credits",
                min_credits
            ));
        }

        self.validate_realm_id(realm_id.as_ref())?;
        invite::validate_user_invites_credits(self, user, credits, None)?;

        let mut hasher = Sha256::new();
        hasher.update(principal.as_slice());
        hasher.update(time().to_be_bytes());
        let code = format!("{:x}", hasher.finalize())[..10].to_string();
        let user_id = user.id;
        let invite = Invite::new(credits, credits_per_user, realm_id, user_id);
        self.invite_codes.insert(code, invite);

        Ok(())
    }

    pub fn update_invite(
        &mut self,
        principal: Principal,
        invite_code: String,
        credits: Option<Credits>,
        realm_id: Option<RealmId>,
    ) -> Result<(), String> {
        if credits.is_none() && realm_id.is_none() {
            return Err("update is empty".into());
        }
        let user = self.principal_to_user(principal).ok_or("user not found")?;
        let user_id = user.id;

        self.validate_realm_id(realm_id.as_ref())?;

        let Invite {
            credits: invite_credits,
            ..
        } = self
            .invite_codes
            .get(&invite_code)
            .ok_or(format!("invite '{}' not found", invite_code))?;
        if let Some(credits) = credits {
            invite::validate_user_invites_credits(self, user, credits, Some(*invite_credits))?;
        }

        self.invite_codes
            .get_mut(&invite_code)
            .ok_or(format!("invite '{}' not found", invite_code))?
            .update(credits, realm_id, user_id)?;
        Ok(())
    }

    pub fn critical<T: ToString>(&mut self, message: T) {
        self.logger.critical(message.to_string());
        self.users.values_mut().for_each(|user| {
            user.notify(format!("CRITICAL SYSTEM ERROR: {}", message.to_string()))
        });
        if let Err(message) = Post::create(
            self,
            format!("# CRITICAL SYSTEM ERROR! 🚨\n\n{}", message.to_string()),
            Default::default(),
            id(),
            time(),
            None,
            Some(CONFIG.dao_realm.into()),
            None,
        ) {
            self.logger
                .error(format!("Couldn't post critical error: {}", message));
        }
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

    /// Takes the market_price (e8s per 1 token) and mints new tokens for all miners with positive
    /// rewards according to the market price ratio.
    pub fn mint(&mut self, market_price: u64) {
        if market_price == 0 {
            self.logger.warn("Skipping minting: no market price");
            return;
        }

        let mut summary = Summary {
            title: "Token minting report".into(),
            description: Default::default(),
            items: Vec::default(),
        };

        let mut tokens_to_mint = Vec::new();
        let mut total_tokens_to_mint: u64 = 0;
        let token_base = token::base();

        for user in self
            .users
            .values_mut()
            .filter(|user| user.mode == Mode::Mining)
        {
            let rewards = user.rewards();
            if rewards <= 0 {
                continue;
            }

            let e8s_earned = (rewards as f64 / CONFIG.credits_per_xdr as f64
                * self.e8s_for_one_xdr as f64) as u64;
            let tokens_earned = e8s_earned / market_price;
            if tokens_earned == 0 {
                continue;
            }

            if total_tokens_to_mint + tokens_earned > CONFIG.max_funding_amount {
                self.logger.warn(format!(
                "Safety measure: stopping the minting because the amount of the newly minted tokens (`{}`) exceeds the configured weekly limit of `{}` (the remaining tokens will be minted during the next distribution)",
                total_tokens_to_mint / token_base,
                CONFIG.max_funding_amount / token_base
            ));
                break;
            }

            // burn a corresponding amount credits to generate revenue
            self.burned_cycles += rewards;
            user.take_positive_rewards();
            tokens_to_mint.push((user.id, tokens_earned));
            total_tokens_to_mint += tokens_earned;
        }

        if total_tokens_to_mint == 0 {
            self.logger.warn("Skipping minting: no new tokens to mint");
            return;
        }

        let mut items = Vec::default();
        let mut minted_tokens = 0;
        let base = token::base();
        for (user_id, tokens) in tokens_to_mint {
            let minted_fractional = tokens as f64 / base as f64;
            if let Some(user) = self.users.get_mut(&user_id) {
                user.notify(format!(
                    "{} minted `{}` ${} tokens for you! 💎",
                    CONFIG.name, minted_fractional, CONFIG.token_symbol,
                ));
                items.push((tokens, minted_fractional, user.name.clone()));
                let acc = account(user.principal);
                crate::token::mint(self, acc, tokens, "weekly mint");
                minted_tokens += tokens;
            }
        }

        items.sort_unstable_by_key(|(minted, _, _)| Reverse(*minted));
        for (_, minted, name) in &items {
            summary.items.push(format!("`{}` to @{}", minted, name));
        }

        // Mint team tokens
        self.vest_tokens_of_x();

        if summary.items.is_empty() {
            self.logger.info("No tokens were minted".to_string());
        } else {
            summary.description = format!(
                "{} minted `{}` ${} tokens 💎 from earned rewards",
                CONFIG.name,
                minted_tokens / base,
                CONFIG.token_symbol
            );
            self.distribution_reports.push(summary);
        }
    }

    // See the section "Founder's Tokens" in the white paper.
    fn vest_tokens_of_x(&mut self) {
        let (vested, total_vesting) = &mut self.vesting_tokens_of_x;
        let user = self.users.get(&0).expect("user 0 doesn't exist");
        let principal = user.principal;
        let total_balance = user.total_balance();
        let vesting_left = total_vesting.saturating_sub(*vested);
        if vesting_left == 0 {
            return;
        }

        let circulating_supply: Token = self.balances.values().sum();
        // 1% of circulating supply is vesting.
        let next_vesting = (circulating_supply / 100).min(vesting_left);
        // We use 14% because 1% will vest and we want to stay below 15%.
        let cap = (circulating_supply * 14) / 100;

        // Vesting is allowed if the vested tokens OR the total current balance
        // of the founder stays below 15% of the current supply, or if 2/3 of total
        // supply is minted.
        let balance = total_balance.max(*vested);
        if balance <= cap || circulating_supply * 3 > CONFIG.maximum_supply * 2 {
            *vested += next_vesting;
            let new_vesting_left = *total_vesting - *vested;
            crate::token::mint(self, account(principal), next_vesting, "vesting");
            self.logger.info(format!(
                "Minted `{}` team tokens for @X (still vesting: `{}`).",
                next_vesting / 100,
                new_vesting_left / 100
            ));
        }
    }

    /// Returns all rewards that need to be paid out. Skips all miners.
    pub fn collect_new_rewards(&mut self) -> HashMap<UserId, u64> {
        let mut payouts = HashMap::default();

        for user in self
            .users
            .values_mut()
            .filter(|user| user.mode != Mode::Mining)
        {
            let rewards = user.take_positive_rewards();
            if rewards == 0 {
                continue;
            };
            // Rewards are burned for system users and those who are in auto top-up mode.
            if !user.organic() || user.mode == Mode::Credits {
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
                    "users' ICP couldn't be transferred from the treasury: {err}"
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
            title: "DAO revenue".into(),
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
            if user_reward > 0 || user_revenue > 0 {
                let mut notification = String::from("You received ");
                if user_reward > 0 {
                    notification.push_str(&format!(
                        "`{}` ICP as rewards",
                        display_tokens(user_reward, 8)
                    ));
                }
                if user_revenue > 0 {
                    if user_reward > 0 {
                        notification.push_str(" and ");
                    }
                    notification.push_str(&format!(
                        "`{}` ICP as revenue",
                        display_tokens(user_revenue, 8)
                    ));
                }
                notification.push_str("! 💸");
                user.notify(notification);
            }
        }
        if self.burned_cycles > 0 {
            self.spend(self.burned_cycles as Credits, "revenue distribution");
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

            if let Err(err) = state.archive_cold_data() {
                state
                    .logger
                    .error(format!("couldn't archive cold data: {:?}", err));
            }
        });

        export_token_supply(token::icrc1_total_supply());
    }

    fn archive_cold_data(&mut self) -> Result<(), String> {
        // Since cold archiving can potentially write data to the end of the stable memory, we set this flag to false
        // because the space used might hold the latest heap and the backups pulled from the canister will be corrupted.
        // Setting the flag back to false will lead to re-creating of the heap upon the next backup request.
        self.backup_exists = false;
        let max_posts_in_heap = 10_000;
        archive_cold_posts(self, max_posts_in_heap)
    }

    pub async fn fetch_xdr_rate() {
        let e8s_for_one_xdr = canisters::coins_for_one_xdr("ICP")
            .await
            // by default use ~$5/ICP
            .unwrap_or(28082976);
        let sats_for_one_xdr = canisters::coins_for_one_xdr("BTC")
            .await
            // by default use ~$86k/BTC
            .unwrap_or(1609);
        mutate(|state| {
            state.sats_for_one_xdr = sats_for_one_xdr;
            state.e8s_for_one_xdr = e8s_for_one_xdr;
        });
    }

    pub fn get_xdr_rate() -> u64 {
        read(|state| state.e8s_for_one_xdr)
    }

    #[cfg(any(test, feature = "dev"))]
    pub fn reset_xdr_rate_for_testing() {
        mutate(|state| {
            // If this is set to 1_000_000 and above, then E2E tests fail.
            state.e8s_for_one_xdr = 900_000;
        });
    }

    pub async fn hourly_chores(now: u64) {
        mutate(|state| {
            state.backup_exists = false;
            state.conclude_polls(now);
        });

        State::fetch_xdr_rate().await;

        canisters::top_up().await;

        #[cfg(not(any(feature = "dev", feature = "staging")))]
        nns_proposals::work(now).await;

        invoices::process_btc_invoices().await;
    }

    pub async fn chores(now: u64) {
        // This should always be the first operation executed in the chores routine so
        // that the upgrades are never blocked by a panic in any other routine.
        if mutate(|state| {
            state.execute_pending_emergency_upgrade(false) || state.execute_pending_upgrade(false)
        }) {
            return;
        }

        let timers = read(|state| state.timers.clone());

        let log = |state: &mut State, frequency, threshold_millis| {
            let instructions = performance_counter(0) / 1000000000;
            let millis = (time() - now) / MILLISECOND;
            if millis > threshold_millis {
                state.logger.debug(format!(
                    "{} routine finished after `{}` ms and used `{}B` instructions.",
                    frequency, millis, instructions
                ))
            }
        };

        if timers.last_weekly + WEEK < now && !timers.weekly_pending {
            mutate(|state| {
                state.timers.weekly_pending = true;
            });
            State::weekly_chores(now).await;
            mutate(|state| {
                state.timers.last_weekly += WEEK;
                state.timers.weekly_pending = false;
                log(state, "Weekly", 0);
            });
        }

        if timers.last_daily + DAY < now && !timers.daily_pending {
            mutate(|state| {
                state.timers.daily_pending = true;
            });
            State::daily_chores(now).await;
            mutate(|state| {
                state.timers.last_daily += DAY;
                state.timers.daily_pending = false;
                let (btc, nns, polls) = (
                    state.accounting.pending_btc_invoices.len(),
                    state.pending_nns_proposals.len(),
                    state.pending_polls.len(),
                );
                let mut log_line = String::new();
                if btc > 0 {
                    log_line.push_str(&format!("Pending BTC invoices: `{}`. ", btc,));
                }
                if nns > 0 {
                    log_line.push_str(&format!("Pending NNS proposals: `{}`. ", nns,));
                }
                if polls > 0 {
                    log_line.push_str(&format!("Pending polls: `{}`.", polls,));
                }
                if !log_line.is_empty() {
                    state.logger.debug(log_line);
                }
                log(state, "Daily", 1000);
            });
        }

        if timers.last_hourly + HOUR < now && !timers.hourly_pending {
            mutate(|state| {
                state.timers.hourly_pending = true;
            });
            State::hourly_chores(now).await;
            mutate(|state| {
                state.timers.last_hourly += HOUR;
                state.timers.hourly_pending = false;
                log(state, "Hourly", 3 * 60_000);
            });
        }
    }

    pub async fn weekly_chores(now: Time) {
        mutate(|state| {
            state.distribution_reports.clear();
            state.distribute_realm_revenue(now);
        });

        #[cfg(not(feature = "dev"))] // don't create rewards in e2e tests
        State::random_reward().await;

        let circulating_supply: Token = read(|state| state.balances.values().sum());
        // only if we're below the maximum supply, we close the auction
        let auction_revenue = if circulating_supply < CONFIG.maximum_supply {
            let (market_price, revenue) = auction::close_auction().await;
            mutate(|state| {
                state.logger.info(format!(
                    "Established market price: `{}` ICP per `1` ${}; next auction size: `{}` tokens",
                    display_tokens(market_price * token::base(), 8),
                    CONFIG.token_symbol,
                    state.auction.amount / token::base()
                ));

                state.minting_mode = true;
                state.mint(market_price);
                state.minting_mode = false;
            });
            revenue
        } else {
            0
        };

        State::distribute_icp().await;

        mutate(|state| {
            for summary in &state.distribution_reports {
                state.logger.info(format!(
                    "{}: {} [[details](#/distribution)]",
                    summary.title, summary.description
                ));
            }

            state.clean_up(now);
            state.logger.clean_up(now - 6 * MONTH);

            // these burned credits go to the next week
            state.distribute_revenue_from_icp(auction_revenue);
            state.charge_for_inactivity(now);
        });
    }

    // Rewards a random user with a fixed amount of minted tokens.
    // Users have a winning chance proportional to their weekly credits spending.
    #[allow(dead_code)]
    async fn random_reward() {
        if let Ok((randomness,)) = raw_rand().await {
            use std::convert::TryInto;
            let bytes: [u8; 8] = randomness[0..8]
                .try_into()
                .expect("couldn't convert bytes to array");
            let mut random_number: u64 = u64::from_be_bytes(bytes);

            mutate(|state| {
                // Creating random distribution of users with segments proportional to credits
                // spent within the last week. Segments are placed randomly.
                let mut allocation = Vec::new();
                let mut threshold = 0;
                for user in state.users.values_mut().filter(|user| {
                    !user.controversial()
                        && user.organic()
                        && user.active_within(1, WEEK, time())
                        && user.credits_burned() > 0
                }) {
                    threshold += user.take_credits_burned();
                    allocation.push((user.id, threshold));
                }
                if threshold == 0 {
                    return;
                }

                // Truncate the random number so that every single user has a chance to win.
                random_number %= threshold;

                let Some((winner_name, winner_principal)) = allocation
                    .into_iter()
                    .find(|(_, threshold)| threshold > &random_number)
                    .and_then(|(user_id, _)| state.users.get(&user_id))
                    .map(|user| (user.name.clone(), user.principal))
                else {
                    return;
                };

                let _ = state.system_message(
                    format!(
                        "@{} is the lucky receiver of `{}` ${} as a weekly random reward! 🎲",
                        winner_name,
                        CONFIG.random_reward_amount / base(),
                        CONFIG.token_symbol,
                    ),
                    CONFIG.dao_realm.into(),
                );
                state.minting_mode = true;
                crate::token::mint(
                    state,
                    account(winner_principal),
                    CONFIG.random_reward_amount,
                    "random rewards",
                );
                state.minting_mode = false;
                state
                    .principal_to_user_mut(winner_principal)
                    .expect("user not found")
                    .notify(format!(
                        "Congratulations! You received `{}` ${} as a weekly random reward! 🎲",
                        CONFIG.random_reward_amount / base(),
                        CONFIG.token_symbol,
                    ));
            });
        };
    }

    pub fn distribute_revenue_from_icp(&mut self, e8s: u64) {
        self.burned_cycles +=
            (e8s as f64 / self.e8s_for_one_xdr as f64 * CONFIG.credits_per_xdr as f64) as i64;
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
                .filter(|user| user.active_within(1, WEEK, now))
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

    // Refresh tag costs, mark inactive users as inactive, close inactive realms
    fn clean_up(&mut self, now: Time) {
        for tag in self.tag_indexes.values_mut() {
            tag.subscribers = 0;
        }

        let mut inactive_users = Vec::new();

        let mut realms_cleaned = Vec::default();
        for user in self.users.values_mut() {
            // If a user is inactive for a year, remove them from all realms they
            // control.
            if !user.active_within(CONFIG.realm_inactivity_timeout_days, DAY, now) {
                for realm_id in std::mem::take(&mut user.controlled_realms) {
                    realms_cleaned.push(format!("/{}", realm_id));
                    if let Some(realm) = self.realms.get_mut(&realm_id) {
                        realm
                            .controllers
                            .retain(|controller_id| controller_id != &user.id);
                    }
                }
            }

            if user.active_within(1, WEEK, now) {
                user.active_weeks += 1;

                // Count this active user's subscriptions
                for tag in user.feeds.iter().flat_map(|feed| feed.iter()) {
                    if let Some(index) = self.tag_indexes.get_mut(tag) {
                        index.subscribers += 1
                    }
                }
            } else {
                user.deactivate();
                inactive_users.push(user.id);
            }
            user.post_reports
                .retain(|_, timestamp| *timestamp + CONFIG.user_report_validity_days * DAY >= now);
        }
        self.logger.info(format!(
            "Removed inactive controllers from realms {}.",
            realms_cleaned.join(", ")
        ));

        self.accounting.clean_up(now);

        let inactive_realm_ids = self
            .realms
            .iter()
            // Find all realms that:
            // - have no activity for `CONFIG.realm_inactivity_timeout_days` days
            // - have all controllers inactive
            // - have no posts
            .filter_map(|(id, realm)| {
                (realm.last_update + CONFIG.realm_inactivity_timeout_days * DAY < now
                    && realm
                        .controllers
                        .iter()
                        .all(|controller_id| inactive_users.contains(controller_id))
                    && realm.posts.is_empty())
                .then_some(id)
            })
            .cloned()
            .collect::<HashSet<_>>();

        for user in self.users.values_mut() {
            user.realms
                .retain(|realm_id| !inactive_realm_ids.contains(realm_id));
        }

        for realm_id in inactive_realm_ids {
            if CONFIG.dao_realm == realm_id || CONFIG.stalwarts_realm == realm_id {
                continue;
            }
            let realm = self.realms.remove(&realm_id).expect("no realm found");
            for controller_id in &realm.controllers {
                if let Some(user) = self.users.get_mut(controller_id) {
                    user.controlled_realms.remove(&realm_id);
                }
            }
            self.logger.info(format!(
                "Realm {} controlled by @{} removed due to inactivity during `{}` days",
                realm_id,
                realm
                    .controllers
                    .iter()
                    .map(|user_id| self
                        .users
                        .get(user_id)
                        .map(|v| v.name.clone())
                        .unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join(", "),
                CONFIG.realm_inactivity_timeout_days,
            ));
        }

        // Remove all sessions older than 4 weeks.
        self.delegations
            .retain(|_, (_, _, time)| *time + WEEK * 4 > now);
    }

    fn charge_for_inactivity(&mut self, now: u64) {
        let mut inactive_users = 0;
        // Don't charge below this credit balance
        let inactive_user_balance_threshold = CONFIG.inactivity_penalty * 4;
        let mut charges = Vec::new();
        for user in self.users.values_mut() {
            if !user.active_within(WEEK, CONFIG.voting_power_activity_weeks, now) {
                user.mode = Mode::Credits;
            }
            if user.active_within(WEEK, CONFIG.inactivity_duration_weeks, now) {
                continue;
            }
            inactive_users += 1;
            let costs = CONFIG.inactivity_penalty.min(
                user.credits()
                    .saturating_sub(inactive_user_balance_threshold),
            );
            charges.push((user.id, costs));
        }

        let mut credits_total = 0;
        for (user_id, costs) in charges {
            if costs > 0 {
                if let Err(err) = self.charge(user_id, costs, "inactivity penalty".to_string()) {
                    self.logger
                        .warn(format!("Couldn't charge inactivity penalty: {:?}", err));
                } else {
                    credits_total += costs;
                }
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
                || !u.organic()
                || u.is_bot()
                || u.controversial()
                || now.saturating_sub(u.timestamp) < WEEK * CONFIG.min_stalwart_account_age_weeks
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

        let current_stalwarts = self
            .users
            .values()
            .filter(|u| u.stalwart)
            .map(|u| u.id)
            .collect::<Vec<_>>();

        if let Some(realm) = self.realms.get_mut(CONFIG.stalwarts_realm) {
            realm.controllers = current_stalwarts.iter().copied().collect();
            realm.whitelist = current_stalwarts.iter().copied().collect();
        }

        if let Some(realm) = self.realms.get_mut(CONFIG.dao_realm) {
            realm.controllers = current_stalwarts.iter().copied().collect();
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
                .ok_or("user not found".to_string())?;

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

    pub async fn mint_credits_with_icp(
        principal: Principal,
        kilo_credits: u64,
    ) -> Result<ICPInvoice, String> {
        if kilo_credits > CONFIG.max_credits_mint_kilos {
            return Err(format!(
                "can't mint more than {} thousands of credits",
                CONFIG.max_credits_mint_kilos
            ));
        }

        let e8s_for_one_xdr = read(|state| state.e8s_for_one_xdr);
        let invoice =
            Invoices::outstanding_icp_invoice(&principal, kilo_credits, e8s_for_one_xdr).await?;

        mutate(|state| {
            if invoice.paid {
                if let Some(user) = state.principal_to_user_mut(principal) {
                    user.change_credits(
                        ((invoice.paid_e8s as f64 / invoice.e8s as f64)
                            * CONFIG.credits_per_xdr as f64) as Credits,
                        CreditsDelta::Plus,
                        "top up with ICP".to_string(),
                    )?;
                    state.accounting.close_invoice(&principal);
                }
            }
            Ok(invoice)
        })
    }

    pub async fn mint_credits_with_btc(principal: Principal) -> Result<BTCInvoice, String> {
        let sats_for_one_xdr = read(|state| state.sats_for_one_xdr);
        let invoice = Invoices::outstanding_btc_invoice(&principal, sats_for_one_xdr).await?;

        let mut invoice_closed = false;
        let result = mutate(|state| {
            if invoice.paid {
                if let Some(user) = state.principal_to_user_mut(principal) {
                    user.change_credits(
                        ((invoice.balance as f64 / invoice.sats as f64)
                            * CONFIG.credits_per_xdr as f64) as Credits,
                        CreditsDelta::Plus,
                        "top up with Bitcoin".to_string(),
                    )?;
                    state.accounting.close_invoice(&principal);
                    invoice_closed = true;
                }
            }
            Ok(invoice)
        });

        // If we were able to close an invoice, spawn the processing
        // of pending btc invoices in a non-blocking way.
        if invoice_closed {
            let future = invoices::process_btc_invoices();
            spawn(async {
                let _ = future.await;
            });
        }

        result
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

    pub fn posts_by_tags_and_users<'a>(
        &'a self,
        domain: &String,
        realm_id: Option<RealmId>,
        offset: PostId,
        tags_and_users: &'a [String],
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let Some(domain_filter) = domain_realm_post_filter(self, domain, realm_id.as_ref()) else {
            return Box::new(std::iter::empty());
        };

        let filter = move |post: &Post| {
            !post.is_deleted() && (with_comments || post.parent.is_none()) && domain_filter(post)
        };

        let tags = tags_and_users
            .iter()
            .filter(|token| !token.starts_with('@'))
            .map(|tag| tag.to_lowercase())
            .collect::<Vec<_>>();
        let users = tags_and_users
            .iter()
            .filter(|word| word.starts_with('@'))
            .filter_map(|word| self.user(&word[1..]))
            .map(|user| user.id)
            .collect::<Vec<_>>();

        // If no users were provided, we simply return merged iterators over all tags.
        if users.is_empty() {
            return Box::new(
                IteratorMerger::new(
                    MergeStrategy::And,
                    tags.iter()
                        .map(|tag| {
                            let iterator: Box<dyn Iterator<Item = &PostId>> =
                                match self.tag_indexes.get(tag) {
                                    Some(index) => Box::new(index.posts.iter().rev()),
                                    None => Box::new(std::iter::empty()),
                                };
                            iterator
                        })
                        .collect(),
                )
                .skip_while(move |post_id| offset > 0 && *post_id > &offset)
                .filter_map(move |post_id| Post::get(self, post_id))
                .filter(move |post| filter(post)),
            );
        };

        // If users were provided, we or-merge their feeds and filter for tags.
        Box::new(
            IteratorMerger::new(
                MergeStrategy::Or,
                users
                    .into_iter()
                    .filter_map(|user_id| self.users.get(&user_id))
                    .map(|user| user.posts(Some(domain), self, offset, with_comments))
                    .collect(),
            )
            .filter(move |post| filter(post) && tags.iter().all(|tag| post.tags.contains(tag))),
        )
    }

    pub fn last_posts<'a>(
        &'a self,
        domain: String,
        realm_id: Option<&RealmId>,
        offset: PostId,
        watermark: Time,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let Some(cfg) = self.domains.get(&domain) else {
            return Box::new(std::iter::empty());
        };

        // This is generic filter that needs to be applied on all non-empty iterators.
        let post_filter = |iter: Box<dyn Iterator<Item = &'a Post> + 'a>| {
            Box::new(
                iter.take_while(move |post| post.creation_timestamp() >= watermark)
                    .filter(move |post| !post.is_deleted()),
            )
        };

        // Realm specified.
        if let Some(realm_id) = realm_id {
            // If the specified realm does not satisfy the domain config, we have no data.
            if !cfg.realm_visible(realm_id) {
                return Box::new(std::iter::empty());
            };

            // If realm is ok, simply iterate over all posts of this realm.
            if let Some(realm) = self.realms.get(realm_id) {
                return post_filter(Box::new(
                    realm
                        .posts
                        .iter()
                        .rev()
                        .skip_while(move |post_id| offset > 0 && post_id > &&offset)
                        .filter_map(move |i| Post::get(self, i)),
                ));
            }
        }

        // If realm is not set, we need a domain-specific filter.
        let Some(domain_filter) = domain_realm_post_filter(self, &domain, None) else {
            return Box::new(std::iter::empty());
        };

        // If we need to iterate over all posts including comments, apply domain filter.
        if with_comments {
            let last_id = if offset > 0 {
                offset
            } else {
                self.next_post_id
            };
            return post_filter(Box::new(
                (0..last_id)
                    .rev()
                    .filter_map(move |i| Post::get(self, &i))
                    .filter(move |p| domain_filter(p)),
            ));
        }

        match &cfg.sub_config {
            // If we only iterate over root posts and the domain config has no white list, accept all
            // posts except those with black-listed realms.
            DomainSubConfig::BlackListedRealms(list) => post_filter(Box::new(
                self.root_posts_index
                    .iter()
                    .rev()
                    .skip_while(move |post_id| offset > 0 && post_id > &&offset)
                    .copied()
                    .filter_map(move |i| Post::get(self, &i))
                    .filter(move |p| {
                        p.realm
                            .as_ref()
                            .map(|realm_id| !list.contains(realm_id))
                            .unwrap_or(true)
                    }),
            )),
            // If the domain config specifies a whitelist return a merger iterator over these realms.
            DomainSubConfig::WhiteListedRealms(list) => {
                let iterators: Vec<Box<dyn Iterator<Item = &'a PostId>>> = list
                    .iter()
                    .filter_map(move |id| self.realms.get(id))
                    .map(|realm| {
                        Box::new(
                            realm
                                .posts
                                .iter()
                                .rev()
                                .skip_while(move |post_id| offset > 0 && post_id > &&offset),
                        ) as Box<dyn Iterator<Item = &'a PostId>>
                    })
                    .collect();

                post_filter(Box::new(
                    IteratorMerger::new(MergeStrategy::Or, iterators)
                        .copied()
                        .filter_map(move |i| Post::get(self, &i)),
                ))
            }
            // In journal mode we simply show all user's posts
            DomainSubConfig::Journal(user_id) => {
                Box::new(self.users.get(user_id).expect("no user found").posts(
                    Some(&domain),
                    self,
                    offset,
                    with_comments,
                ))
            }
        }
    }

    pub fn recent_tags(
        &self,
        domain: String,
        realm_id: Option<&RealmId>,
        n: usize,
    ) -> Vec<(String, u64)> {
        let mut tags: HashMap<String, u64> = Default::default();
        let muted_tags: BTreeSet<String> = vec!["taggr".into()].into_iter().collect();
        for post in self
            .last_posts(domain, realm_id, 0, 0, false)
            // We only count tags occurrences on root posts, if they have comments or reactions
            .filter(|post| {
                post.parent.is_none() && !post.reactions.is_empty() && !post.children.is_empty()
            })
            .take_while(|post| !post.archived)
        {
            for tag in post.tags.difference(&muted_tags) {
                if !tags.contains_key(tag) {
                    tags.insert(tag.clone(), 1);
                }
                let counter = tags.get_mut(tag.as_str()).expect("no tag");
                *counter += 1;
            }
            if tags.len() >= n {
                break;
            }
        }
        tags.into_iter().collect()
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

    /// Returns for the given principal:
    /// - how many of their tokens should be locked for a new proposal (at least 1),
    /// - how many tokens are locked for already open proposal.
    pub fn proposal_escrow_balance_required(&self, caller: Principal) -> (Token, Token) {
        let market_price = self.auction.last_auction_price_e8s;
        let Some(user) = self.principal_to_user(caller) else {
            return (0, 0);
        };

        let already_locked_tokens: Token = self
            .proposals
            .iter()
            .filter(|proposal| proposal.proposer == user.id && proposal.status == Status::Open)
            .map(|proposal| proposal.escrow_tokens)
            .sum();

        let required_tokens = if market_price == 0 {
            0
        } else {
            (self.e8s_for_one_xdr * CONFIG.proposal_escrow_amount_xdr) / market_price
        };

        (required_tokens.max(token::base()), already_locked_tokens)
    }

    pub fn request_principal_change(
        &mut self,
        caller: Principal,
        new_principal: String,
    ) -> Result<(), String> {
        let new_principal =
            Principal::from_text(new_principal).map_err(|_| "can't parse principal")?;
        if new_principal == Principal::anonymous() || self.principals.contains_key(&new_principal) {
            return Err("invalid principal".into());
        }
        self.principal_change_requests
            .retain(|_, principal| principal != &caller);
        if self.principal_change_requests.len() > 200 {
            return Err("too many principal requests pending; try again later".into());
        }
        self.principal_change_requests.insert(new_principal, caller);

        Ok(())
    }

    pub fn change_principal(&mut self, new_principal: Principal) -> Result<(), String> {
        let old_principal = *self
            .principal_change_requests
            .get(&new_principal)
            .ok_or("no request found")?;

        if self.voted_on_emergency_proposal(old_principal) {
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
        let user_id = self
            .principals
            .remove(&old_principal)
            .ok_or("no principal found")?;
        self.principals.insert(new_principal, user_id);
        let user = self.users.get_mut(&user_id).expect("user not found");
        assert_eq!(user.principal, old_principal);
        user.principal = new_principal;
        user.account = AccountIdentifier::new(&new_principal, &DEFAULT_SUBACCOUNT).to_string();
        if balance > 0 {
            token::transfer(
                self,
                time(),
                old_account.owner,
                TransferArgs {
                    from_subaccount: old_account.subaccount.clone(),
                    to: account(new_principal),
                    amount: balance as u128,
                    fee: Some(0), // don't charge on principal change
                    memo: Default::default(),
                    created_at_time: None,
                },
            )
            .expect("transfer failed");
        }

        self.principal_change_requests.remove(&new_principal);

        Ok(())
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
        let mut active_users_vp = 0;
        let mut bots = Vec::new();
        let mut credits = 0;
        let mut speculative_revenue = 0;
        for user in self.users.values() {
            if user.stalwart {
                stalwarts.push(user);
            }
            if user.mode == Mode::Mining {
                speculative_revenue += user.rewards().max(0);
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
            if user.active_within(1, WEEK, now) {
                active_users += 1;
                active_users_vp += user.total_balance();
            }
            credits += user.credits();
        }
        stalwarts.sort_unstable_by_key(|u| u.id);
        let posts = self.root_posts_index.len();
        let last_week_txs = self
            .memory
            .ledger
            .iter()
            .rev()
            .take_while(|(_, tx)| tx.timestamp + WEEK >= now)
            .collect::<Vec<_>>();
        let volume_day = last_week_txs
            .iter()
            .take_while(|(_, tx)| tx.timestamp + DAY >= now)
            .map(|(_, tx)| tx.amount)
            .sum();
        let volume_week = last_week_txs.into_iter().map(|(_, tx)| tx.amount).sum();

        Stats {
            realms: self.realms.len(),
            bitcoin_treasury_address: self.bitcoin_treasury_address.clone(),
            bitcoin_treasury_sats: self.bitcoin_treasury_sats,
            fees_burned: self.token_fees_burned,
            volume_day,
            volume_week,
            e8s_for_one_xdr: self.e8s_for_one_xdr,
            e8s_revenue_per_1k: self.last_revenues.iter().sum::<u64>()
                / self.last_revenues.len().max(1) as u64,
            vesting_tokens_of_x: self.vesting_tokens_of_x,
            meta: format!("Memory health: {}", self.memory.health("MB")),
            module_hash: self.module_hash.clone(),
            last_release: self
                .proposals
                .iter()
                .rev()
                .filter(|proposal| proposal.status == Status::Executed)
                .find_map(|proposal| ReleaseInfo::try_from(proposal).ok())
                .filter(|release_info| release_info.hash == self.module_hash)
                .unwrap_or_default(),
            canister_id: ic_cdk::id(),
            last_weekly_chores: self.timers.last_weekly,
            last_daily_chores: self.timers.last_daily,
            last_hourly_chores: self.timers.last_hourly,
            canister_cycle_balance: canister_balance(),
            users: self.users.len(),
            posts,
            comments: Post::count(self) - posts,
            credits,
            burned_credits: self.burned_cycles + speculative_revenue,
            total_revenue_shared: self.total_revenue_shared,
            total_rewards_shared: self.total_rewards_shared,
            account: invoices::main_account().to_string(),
            users_online,
            stalwarts: stalwarts.into_iter().map(|u| u.id).collect(),
            bots,
            state_size: stable_size() << 16,
            invited_users,
            active_users,
            active_users_vp: active_users_vp / token::base(),
            circulating_supply: self.balances.values().sum(),
            buckets: self
                .storage
                .buckets
                .iter()
                .map(|(id, size)| (id.to_string(), *size))
                .collect(),
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
        let user_id = self
            .principal_to_user(principal)
            .ok_or_else(|| "user not found".to_string())?
            .id;
        if let Some(realm_id) = Post::get(self, &post_id).and_then(|post| post.realm.as_ref()) {
            if self
                .realms
                .get(realm_id.as_str())
                .map(|realm| !realm.whitelist.is_empty() && !realm.whitelist.contains(&user_id))
                .unwrap_or_default()
            {
                return Err(format!("you're not in realm {}", realm_id));
            }
        }
        Post::mutate(self, &post_id, |post| {
            post.vote_on_poll(user_id, time, vote, anonymously)
        })
    }

    pub fn delete_post(
        &mut self,
        principal: Principal,
        post_id: PostId,
        versions: Vec<String>,
    ) -> Result<(), String> {
        if versions.iter().any(|v| v.len() > CONFIG.max_post_length) {
            return Err("wrong arguments".into());
        }

        let post = Post::get(self, &post_id).ok_or("no post found")?.clone();
        if self.principal_to_user(principal).map(|user| user.id) != Some(post.user) {
            return Err("not authorized".into());
        }

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
        if costs
            > self
                .users
                .get(&post.user)
                .ok_or("user not found")?
                .credits()
        {
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
        let user = self.users.get_mut(&post.user).expect("user not found");
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
            Some(Extension::Feature) => {
                self.memory
                    .features
                    .remove(&post_id)
                    .expect("couldn't delete feature");
            }
            _ => {}
        };

        Post::mutate(self, &post_id, |post| {
            post.delete(versions.clone());
            Ok(())
        })
        .expect("couldn't delete post");

        Ok(())
    }

    pub fn react(
        &mut self,
        principal: Principal,
        post_id: PostId,
        reaction: u16,
        time: Time,
    ) -> Result<(), String> {
        let post = Post::get(self, &post_id).ok_or("post not found")?.clone();
        if post.is_deleted() {
            return Err("post deleted".into());
        }

        let delta: i64 = match CONFIG.reactions.iter().find(|(id, _)| id == &reaction) {
            Some((_, delta)) => *delta,
            _ => return Err("unknown reaction".into()),
        };

        let user = self
            .principal_to_user(principal)
            .ok_or("no user for principal found")?;

        if user.credits() <= delta.unsigned_abs() {
            return Err("not enough credits".into());
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

        let user_id = user.id;
        let user_credits = user.credits();
        let user_balance = user.total_balance();
        let user_controversial = user.controversial();

        let log = format!("reaction to post [{0}](#/post/{0})", post_id);
        // Users initiate a credit transfer for upvotes, but burn their own credits on
        // downvotes + credits and rewards of the author
        if delta < 0 {
            if self
                .users
                .get(&post.user)
                .map(|user| user.blacklist.contains(&user_id))
                .unwrap_or_default()
            {
                return Err("you cannot react on posts of users who blocked you".into());
            }

            self.charge_in_realm(
                user_id,
                delta.unsigned_abs().min(user_credits),
                post.realm.as_ref(),
                log.clone(),
            )?;
            self.users
                .get_mut(&post.user)
                .expect("user not found")
                .change_rewards(delta, log.clone());
            let credit_balance = self
                .users
                .get(&post.user)
                .expect("user not found")
                .credits();
            if credit_balance > 0 {
                self.charge_in_realm(
                    post.user,
                    delta.unsigned_abs().min(credit_balance),
                    post.realm.as_ref(),
                    log,
                )
                .expect("couldn't charge user");
            }
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
            }

            // We only count actually burned credits from positive reactions.
            self.principal_to_user_mut(principal)
                .expect("no user for principal found")
                .add_burned_credits(fee);
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

    fn validate_realm_id(&self, realm_id: Option<&RealmId>) -> Result<(), String> {
        if let Some(id) = realm_id {
            if !id.is_empty() && !self.realms.contains_key(id) {
                return Err(format!("realm {} not found", id.clone()));
            };
        }

        Ok(())
    }

    /// Returns the list of all available realms to be displayed on the UI, depending on the
    /// sorting criteria.
    pub fn sorted_realms(
        &self,
        domain: String,
        order: String,
    ) -> Box<dyn Iterator<Item = (&'_ RealmId, &'_ Realm)> + '_> {
        let realm_vp = self
            .users
            .values()
            .fold(BTreeMap::default(), |mut acc, user| {
                let vp = (user.total_balance() as f32).sqrt() as u64;
                user.realms.iter().for_each(|realm_id| {
                    acc.entry(realm_id.clone())
                        .and_modify(|realm_vp| *realm_vp += vp)
                        .or_insert(vp);
                });
                acc
            });
        let mut realms = available_realms(self, domain)
            .filter_map(|realm_id| self.realms.get(realm_id).map(|realm| (realm_id, realm)))
            .collect::<Vec<_>>();
        if order != "name" {
            realms.sort_unstable_by_key(|(realm_id, realm)| match order.as_str() {
                "popularity" => {
                    let realm_vp = realm_vp.get(realm_id.as_str()).copied().unwrap_or(1);
                    let vp = if realm.whitelist.is_empty() {
                        realm_vp
                    } else {
                        1
                    };
                    let moderation = if realm.filter == UserFilter::default() {
                        1
                    } else {
                        realm_vp
                    };
                    Reverse(
                        vp * moderation
                            + (realm.num_members as f32).sqrt() as u64
                            + (realm.posts.len() as f32).sqrt() as u64,
                    )
                }
                _ => Reverse(realm.last_update),
            });
        }

        Box::new(realms.into_iter())
    }
}

// Checks if any feed represents the superset for the given tag set.
// The `strict` option requires the sets to be equal.
fn covered_by_feeds(feeds: &[Vec<String>], tags: &BTreeSet<String>, strict: bool) -> Option<usize> {
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
    use invite::tests::create_invite_with_realm;
    use post::Post;
    use realms::tests::create_realm;

    pub fn pr(n: usize) -> Principal {
        Principal::from_slice(&n.to_be_bytes())
    }

    pub fn create_user(state: &mut State, p: Principal) -> UserId {
        create_user_with_params(state, p, &p.to_string().replace('-', ""), 1000)
    }

    pub fn create_user_with_credits(state: &mut State, p: Principal, credits: Credits) -> UserId {
        create_user_with_params(state, p, &p.to_string().replace('-', ""), credits)
    }

    pub fn insert_balance(state: &mut State, principal: Principal, amount: Token) {
        state.minting_mode = true;
        token::mint(state, account(principal), amount, "");
        state.minting_mode = false;
        if let Some(user) = state.principal_to_user_mut(principal) {
            user.change_rewards((amount / token::base()) as i64, "");
            user.balance = amount;
        }
    }

    pub fn create_user_with_params(
        state: &mut State,
        p: Principal,
        name: &str,
        credits: Credits,
    ) -> UserId {
        state.memory.init_test_api();
        state
            .new_user(p, 0, name.to_string(), Some(credits))
            .unwrap()
    }

    #[test]
    fn test_revenue_from_icp() {
        mutate(|state| {
            state.e8s_for_one_xdr = 13510000;
            assert_eq!(state.burned_cycles, 0);
            // distribute 69 ICP
            state.distribute_revenue_from_icp(6907960000);
            // collect roughly 511k credits (6907960000/13510000)
            assert_eq!(state.burned_cycles, 511321);
        })
    }

    #[test]
    fn test_active_voting_power() {
        mutate(|state| {
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
            assert_eq!(state.principals.len(), 3);
            assert_eq!(state.cold_wallets.get(&pr(200)), Some(&1));
            assert!(state.principal_to_user(pr(200)).is_none());
            let user = state.users.get(&1).unwrap();
            assert_eq!(user.total_balance(), 80000 + cold_balance);
            assert_eq!(
                state.link_cold_wallet(pr(200), 0),
                Err("this wallet is linked already".into())
            );
            let voters = state.active_voters(0).collect::<BTreeMap<_, _>>();
            assert_eq!(*voters.get(&1).unwrap(), (2 << 2) * 10000 + cold_balance);

            state.emergency_votes.insert(pr(1), 1000);
            assert_eq!(
                state.unlink_cold_wallet(pr(1)),
                Err("a vote on a pending proposal detected".into())
            );

            state.emergency_votes.clear();
            assert!(state.unlink_cold_wallet(pr(1)).is_ok(),);
            let user = state.principal_to_user(pr(1)).unwrap();
            assert_eq!(user.id, 1);
            assert!(user.cold_wallet.is_none());
            assert_eq!(state.principals.len(), 3);
            assert!(state.cold_wallets.is_empty());

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

    #[actix_rt::test]
    async fn test_tag_indexes() {
        mutate(|state| {
            create_user_with_params(state, pr(1), "alice", 1000);
            Post::create(
                state,
                "This is a #test message with #tags".to_string(),
                &[],
                pr(1),
                0,
                None,
                None,
                None,
            )
            .unwrap();
            Post::create(
                state,
                "This is a test #message with #more #tags".to_string(),
                &[],
                pr(1),
                0,
                None,
                None,
                None,
            )
            .unwrap();

            assert_eq!(state.tag_indexes.len(), 4);
            assert!(state.tag_indexes.get("test").unwrap().posts.contains(&0));
            assert!(state.tag_indexes.get("more").unwrap().posts.contains(&1));
            assert_eq!(
                state.tag_indexes.get("tags").unwrap().posts.clone(),
                vec![1, 0].into_iter().collect::<BTreeSet<_>>()
            );
            // No posts for this tag
            assert!(!state.tag_indexes.contains_key("coffee"));
        });

        Post::edit(
            1,
            "Now this post is about #coffee".into(),
            vec![],
            "".to_string(),
            None,
            pr(1),
            time(),
        )
        .await
        .unwrap();

        read(|state| {
            assert_eq!(
                state.tag_indexes.get("coffee").unwrap().posts.clone(),
                vec![1].into_iter().collect()
            );
        });
    }

    #[test]
    fn test_credit_transfer() {
        mutate(|state| {
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
        let id = mutate(|state| create_user_with_params(state, pr(0), "peter", 10000));

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
            Mode::Mining,
            false,
            Default::default(),
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
            Mode::Mining,
            false,
            Default::default(),
        )
        .is_ok());

        read(|state| {
            let user = state.users.get(&id).unwrap();
            assert_eq!(user.name, "john".to_string());
            assert_eq!(user.previous_names.as_slice(), &["peter"]);
        });

        // The old name is reserved now
        assert_eq!(
            user::create_user(pr(2), "peter".into(), None).await,
            Err("taken".to_string())
        );
    }

    #[test]
    fn test_new_rewards_collection() {
        mutate(|state| {
            for (i, rewards) in vec![125, -11, 0, 672].into_iter().enumerate() {
                let id = create_user(state, pr(i));
                let user = state.users.get_mut(&id).unwrap();
                user.change_rewards(rewards, "");
                if i == 4 {
                    user.mode = Mode::Mining
                } else {
                    user.mode = Mode::Rewards
                };
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
        mutate(|state| {
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
                let principal = pr(i);
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
        mutate(|state| {
            let insert_rewards = |state: &mut State, id: UserId| {
                state.users.get_mut(&id).unwrap().rewards = (id * 1000) as i64;
            };

            for i in 0..5 {
                create_user(state, pr(i));
                state.principal_to_user_mut(pr(i)).unwrap().mode = Mode::Mining;
                insert_rewards(state, i as UserId);
            }

            // credits earned
            assert_eq!(state.user("0").unwrap().rewards(), 0);
            assert_eq!(state.user("1").unwrap().rewards(), 1000);
            assert_eq!(state.user("2").unwrap().rewards(), 2000);
            assert_eq!(state.user("3").unwrap().rewards(), 3000);
            assert_eq!(state.user("4").unwrap().rewards(), 4000);

            // user 3 switches to non-miner
            state.principal_to_user_mut(pr(3)).unwrap().mode = Mode::Rewards;

            let market_price = 300313; // e8s per token (cent)
            state.e8s_for_one_xdr = 14410000;

            for i in 0..4 {
                assert!(!state.balances.contains_key(&account(pr(i))));
            }

            state.minting_mode = true;
            state.mint(market_price);

            // User 0 (no rewards) and User 3 (miner) were excluded
            assert_eq!(state.balances.len(), 3);

            assert!(!state.balances.contains_key(&account(pr(0))));
            assert!(!state.balances.contains_key(&account(pr(3))));

            // uesr 1 earned 0.47 TAGGR
            assert_eq!(*state.balances.get(&account(pr(1))).unwrap(), 47);
            // uesr 2 earned 0.95 TAGGR
            assert_eq!(*state.balances.get(&account(pr(2))).unwrap(), 95);
            // uesr 4 earned 1.91 TAGGR
            assert_eq!(*state.balances.get(&account(pr(4))).unwrap(), 191);
        })
    }

    #[test]
    fn test_poll_conclusion() {
        mutate(|state| {
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

            let post_id = Post::create(
                state,
                "Test".to_string(),
                &[],
                pr(1),
                0,
                None,
                None,
                Some(Extension::Poll(post::Poll {
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
        mutate(|state| {
            state.init();

            // Setup: Create test users
            let alice_principal = pr(10);
            let bob_principal = pr(11);
            let alice_id = create_user(state, alice_principal);
            create_user(state, bob_principal);

            // Add tokens to Alice
            insert_balance(state, alice_principal, 1234);
            state
                .principal_to_user_mut(alice_principal)
                .unwrap()
                .change_rewards(100, "test");

            // Store Alice's account info
            let alice_old_account = account(alice_principal);
            let alice_account_string = state
                .principal_to_user(alice_principal)
                .unwrap()
                .account
                .clone();

            // Test principals
            let valid_principal_str =
                "yh4uw-lqajx-4dxcu-rwe6s-kgfyk-6dicz-yisbt-pjg7v-to2u5-morox-hae";
            let valid_principal = Principal::from_text(valid_principal_str).unwrap();

            // Test 1: Request validation
            // Invalid principal string
            assert_eq!(
                state.request_principal_change(alice_principal, "invalid-principal".to_string()),
                Err("can't parse principal".into())
            );

            // Anonymous principal
            assert_eq!(
                state.request_principal_change(alice_principal, Principal::anonymous().to_text()),
                Err("invalid principal".into())
            );

            // Already assigned principal
            assert_eq!(
                state.request_principal_change(alice_principal, bob_principal.to_text()),
                Err("invalid principal".into())
            );

            // Test 2: Request limits
            // Fill up requests to the limit
            for i in 0..256 {
                state.principal_change_requests.insert(pr(i), pr(i));
            }

            // Try exceeding the limit
            assert_eq!(
                state.request_principal_change(alice_principal, valid_principal_str.to_string()),
                Err("too many principal requests pending; try again later".into())
            );

            // Clear requests for further testing
            state.principal_change_requests.clear();

            // Test 3: Valid request
            assert!(state
                .request_principal_change(alice_principal, valid_principal_str.to_string())
                .is_ok());
            assert!(state
                .principal_change_requests
                .contains_key(&valid_principal));
            assert_eq!(
                state.principal_change_requests.get(&valid_principal),
                Some(&alice_principal)
            );

            // Test 4: Change principal errors
            // Without a request
            state.principal_change_requests.clear();
            assert_eq!(
                state.change_principal(valid_principal),
                Err("no request found".into())
            );

            // Re-add the request
            assert!(state
                .request_principal_change(alice_principal, valid_principal_str.to_string())
                .is_ok());

            // With emergency vote
            state.emergency_votes.insert(alice_principal, 1);
            assert_eq!(
                state.change_principal(valid_principal),
                Err("pending proposal with the current principal as voter exists".into())
            );
            state.emergency_votes.clear();

            // Test 5: Successful change
            assert_eq!(state.change_principal(valid_principal), Ok(()));

            // Verify change results
            // Old principal no longer valid
            assert!(state.principal_to_user(alice_principal).is_none());

            // User has new principal
            let alice_after = state.principal_to_user(valid_principal).unwrap();
            assert_eq!(alice_after.id, alice_id);
            assert_eq!(alice_after.principal, valid_principal);

            // Account updated
            let new_account_string = alice_after.account.clone();
            assert_ne!(alice_account_string, new_account_string);
            assert_eq!(
                new_account_string,
                AccountIdentifier::new(&valid_principal, &DEFAULT_SUBACCOUNT).to_string()
            );

            // Balance transferred
            assert!(!state.balances.contains_key(&alice_old_account));
            assert_eq!(
                *state.balances.get(&account(valid_principal)).unwrap(),
                1234
            );

            // Request removed
            assert!(!state
                .principal_change_requests
                .contains_key(&valid_principal));

            // Test 6: Anonymous principal change
            state
                .principal_change_requests
                .insert(Principal::anonymous(), bob_principal);
            assert_eq!(
                state.change_principal(Principal::anonymous()),
                Err("wrong principal".into())
            );
        });
    }

    #[test]
    fn test_post_deletion() {
        mutate(|state| {
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

            let post_author = state.principal_to_user(pr(0)).unwrap();
            assert_eq!(post_author.credits_burned(), 2);

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
                10 + 5 + 2 * CONFIG.response_reward
            );

            let upvoter = state.users.get_mut(&upvoter_id).unwrap();
            assert_eq!(
                upvoter.credits(),
                // reward + fee + post creation
                upvoter_credits - 10 - 1 - 2
            );
            assert_eq!(upvoter.credits_burned(), 3);

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
                Err("not enough credits (this post requires 47 credits to be deleted)".into())
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
                upvoter_credits - 10 - 1 - 2 + 10
            );
            assert_eq!(state.users.get(&id).unwrap().rewards(), 0);

            assert_eq!(
                state.react(pr(1), post_id, 1, 0),
                Err("post deleted".into())
            );
        });
    }

    #[test]
    fn test_covered_by_feed() {
        let m = |v: Vec<&str>| v.into_iter().map(|v| v.to_string()).collect();
        let m2 = |v: Vec<&str>| v.into_iter().map(|v| v.to_string()).collect();
        let tests = vec![
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m2(vec!["tag1"]),
                true,
                None,
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m2(vec!["tag1", "tag2"]),
                false,
                Some(0),
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m2(vec!["tag1", "tag2"]),
                true,
                Some(0),
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m2(vec!["tag1", "tag2", "tag3"]),
                true,
                None,
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m2(vec!["tag1", "tag2", "tag3"]),
                false,
                Some(0),
            ),
            (
                vec![m(vec!["tag1", "tag2"]), m(vec!["tag2", "tag3"])],
                m2(vec!["tagX", "tag2", "tag3"]),
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
        mutate(|state| {
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
            assert!(state.user(&cold_wallet.to_text()).is_none());
        });
    }

    #[test]
    fn test_inverse_filter() {
        mutate(|state| {
            state.init();

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
                    .last_posts("localhost".into(), None, 0, 0, true)
                    .filter(|post| {
                        inverse_filters
                            .map(|filters| !post.matches_filters(None, filters))
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
        mutate(|state| {
            state.init();

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
                .personal_feed("localhost".into(), state, 0)
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
                .personal_feed("localhost".into(), state, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 1);
            assert!(feed.contains(&post_id));

            // now we follow a feed #post+#tags
            let user = state.users.get_mut(&user_id).unwrap();
            assert!(user
                .toggle_following_feed(vec!["post".to_owned(), "tags".to_owned()].as_slice())
                .unwrap());

            // make sure the feed still contains the same post
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed("localhost".into(), state, 0)
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
                .personal_feed("localhost".into(), state, 0)
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
                .personal_feed("localhost".into(), state, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 2);
            assert!(feed.contains(&post_id));
            assert!(feed.contains(&post_id2));

            // now we follow a feed "post"
            let user = state.users.get_mut(&user_id).unwrap();
            let tags: Vec<_> = vec!["post".to_string()].into_iter().collect();
            assert!(user.toggle_following_feed(&tags).unwrap());
            // make sure the feed contains the new post
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed("localhost".into(), state, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 3);
            assert!(feed.contains(&post_id));
            assert!(feed.contains(&post_id2));
            assert!(feed.contains(&post_id3));

            // Make sure we can unsubscribe and the feed gets back to 2 posts
            let user = state.users.get_mut(&user_id).unwrap();
            assert!(!user.toggle_following_feed(&tags).unwrap());
            let feed = state
                .users
                .get(&user_id)
                .unwrap()
                .personal_feed("localhost".into(), state, 0)
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
                .personal_feed("localhost".into(), state, 0)
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
                .personal_feed("localhost".into(), state, 0)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert!(!feed.contains(&post_id));
        });
    }

    #[test]
    fn test_clean_up() {
        mutate(|state| {
            state.init();

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

            // Make sure user is removed from the DAO realm upon being inactive for a year
            let user = state.users.get_mut(&inactive_id1).unwrap();
            user.controlled_realms.insert("DAO".into());
            let realm = state.realms.get_mut("DAO").unwrap();
            realm.controllers.insert(inactive_id1);
            realm.controllers.insert(inactive_id2);
            realm.last_update = 40 * WEEK;
            // Make inactive_id2 be active in week 40
            let user = state.users.get_mut(&inactive_id2).unwrap();
            user.last_activity = WEEK * 40;

            let now = WEEK + DAY * CONFIG.realm_inactivity_timeout_days;
            state.clean_up(now);
            let realm = state.realms.get("DAO").unwrap();
            // Make sure only inactive_id2 is still controller
            assert_eq!(
                realm.controllers.iter().cloned().collect::<Vec<_>>(),
                vec![inactive_id2]
            );
            // Make sure the realm does not appear for inactive_id1
            assert!(state
                .users
                .get(&inactive_id1)
                .unwrap()
                .controlled_realms
                .is_empty())
        })
    }

    #[test]
    fn test_credits_accounting() {
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
            let reaction_costs_1 = 6;
            let burned_credits_by_reactions = 1 + 1;
            let mut rewards_from_reactions = 5 + 10;

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
            assert_eq!(state.users.get(&user_id111).unwrap().rewards(), 5);

            // another reaction on a new post
            let id =
                Post::create(state, "t".to_string(), &[], pr(55), 0, Some(0), None, None).unwrap();
            assert!(state.react(lurker_principal, id, 50, 0).is_ok());

            assert_eq!(state.users.get(&user_id111).unwrap().rewards(), 10);

            // another reaction on a new post
            let id =
                Post::create(state, "t".to_string(), &[], pr(55), 0, Some(0), None, None).unwrap();
            assert!(state.react(lurker_principal, id, 50, 0).is_ok());

            assert_eq!(state.users.get(&user_id111).unwrap().rewards(), 15);
        })
    }

    #[test]
    fn test_credits_accounting_reposts() {
        mutate(|state| {
            create_user_with_credits(state, pr(0), 2000);
            create_user_with_credits(state, pr(1), 2000);
            create_user(state, pr(2));
            let c = CONFIG;

            for (reaction, total_fee) in &[(10, 1), (50, 1), (101, 1)] {
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
        mutate(|state| {
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
            assert!(user.toggle_following_feed(&tags).unwrap());
            assert!(user.toggle_following_feed(&tags2).unwrap());
            assert!(!user.toggle_following_feed(&tags).unwrap());
            assert!(!user.toggle_following_feed(&tags2).unwrap());
        })
    }

    #[test]
    fn test_toggle_following_feed_validation_failure() {
        mutate(|state| {
            state.init();
            let p = pr(0);
            let id = create_user(state, p);
            let user = state.users.get_mut(&id).unwrap();

            let tag1 = "a".repeat(500);
            user.toggle_following_feed(std::slice::from_ref(&tag1))
                .unwrap();

            let tag2 = "b".repeat(500);
            let result = user.toggle_following_feed(std::slice::from_ref(&tag2));
            assert!(result.is_err());
            assert_eq!(result.unwrap_err(), "feed size limit exceeded");
        })
    }

    #[test]
    fn test_stalwarts() {
        mutate(|state| {
            state.init();

            assert!(state.realms.contains_key(CONFIG.dao_realm));
            assert!(state
                .realms
                .get(CONFIG.dao_realm)
                .unwrap()
                .controllers
                .is_empty());

            let now = CONFIG.min_stalwart_account_age_weeks * WEEK;
            let num_users = 255;

            for i in 0..num_users {
                let id = create_user(state, pr(i));
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

            for i in 0..num_users {
                insert_balance(state, pr(i), i as u64 * 100);
            }

            state.recompute_stalwarts(now + WEEK * 3);
            assert_eq!(
                state
                    .users
                    .values()
                    .filter_map(|u| u.stalwart.then_some(u.id))
                    .collect::<Vec<UserId>>(),
                vec![248, 250, 252, 254]
            );
        })
    }

    #[test]
    fn test_minting_delay() {
        mutate(|state| {
            state.init();

            let num_users = 2000;

            for i in 0..num_users {
                let id = create_user(state, pr(i));
                let user = state.users.get_mut(&id).unwrap();
                if i < 60 {
                    user.stalwart = true
                }
            }

            // non-stalwart can't delay
            assert!(!state.delay_weekly_chores(pr(61)));

            // 9 stalwarts trigger the shifting (in tests, the threshold is 15%)
            for i in 0..9 {
                assert_eq!(state.timers.last_weekly, 0);
                assert!(state.delay_weekly_chores(pr(i)));
            }

            // shifting happened
            assert_eq!(state.timers.last_weekly, WEEK);

            // more votes are rejected
            assert!(!state.delay_weekly_chores(pr(10)));
            assert!(!state.delay_weekly_chores(pr(11)));
        })
    }

    #[actix_rt::test]
    async fn test_invites() {
        let principal = pr(1);
        let (id, code, prev_balance) = mutate(|state| {
            let id = create_user(state, principal);

            // use too many credits
            assert_eq!(
                state.create_invite(principal, 1111, None, None),
                Err("not enough credits available: 1000 (needed for invites: 1111)".into())
            );

            // use enough credits and make sure they were deducted
            let prev_balance = state.users.get(&id).unwrap().credits();
            assert_eq!(state.create_invite(principal, 111, None, None), Ok(()));
            let new_balance = state.users.get(&id).unwrap().credits();
            // no charging yet
            assert_eq!(new_balance, prev_balance);
            let invites = invite::invites_by_principal(state, principal);
            // assert_eq!(invites.count(), 1);
            let (code, Invite { credits, .. }) = invites.last().unwrap();
            assert_eq!(*credits, 111);
            (id, code.to_string(), prev_balance)
        });

        // use the invite
        assert!(user::create_user(pr(2), "name".to_string(), Some(code))
            .await
            .is_ok());

        let new_balance = mutate(|state| state.users.get(&id).unwrap().credits());
        assert_eq!(new_balance, prev_balance - 111);

        let (id, code, prev_balance) = mutate(|state| {
            let user = state.users.get_mut(&id).unwrap();
            let prev_balance = user.credits();
            assert_eq!(state.create_invite(principal, 222, None, None), Ok(()));
            let invites = invite::invites_by_principal(state, principal);
            let (code, Invite { credits, .. }) = invites.last().unwrap();
            assert_eq!(*credits, 222);
            (id, code.to_string(), prev_balance)
        });

        let prev_revenue = read(|state| state.burned_cycles);

        assert!(user::create_user(pr(3), "name2".to_string(), Some(code))
            .await
            .is_ok());

        read(|state| {
            let user = state.users.get(&id).unwrap();
            assert_eq!(user.credits(), prev_balance - 222);
            assert_eq!(read(|state| state.burned_cycles), prev_revenue);
        });
    }

    #[actix_rt::test]
    async fn test_invites_with_realm() {
        let principal = pr(4);
        let (_, invite_code, realm_id) = mutate(|state| create_invite_with_realm(state, principal));

        // New user should be joined to realm
        let new_principal = pr(5);
        assert_eq!(
            user::create_user(new_principal, "name".to_string(), Some(invite_code)).await,
            Ok(Some(realm_id.clone()))
        );
        read(|state| {
            let user = state.principal_to_user(new_principal).unwrap();
            assert_eq!(user.credits(), 50); // Invite gives 50 credits
            assert_eq!(user.realms.first().cloned(), Some(realm_id));

            let (_, invite) = invite::invites_by_principal(state, principal)
                .last()
                .unwrap();
            assert_eq!(invite.credits, 150);
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
                assert_eq!(user.mode, Mode::Mining);
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
            state.principal_to_user_mut(pr(7)).unwrap().mode = Mode::Rewards;

            // Assume the revenue was 1M credits
            state.burned_cycles = 1_000_000;

            // For simplicity assume 100 e8s for 1 xdr
            state.e8s_for_one_xdr = 100;

            // mint to burn miners rewards
            state.mint(1);

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
