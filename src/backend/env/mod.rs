use self::canisters::{upgrade_main_canister, NNSVote};
use self::invoices::{parse_account, user_icp_account, Invoice, USER_ICP_SUBACCOUNT};
use self::post::{archive_cold_posts, Extension, Poll, Post, PostId};
use self::proposals::{Payload, Status};
use self::reports::Report;
use self::token::account;
use self::user::{Filters, Notification, Predicate};
use crate::env::invoices::principal_to_subaccount;
use crate::env::user::CyclesDelta;
use crate::proposals::Proposal;
use crate::token::{Account, Token, Transaction};
use crate::{assets, mutate, read};
use candid::Principal;
use config::{reaction_karma, CONFIG, ICP_CYCLES_PER_XDR};
use ic_cdk::api::stable::stable64_size;
use ic_cdk::api::{self, canister_balance};
use ic_ledger_types::{AccountIdentifier, Memo, Tokens};
use invoices::e8s_to_icp;
use invoices::Invoices;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use user::{User, UserId};

pub mod canisters;
pub mod config;
pub mod invoices;
pub mod memory;
pub mod post;
pub mod proposals;
pub mod reports;
pub mod storage;
pub mod token;
pub mod user;

pub type Cycles = u64;
pub type Karma = i64;
pub type Blob = ByteBuf;

pub const MINUTE: u64 = 60000000000_u64;
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

#[derive(Default, Deserialize, Serialize)]
pub struct SearchResult {
    pub id: PostId,
    pub user_id: UserId,
    pub generic_id: String,
    pub result: String,
    pub relevant: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Event {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
pub struct Stats {
    holders: usize,
    e8s_revenue_per_1k: u64,
    e8s_for_one_xdr: u64,
    team_tokens: HashMap<UserId, Token>,
    weekly_karma_leaders: Vec<(UserId, u64)>,
    users: usize,
    bootcamp_users: usize,
    cycles: Cycles,
    canister_cycle_balance: u64,
    burned_cycles: i64,
    burned_cycles_total: Cycles,
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
}

#[derive(Default, Serialize, Deserialize)]
pub struct Realm {
    logo: String,
    pub description: String,
    pub controllers: BTreeSet<UserId>,
    pub label_color: String,
    theme: String,
    pub num_posts: u64,
    pub num_members: u64,
}

#[derive(Default, Serialize, Deserialize)]
pub struct State {
    pub burned_cycles: i64,
    pub burned_cycles_total: Cycles,
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
    pub hot: VecDeque<PostId>,
    pub invites: BTreeMap<String, (UserId, Cycles)>,
    pub realms: BTreeMap<String, Realm>,

    #[serde(skip)]
    pub balances: HashMap<Account, Token>,

    total_revenue_shared: u64,
    total_rewards_shared: u64,

    pub proposals: Vec<Proposal>,
    pub ledger: Vec<Transaction>,

    pub team_tokens: HashMap<UserId, Token>,

    pub memory: memory::Memory,

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

    pub root_posts: usize,

    e8s_for_one_xdr: u64,

    #[serde(default)]
    last_revenues: VecDeque<u64>,
}

#[derive(Default, Deserialize, Serialize)]
pub struct Logger {
    pub events: Vec<Event>,
}

impl Logger {
    pub fn error<T: ToString>(&mut self, message: T) {
        self.log(message, "ERROR".to_string());
    }

    pub fn info<T: ToString>(&mut self, message: T) {
        self.log(message, "INFO".to_string());
    }

    pub fn log<T: ToString>(&mut self, message: T, level: String) {
        self.events.push(Event {
            timestamp: time(),
            message: message.to_string(),
            level,
        });
        while self.events.len() > 200 {
            self.events.remove(0);
        }
    }
}

pub enum Destination {
    Karma,
    Cycles,
}

impl State {
    pub fn voted_on_pending_proposal(&self, principal: Principal) -> bool {
        if let Some(user) = self.principal_to_user(principal) {
            self.proposals.iter().any(|proposal| {
                proposal.status == Status::Open
                    && proposal
                        .bulletins
                        .iter()
                        .any(|(user_id, _, _)| &user.id == user_id)
            })
        } else {
            false
        }
    }

    pub async fn finalize_upgrade() {
        let current_hash = canisters::settings(id())
            .await
            .ok()
            .and_then(|s| s.module_hash.map(hex::encode))
            .unwrap_or_default();
        mutate(|state| {
            state.module_hash = current_hash.clone();
            state.logger.info(format!(
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

    pub fn clean_up_realm(&mut self, principal: Principal, post_id: PostId) -> Result<(), String> {
        let controller = self.principal_to_user(principal).ok_or("no user found")?.id;
        let post = Post::get(self, &post_id).ok_or("no post found")?;
        if post.parent.is_some() {
            return Err("only root posts can be moved out of realms".into());
        }
        let realm = post.realm.as_ref().cloned().ok_or("no realm id found")?;
        let post_user = post.user;
        if !post
            .realm
            .as_ref()
            .and_then(|realm_id| self.realms.get(realm_id))
            .map(|realm| realm.controllers.contains(&controller))
            .unwrap_or_default()
        {
            return Err("only realm controller can clean up".into());
        }
        let user = self.users.get_mut(&post_user).ok_or("no user found")?;
        let msg = format!("post {} was moved out of realm {}", post_id, realm);
        user.change_karma(-(CONFIG.realm_cleanup_penalty as Karma), &msg);
        let user_id = user.id;
        let penalty = CONFIG.realm_cleanup_penalty.min(user.cycles());
        self.charge(user_id, penalty, msg)
            .expect("couldn't charge user");
        post::change_realm(self, post_id, None);
        self.realms
            .get_mut(&realm)
            .expect("no realm found")
            .num_posts -= 1;
        Ok(())
    }

    pub fn active_voting_power(&self, time: u64) -> Token {
        self.balances
            .iter()
            .filter_map(|(acc, balance)| {
                self.principal_to_user(acc.owner).and_then(|user| {
                    user.active_within_weeks(time, CONFIG.voting_power_activity_weeks)
                        .then_some(*balance)
                })
            })
            .sum()
    }

    fn spend_to_user_karma<T: ToString>(&mut self, id: UserId, amount: Cycles, log: T) {
        let user = self.users.get_mut(&id).expect("no user found");
        user.change_karma(amount as Karma, log.to_string());
        if amount > CONFIG.voting_reward {
            self.logger.info(format!(
                "Spent `{}` cycles on @{}'s karma for {}.",
                amount,
                user.name,
                log.to_string()
            ));
        }
        self.burned_cycles -= amount as i64;
    }

    fn spend<T: ToString>(&mut self, amount: Cycles, log: T) {
        if amount > 5 {
            self.logger
                .info(format!("Spent `{}` cycles on {}.", amount, log.to_string()));
        }
        self.burned_cycles -= amount as i64;
    }

    pub fn charge<T: ToString>(
        &mut self,
        id: UserId,
        amount: Cycles,
        log: T,
    ) -> Result<(), String> {
        if amount < 1 {
            return Err("non-positive amount".into());
        }
        let user = self.users.get_mut(&id).ok_or("no user found")?;
        user.change_cycles(amount, CyclesDelta::Minus, log)?;
        self.burned_cycles += amount as i64;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn cycle_transfer<T: ToString>(
        &mut self,
        sender_id: UserId,
        receiver_id: UserId,
        amount: Cycles,
        fee: Cycles,
        destination: Destination,
        log: T,
        notification: Option<String>,
    ) -> Result<(), String> {
        let sender = self.users.get_mut(&sender_id).expect("no sender found");
        sender.change_cycles(amount + fee, CyclesDelta::Minus, log.to_string())?;
        let receiver = self.users.get_mut(&receiver_id).expect("no receiver found");
        self.burned_cycles += fee as i64;
        let result = match destination {
            Destination::Karma => {
                let amount = receiver.compute_karma_donation(sender_id, amount);
                receiver.change_karma(amount as Karma, log);
                Ok(())
            }
            Destination::Cycles => receiver.change_cycles(amount, CyclesDelta::Plus, log),
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
            Ok(value) => self.balances = value,
            Err(err) => self.logger.log(
                format!("the token ledger is inconsistent: {}", err),
                "CRITICAL".into(),
            ),
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

    pub fn realms_posts(&self, caller: Principal, page: usize) -> Vec<Post> {
        let realm_ids = match self
            .principal_to_user(caller)
            .map(|user| user.realms.as_slice())
        {
            None | Some(&[]) => return Default::default(),
            Some(ids) => ids.iter().collect::<BTreeSet<_>>(),
        };
        self.last_posts(caller, None, false)
            .filter(|post| {
                post.realm
                    .as_ref()
                    .map(|id| realm_ids.contains(&id))
                    .unwrap_or_default()
            })
            .skip(page * CONFIG.feed_page_size)
            .take(CONFIG.feed_page_size)
            .cloned()
            .collect()
    }

    pub fn hot_posts(&self, realm: Option<String>, page: usize) -> Vec<Post> {
        self.hot
            .iter()
            .filter_map(|post_id| Post::get(self, post_id))
            .filter(|post| realm.is_none() || post.realm == realm)
            .skip(page * CONFIG.feed_page_size)
            .take(CONFIG.feed_page_size)
            .cloned()
            .collect()
    }

    pub fn toggle_realm_membership(&mut self, principal: Principal, name: String) -> bool {
        if !self.realms.contains_key(&name) {
            return false;
        }
        let user = match self.principal_to_user_mut(principal) {
            Some(user) => user,
            _ => return false,
        };
        if user.realms.contains(&name) {
            user.realms.retain(|realm| realm != &name);
            self.realms
                .get_mut(&name)
                .expect("no realm found")
                .num_members -= 1;
            return false;
        }
        user.realms.push(name.clone());
        self.realms
            .get_mut(&name)
            .expect("no realm found")
            .num_members += 1;
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn edit_realm(
        &mut self,
        principal: Principal,
        name: String,
        logo: String,
        label_color: String,
        theme: String,
        description: String,
        controllers: BTreeSet<UserId>,
    ) -> Result<(), String> {
        let user_id = self
            .principal_to_user_mut(principal)
            .ok_or("no user found")?
            .id;
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
        realm.description = description;
        realm.controllers = controllers;
        realm.label_color = label_color;
        realm.theme = theme;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_realm(
        &mut self,
        principal: Principal,
        name: String,
        logo: String,
        label_color: String,
        theme: String,
        description: String,
        controllers: BTreeSet<UserId>,
    ) -> Result<(), String> {
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

        let user = self
            .principal_to_user(principal)
            .ok_or("no user found")?
            .clone();

        self.charge(user.id, CONFIG.realm_cost, "realm creation".to_string())
            .map_err(|err| {
                format!(
                    "couldn't charge {} cycles for realm creation: {}",
                    CONFIG.realm_cost, err
                )
            })?;

        self.realms.insert(
            name.clone(),
            Realm {
                logo,
                description,
                controllers,
                label_color,
                theme,
                ..Default::default()
            },
        );

        self.logger.info(format!(
            "@{} created realm [{1}](/#/realm/{1}) 🎭",
            user.name, name
        ));

        Ok(())
    }

    pub async fn tip(principal: Principal, post_id: PostId, amount: String) -> Result<(), String> {
        let result: Result<_, String> = read(|state| {
            let tipper = state.principal_to_user(principal).ok_or("no user found")?;
            let tipper_id = tipper.id;
            let tipper_name = tipper.name.clone();
            let author_id = Post::get(state, &post_id).ok_or("post not found")?.user;
            let recipient = state
                .users
                .get(&author_id)
                .ok_or("no user found")?
                .account
                .clone();
            Ok((recipient, tipper_name, author_id, tipper_id))
        });
        let (recipient, tipper_name, author_id, tipper_id) = result?;
        let tip = State::icp_transfer(principal, recipient, &amount).await?;
        mutate(|state| {
            Post::mutate(state, &post_id, |post| {
                post.watchers.insert(tipper_id);
                post.tips.push((tipper_id, tip.e8s()));
                Ok(())
            })?;
            state
                .users
                .get_mut(&author_id)
                .expect("user not found")
                .notify_about_post(
                    format!(
                        "@{} tipped you with `{}` ICP for your post",
                        tipper_name, amount,
                    ),
                    post_id,
                );
            Ok(())
        })
    }

    fn new_user(&mut self, principal: Principal, timestamp: u64, name: String) -> UserId {
        let id = self.new_user_id();
        let mut user = User::new(principal, id, timestamp, name);
        user.notify(format!("**Welcome!** 🎉 Use #{} as your personal blog, micro-blog or a photo blog. Use #hashtags to connect with others. Make sure you understand [how {0} works](/#/whitepaper). And finally, [say hello](#/new) and start earning karma!", CONFIG.name));
        self.principals.insert(principal, user.id);
        self.logger
            .info(format!("@{} joined {} 🚀", &user.name, CONFIG.name));
        self.users.insert(user.id, user);
        id
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
            if let Some((inviter_id, cycles)) = invite.and_then(|code| state.invites.remove(&code))
            {
                let inviter = state.users.get_mut(&inviter_id).ok_or("no user found")?;
                let new_user_id = if inviter.invites_budget > cycles {
                    inviter.invites_budget = inviter.invites_budget.saturating_sub(cycles);
                    state.spend(cycles, "user invite");
                    state.new_user(principal, time(), name.clone())
                } else if inviter.cycles() > cycles {
                    let new_user_id = state.new_user(principal, time(), name.clone());
                    state
                        .cycle_transfer(
                            inviter_id,
                            new_user_id,
                            cycles,
                            0,
                            Destination::Cycles,
                            "claimed by invited user",
                            None,
                        )
                        .unwrap_or_else(|err| panic!("couldn't use the invite: {}", err));
                    new_user_id
                } else {
                    return Err("inviter has not enough cycles".into());
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

        if let Ok(Invoice { paid: true, .. }) = State::mint_cycles(principal, 0).await {
            mutate(|state| state.new_user(principal, time(), name));
            // After the user has beed created, transfer cycles.
            return State::mint_cycles(principal, 0).await.map(|_| ());
        }

        Err("payment missing or the invite is invalid".to_string())
    }

    pub fn invites(&self, principal: Principal) -> Vec<(String, Cycles)> {
        self.principal_to_user(principal)
            .map(|user| {
                self.invites
                    .iter()
                    .filter(|(_, (user_id, _))| user_id == &user.id)
                    .map(|(code, (_, cycles))| (code.clone(), *cycles))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }

    pub fn create_invite(&mut self, principal: Principal, cycles: Cycles) -> Result<(), String> {
        let min_cycles = CONFIG.min_cycles_for_inviting;
        let user = self
            .principal_to_user_mut(principal)
            .ok_or("no user found")?;
        if cycles < min_cycles {
            return Err(format!(
                "smallest invite must contain {} cycles",
                min_cycles
            ));
        }
        if user.cycles() < cycles {
            return Err("not enough cycles".into());
        }
        if !user.trusted() {
            return Err("bootcamp users cannot invite others".into());
        }
        let mut hasher = Sha256::new();
        hasher.update(principal.as_slice());
        hasher.update(time().to_be_bytes());
        let code = format!("{:x}", hasher.finalize())[..10].to_string();
        let user_id = user.id;
        self.invites.insert(code, (user_id, cycles));
        Ok(())
    }

    fn critical<T: ToString>(&mut self, message: T) {
        self.logger
            .log(&message.to_string(), "CRITICAL".to_string());
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

    pub fn denotify_users(&mut self, filter: &dyn Fn(&User) -> bool) {
        for (user_id, mut inbox) in self
            .users
            .values_mut()
            .filter(|u| filter(u))
            .map(|u| (u.id, u.inbox.clone()))
            .collect::<Vec<_>>()
            .into_iter()
        {
            inbox.retain(|_, n| {
                if let Notification::Conditional(_, predicate) = n {
                    return match predicate {
                        Predicate::UserReportOpen(user_id) => self
                            .users
                            .get(user_id)
                            .and_then(|p| p.report.as_ref().map(|r| !r.closed))
                            .unwrap_or_default(),
                        Predicate::ReportOpen(post_id) => Post::get(self, post_id)
                            .and_then(|p| p.report.as_ref().map(|r| !r.closed))
                            .unwrap_or_default(),
                        Predicate::Proposal(post_id) => self
                            .proposals
                            .iter()
                            .last()
                            .map(|p| p.status == Status::Open && p.post_id == *post_id)
                            .unwrap_or_default(),
                    };
                }
                true
            });
            self.users.get_mut(&user_id).expect("no user found").inbox = inbox;
        }
    }

    pub fn search(&self, mut term: String) -> Vec<SearchResult> {
        const SNIPPET_LEN: usize = 100;
        term = term.to_lowercase();
        let snippet = |body: &str, i: usize| {
            if body.len() < SNIPPET_LEN {
                body.to_string()
            } else {
                body.chars()
                    .skip(i.saturating_sub(SNIPPET_LEN / 2))
                    .skip_while(|c| c.is_alphanumeric())
                    .take(SNIPPET_LEN)
                    .skip_while(|c| c.is_alphanumeric())
                    .collect::<String>()
            }
            .replace('\n', " ")
        };
        self.users
            .iter()
            .filter_map(
                |(
                    id,
                    User {
                        name,
                        about,
                        previous_names,
                        ..
                    },
                )| {
                    if format!("@{} {0} {} {} {:?}", name, id, about, previous_names)
                        .to_lowercase()
                        .contains(&term)
                    {
                        return Some(SearchResult {
                            id: *id,
                            relevant: about.clone(),
                            result: "user".to_string(),
                            ..Default::default()
                        });
                    }
                    None
                },
            )
            .chain(self.realms.iter().filter_map(|(id, realm)| {
                if id.to_lowercase().contains(&term) {
                    return Some(SearchResult {
                        generic_id: id.clone(),
                        relevant: snippet(realm.description.as_str(), 0),
                        result: "realm".to_string(),
                        ..Default::default()
                    });
                }
                if let Some(i) = realm.description.to_lowercase().find(&term) {
                    return Some(SearchResult {
                        generic_id: id.clone(),
                        relevant: snippet(realm.description.as_str(), i),
                        result: "realm".to_string(),
                        ..Default::default()
                    });
                }
                None
            }))
            .chain(
                self.recent_tags(Principal::anonymous(), None, 500)
                    .into_iter()
                    .filter_map(|(tag, _)| {
                        if format!("#{} {0}", tag).to_lowercase().contains(&term) {
                            return Some(SearchResult {
                                relevant: tag,
                                result: "tag".to_string(),
                                ..Default::default()
                            });
                        }
                        None
                    }),
            )
            .chain(
                self.last_posts(Principal::anonymous(), None, true)
                    .filter_map(|Post { id, body, user, .. }| {
                        if id.to_string() == term {
                            return Some(SearchResult {
                                id: *id,
                                user_id: *user,
                                relevant: snippet(body, 0),
                                result: "post".to_string(),
                                ..Default::default()
                            });
                        }
                        let search_body = body.to_lowercase();
                        if let Some(i) = search_body.find(&term) {
                            return Some(SearchResult {
                                id: *id,
                                user_id: *user,
                                relevant: snippet(body, i),
                                result: "post".to_string(),
                                ..Default::default()
                            });
                        }
                        None
                    }),
            )
            .take(100)
            .collect()
    }

    async fn top_up() {
        let children = read(|state| state.storage.buckets.keys().cloned().collect::<Vec<_>>());

        // top up the main canister
        let balance = canister_balance();
        let target_balance =
            CONFIG.min_cycle_balance_main + children.len() as u64 * ICP_CYCLES_PER_XDR;
        if balance < target_balance {
            let xdrs = target_balance / ICP_CYCLES_PER_XDR;
            // subtract weekly burned cycles to reduce the revenue
            mutate(|state| state.spend(xdrs * 1000, "canister top up"));
            match invoices::topup_with_icp(&api::id(), xdrs).await {
                Err(err) => mutate(|state| {
                    state.critical(format!(
                    "FAILED TO TOP UP THE MAIN CANISTER — {}'S FUNCTIONALITY IS ENDANGERED: {:?}",
                    CONFIG.name.to_uppercase(),
                    err
                ))
                }),
                Ok(_cycles) => mutate(|state| {
                    state.logger.info(format!(
                        "The main canister was topped up with cycles (balance was `{}`, now `{}`).",
                        balance,
                        canister_balance()
                    ))
                }),
            }
        }

        // top up all children canisters
        let mut topped_up = Vec::new();
        for canister_id in children {
            match crate::canisters::top_up(canister_id, 2 * ICP_CYCLES_PER_XDR).await {
                Ok(true) => topped_up.push(canister_id),
                Err(err) => mutate(|state| state.critical(err)),
                _ => {}
            }
        }
        if !topped_up.is_empty() {
            mutate(|state| {
                state.logger.info(format!(
                    "Topped up canisters: {:?}.",
                    topped_up
                        .into_iter()
                        .map(|p| p.to_string())
                        .collect::<Vec<_>>()
                ))
            })
        }
    }

    fn supply_of_active_users(&self, now: u64) -> (Vec<(UserId, Token)>, Token) {
        let active_user_balances = self
            .balances
            .iter()
            .filter_map(|(acc, balance)| {
                let user = self.principal_to_user(acc.owner)?;
                if user.active_within_weeks(now, CONFIG.revenue_share_activity_weeks) {
                    return Some((user.id, *balance));
                }
                None
            })
            .collect::<Vec<_>>();
        let supply_of_active_users: u64 = active_user_balances
            .iter()
            .map(|(_, balance)| balance)
            .sum();
        (active_user_balances, supply_of_active_users)
    }

    pub fn collect_revenue(&self, now: u64, e8s_for_one_xdr: u64) -> HashMap<UserId, u64> {
        let burned_cycles = self.burned_cycles;
        if burned_cycles <= 0 {
            return Default::default();
        }
        let (active_user_balances, supply_of_active_users) = self.supply_of_active_users(now);
        active_user_balances
            .into_iter()
            .map(|(user_id, balance)| {
                let revenue_share =
                    burned_cycles as f64 * balance as f64 / supply_of_active_users as f64;
                let e8s = (revenue_share / CONFIG.native_cycles_per_xdr as f64
                    * e8s_for_one_xdr as f64) as u64;
                (user_id, e8s)
            })
            .collect()
    }

    pub fn minting_ratio(&self) -> u64 {
        let circulating_supply: Token = self.balances.values().sum();
        let factor = (circulating_supply as f64 / CONFIG.total_supply as f64 * 10.0) as u64;
        1 << factor
    }

    pub fn mint(&mut self) {
        let karma = self
            .users
            .values()
            .filter(|user| user.karma() > 0)
            .map(|user| (user.id, user.karma_to_reward()))
            .collect::<HashMap<_, _>>();
        let circulating_supply: Token = self.balances.values().sum();
        if circulating_supply >= CONFIG.total_supply {
            return;
        }

        let mut minted_tokens = 0;
        let mut minters = Vec::new();
        let base = 10_u64.pow(CONFIG.token_decimals as u32);
        let ratio = self.minting_ratio();

        let total_tokens_to_mint: u64 = karma.values().map(|karma| *karma / ratio * base).sum();

        if ratio > 1
            && total_tokens_to_mint * 100 / circulating_supply > CONFIG.minting_threshold_percentage
        {
            self.logger.error(format!(
                "Skipping minting: `{}` tokens exceed the configured threshold of `{}`% of existing supply.",
                total_tokens_to_mint, CONFIG.minting_threshold_percentage
            ));
            return;
        }

        for (user_id, user_karma) in karma {
            let minted = user_karma / ratio * base;
            if minted == 0 {
                continue;
            }
            // This is a circuit breaker to avoid unforeseen side-effects due to hacks or bugs.
            if ratio > 1
                && minted * 100 / circulating_supply
                    > CONFIG.individual_minting_threshold_percentage
            {
                self.logger.error(format!(
                    "Minting skipped: `{}` tokens for user_id=`{}` exceed the configured threshold of `{}`% of existing supply.",
                    minted, user_id, CONFIG.individual_minting_threshold_percentage
                ));
                continue;
            }

            if let Some(user) = self.users.get_mut(&user_id) {
                user.notify(format!(
                    "{} minted `{}` ${} tokens for you! 💎",
                    CONFIG.name,
                    minted / base,
                    CONFIG.token_symbol,
                ));
                minters.push(format!("`{}` to @{}", minted / base, user.name));
                let acc = account(user.principal);
                crate::token::mint(self, acc, minted);
                minted_tokens += minted / base;
            }
        }

        // Mint team tokens
        for user in [0, 305]
            .iter()
            .filter_map(|id| self.users.get(id).cloned())
            .collect::<Vec<_>>()
        {
            let acc = account(user.principal);
            let vested = match self.team_tokens.get_mut(&user.id) {
                Some(balance) if *balance > 0 => {
                    // 1% of circulating supply is vesting.
                    let vested = (circulating_supply / 100).min(*balance);
                    // We use 14% because 1% will vest and we want to stay below 15%.
                    let cap = (circulating_supply * 14) / 100;
                    // Vesting is allowed if the total voting power of the team member stays below
                    // 15% of the current supply, or if 2/3 of total supply is minted.
                    if self.balances.get(&acc).copied().unwrap_or_default() <= cap
                        || circulating_supply * 3 > CONFIG.total_supply * 2
                    {
                        *balance -= vested;
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
                    user.name,
                    remaining_balance / 100
                ));
            }
        }

        if minters.is_empty() {
            self.logger.info("no tokens were minted".to_string());
        } else {
            self.logger.info(format!(
                "{} minted `{}` ${} tokens 💎 from the earned karma at the ratio `{}:1` as follows: {}",
                CONFIG.name,
                minted_tokens,
                CONFIG.token_symbol,
                ratio,
                minters.join(", ")
            ));
        }
    }

    pub fn collect_new_karma(&mut self) -> HashMap<UserId, u64> {
        self.users
            .values_mut()
            .filter(|u| u.karma_to_reward() > 0)
            .filter_map(|user| {
                let karma = user.karma_to_reward();
                if let Ok(cycles) = user.top_up_cycles_from_karma() {
                    user.apply_rewards();
                    if user.karma() < 0 {
                        return None;
                    }
                    return Some((user.id, karma - cycles));
                }
                None
            })
            .collect()
    }

    pub async fn icp_transfer(
        principal: Principal,
        recipient: String,
        amount: &str,
    ) -> Result<Tokens, String> {
        State::claim_user_icp(principal).await?;

        fn parse(amount: &str) -> Result<Tokens, String> {
            let parse = |s: &str| {
                s.parse::<u64>()
                    .map_err(|err| format!("Couldn't parse as u64: {:?}", err))
            };
            match &amount.split('.').collect::<Vec<_>>().as_slice() {
                [icpts] => Ok(Tokens::from_e8s(parse(icpts)? * 10_u64.pow(8))),
                [icpts, e8s] => {
                    let mut e8s = e8s.to_string();
                    while e8s.len() < 8 {
                        e8s.push('0');
                    }
                    let e8s = &e8s[..8];
                    Ok(Tokens::from_e8s(
                        parse(icpts)? * 10_u64.pow(8) + parse(e8s)?,
                    ))
                }
                _ => Err(format!("Can't parse amount {}", amount)),
            }
        }

        let amount = parse(amount)?;
        invoices::transfer(
            parse_account(&recipient)?,
            amount + invoices::fee(),
            Memo(1),
            Some(principal_to_subaccount(&principal)),
        )
        .await
        .map(|_| amount)
    }

    async fn distribute_icp(
        e8s_for_one_xdr: u64,
        karma_to_reward: HashMap<UserId, u64>,
        revenue: HashMap<UserId, u64>,
    ) {
        let treasury_balance = invoices::main_account_balance().await.e8s();
        let debt = mutate(|state| {
            let rewards = karma_to_reward
                .iter()
                .map(|(id, karma)| {
                    (
                        id,
                        (*karma as f64 / CONFIG.native_cycles_per_xdr as f64
                            * e8s_for_one_xdr as f64) as u64,
                    )
                })
                .collect::<HashMap<_, _>>();
            let total_payout =
                rewards.values().copied().sum::<u64>() + revenue.values().copied().sum::<u64>();
            if total_payout == 0 {
                state.logger.info("No payouts to distribute...");
                return 0;
            }
            // We stop distributions if the treasury balance falls below the minimum balance.
            let minimal_treasury_balance = CONFIG.min_treasury_balance_xdrs * e8s_for_one_xdr;
            if treasury_balance < total_payout || treasury_balance < minimal_treasury_balance {
                state
                    .logger
                    .info("Treasury balance is too low; skipping the payouts...");
                return 0;
            }
            let mut payments = Vec::default();
            let mut total_rewards = 0;
            let mut total_revenue = 0;
            for user in state.users.values_mut() {
                let mut user_revenue = revenue.get(&user.id).copied().unwrap_or_default();
                let _ = user.top_up_cycles_from_revenue(&mut user_revenue, e8s_for_one_xdr);
                let user_reward = rewards.get(&user.id).copied().unwrap_or_default();
                let e8s = user_reward + user_revenue;
                user.treasury_e8s += e8s;
                total_rewards += user_reward;
                total_revenue += user_revenue;
                payments.push(format!("`{}` to @{}", e8s_to_icp(e8s), &user.name));
                user.notify(format!(
                    "You received `{}` ICP as rewards and `{}` ICP as revenue! 💸",
                    e8s_to_icp(user_reward),
                    e8s_to_icp(user_revenue)
                ));
            }
            if state.burned_cycles > 0 {
                state.spend(state.burned_cycles as Cycles, "revenue distribution");
                state.burned_cycles_total += state.burned_cycles as Cycles;
            }
            state.total_rewards_shared += total_rewards;
            state.total_revenue_shared += total_revenue;
            let (_, supply_of_active_users) = state.supply_of_active_users(time());
            let e8s_revenue_per_1k = total_revenue
                / (supply_of_active_users / 1000 / 10_u64.pow(CONFIG.token_decimals as u32)).max(1);
            state.last_revenues.push_back(e8s_revenue_per_1k);
            while state.last_revenues.len() > 12 {
                state.last_revenues.pop_front();
            }
            state.logger.info(format!(
                "Paid out `{}` ICP as rewards and `{}` ICP as revenue as follows: {}",
                e8s_to_icp(total_rewards),
                e8s_to_icp(total_revenue),
                payments.join(", ")
            ));
            total_rewards + total_revenue
        });

        if let Err(err) =
            invoices::transfer(user_icp_account(), Tokens::from_e8s(debt), Memo(4545), None).await
        {
            mutate(|state| {
                state.logger.error(format!(
                    "user ICPs couldn't be transferred from the treasury: {err}"
                ))
            });
        }
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

    async fn daily_chores(now: u64) {
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

            if let Err(err) = state.archive_cold_data() {
                state
                    .logger
                    .error(format!("couldn't archive cold data: {:?}", err));
            }

            state.recompute_stalwarts(now);
        });

        if let Ok(e8s_for_one_xdr) = invoices::get_xdr_in_e8s().await {
            mutate(|state| state.e8s_for_one_xdr = e8s_for_one_xdr);
        }
    }

    fn archive_cold_data(&mut self) -> Result<(), String> {
        let max_posts_in_heap = 20_000;
        archive_cold_posts(self, max_posts_in_heap)
    }

    async fn handle_nns_proposals(now: u64) {
        #[cfg(feature = "staging")]
        return;

        // Vote on proposals if pending ones exist
        for (proposal_id, post_id) in read(|state| state.pending_nns_proposals.clone()) {
            if let Some(Extension::Poll(poll)) = read(|state| {
                Post::get(state, &post_id).and_then(|post| post.extension.as_ref().cloned())
            }) {
                // The poll is still pending.
                if read(|state| state.pending_polls.contains(&post_id)) {
                    continue;
                }

                let adopted = poll.weighted_by_karma.get(&0).copied().unwrap_or_default();
                let rejected = poll.weighted_by_karma.get(&1).copied().unwrap_or_default();
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
                        state.logger.error(format!(
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
                        .error(format!("couldn't fetch proposals: {}", err))
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
                            state
                                .logger
                                .error(format!("couldn't create a NNS proposal post: {:?}", err))
                        });
                    }
                };
            }

            if let Err(err) = canisters::vote_on_nns_proposal(proposal.id, NNSVote::Reject).await {
                mutate(|state| {
                    state.last_nns_proposal = state.last_nns_proposal.max(proposal.id);
                    state.logger.error(format!(
                        "couldn't vote on NNS proposal {}: {}",
                        proposal.id, err
                    ))
                });
            };
        }
    }

    async fn hourly_chores(now: u64) {
        mutate(|state| {
            // Automatically dump the heap to the stable memory. This should be the first
            // opearation to avoid blocking of the backup by a panic in other parts of the routine.
            memory::heap_to_stable(state);

            state.conclude_polls(now)
        });

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
        if last_weekly_chores + WEEK < now {
            State::weekly_chores(now).await;
            mutate(|state| state.last_weekly_chores += WEEK);
        }
        if last_daily_chores + DAY < now {
            State::daily_chores(now).await;
            mutate(|state| state.last_daily_chores += DAY);
        }
        if last_hourly_chores + HOUR < now {
            State::hourly_chores(now).await;
            mutate(|state| state.last_hourly_chores += HOUR);
        }
    }

    async fn weekly_chores(now: u64) {
        mutate(|state| state.clean_up(now));

        // We only mint and distribute if no open proposals exists
        if read(|state| state.proposals.iter().all(|p| p.status != Status::Open)) {
            mutate(|state| state.mint());
            match invoices::get_xdr_in_e8s().await {
                Ok(e8s_for_one_xdr) => {
                    let (karma, revenues) = mutate(|state| {
                        (
                            state.collect_new_karma(),
                            state.collect_revenue(time(), e8s_for_one_xdr),
                        )
                    });
                    State::distribute_icp(e8s_for_one_xdr, karma, revenues).await;
                }
                Err(err) => {
                    mutate(|state| {
                        state
                            .logger
                            .error(format!("Couldn't fetch ICP/XDR rate: {:?}", err))
                    });
                }
            };
        } else {
            mutate(|state| {
                state
                    .logger
                    .info("Skipping minting & distributions due to open proposals")
            });
        }

        mutate(|state| state.charge_for_inactivity(now));
    }

    fn clean_up(&mut self, now: u64) {
        for user in self.users.values_mut() {
            user.accounting.clear();
            if user.active_within_weeks(now, 1) {
                user.active_weeks += 1;
                if user.trusted() {
                    user.invites_budget = user.invites_budget.max(CONFIG.invites_budget_cycles);
                }
            } else {
                user.active_weeks = 0;
            }
            let inactive = !user.active_within_weeks(now, CONFIG.inactivity_duration_weeks);
            if inactive || user.is_bot() {
                user.clear_notifications(Vec::new())
            }
            if inactive && user.karma() > 0 {
                user.change_karma(
                    -(CONFIG.inactivity_penalty as Karma).min(user.karma()),
                    "inactivity_penalty".to_string(),
                );
            }
            user.karma_donations.clear();
        }
        self.accounting.clean_up();
    }

    fn charge_for_inactivity(&mut self, now: u64) {
        let mut inactive_users = 0;
        let mut cycles_total = 0;
        let inactive_user_balance_threshold = CONFIG.inactivity_penalty * 4;
        for (id, cycles) in self
            .users
            .values()
            .filter(|user| {
                !user.active_within_weeks(now, CONFIG.inactivity_duration_weeks)
                    && user.cycles() > inactive_user_balance_threshold
            })
            .map(|u| (u.id, u.cycles()))
            .collect::<Vec<_>>()
        {
            let costs = CONFIG
                .inactivity_penalty
                .min(cycles - inactive_user_balance_threshold);
            if let Err(err) = self.charge(id, costs, "inactivity penalty".to_string()) {
                self.logger
                    .error(format!("Couldn't charge inactivity penalty: {:?}", err));
            } else {
                cycles_total += costs;
                inactive_users += 1;
            }
        }
        self.logger.info(format!(
            "Charged `{}` inactive users with `{}` cycles.",
            inactive_users, cycles_total
        ));
    }

    fn recompute_stalwarts(&mut self, now: u64) {
        let mut users = self.users.values_mut().collect::<Vec<_>>();
        users.sort_unstable_by_key(|a| std::cmp::Reverse(a.karma()));

        let mut stalwart_seats = (users.len() * CONFIG.stalwart_percentage / 100).max(3);
        let mut left = Vec::new();
        let mut joined = Vec::new();
        let mut left_logs = Vec::new();
        let mut joined_logs = Vec::new();

        for u in users {
            if u.is_bot()
                || !u.trusted()
                || u.report.is_some()
                || now.saturating_sub(u.timestamp)
                    < WEEK * CONFIG.min_stalwart_account_age_weeks as u64
            {
                u.stalwart = false;
                continue;
            }
            match (
                u.stalwart,
                u.active_weeks >= CONFIG.min_stalwart_activity_weeks as u32,
                u.karma() > CONFIG.proposal_rejection_penalty as Karma,
                stalwart_seats,
            ) {
                // User is qualified but seats left or they lost karma
                (true, true, true, 0) | (true, _, false, _) => {
                    u.stalwart = false;
                    left.push(u.id);
                    left_logs.push(format!("@{} (karma)", u.name));
                }
                // A user is qualified and is already a stalwart and seats available
                (true, true, true, _) => {
                    stalwart_seats = stalwart_seats.saturating_sub(1);
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

    // Check if user has some unclaimed e8s in the Treasury and transfers them to user's account.
    async fn claim_user_icp(principal: Principal) -> Result<(), String> {
        let user = match read(|state| state.principal_to_user(principal).cloned()) {
            Some(user) => user,
            None => return Ok(()),
        };
        let fee = invoices::fee();
        if Tokens::from_e8s(user.treasury_e8s) > fee {
            invoices::transfer(
                parse_account(&user.account)?,
                Tokens::from_e8s(user.treasury_e8s) - fee,
                Memo(777),
                Some(USER_ICP_SUBACCOUNT),
            )
            .await?;
            mutate(|state| {
                if let Some(user) = state.users.get_mut(&user.id) {
                    user.treasury_e8s = 0
                }
            });
        }
        Ok(())
    }

    pub async fn mint_cycles(principal: Principal, kilo_cycles: u64) -> Result<Invoice, String> {
        State::claim_user_icp(principal).await?;

        let invoice = match Invoices::outstanding(&principal, kilo_cycles).await {
            Ok(val) => val,
            Err(err) => {
                if kilo_cycles == 0 {
                    mutate(|state| {
                        state
                            .logger
                            .error(&format!("couldn't generate invoice: {:?}", err))
                    });
                }
                return Err(err);
            }
        };

        mutate(|state| {
            if invoice.paid {
                if let Some(user) = state.principal_to_user_mut(principal) {
                    user.change_cycles(
                        ((invoice.paid_e8s as f64 / invoice.e8s as f64)
                            * CONFIG.native_cycles_per_xdr as f64)
                            as Cycles,
                        CyclesDelta::Plus,
                        "top up with ICP".to_string(),
                    )?;
                    let user_name = user.name.clone();
                    state.accounting.close(&principal);
                    state.logger.info(format!(
                        "@{} minted cycles for `{}` ICP 💰",
                        user_name,
                        e8s_to_icp(invoice.paid_e8s)
                    ));
                }
            }
            Ok(invoice)
        })
    }

    pub fn clear_notifications(&mut self, principal: Principal, ids: Vec<String>) {
        if let Some(user) = self.principal_to_user_mut(principal) {
            user.clear_notifications(ids)
        }
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
        caller: Principal,
        realm: Option<String>,
        tags: Vec<String>,
        users: Vec<UserId>,
        page: usize,
    ) -> Vec<Post> {
        let query: HashSet<_> = tags.into_iter().map(|tag| tag.to_lowercase()).collect();
        self.last_posts(caller, realm, true)
            .filter(|post| {
                (users.is_empty() || users.contains(&post.user))
                    && post
                        .tags
                        .iter()
                        .map(|tag| tag.to_lowercase())
                        .collect::<HashSet<_>>()
                        .is_superset(&query)
            })
            .skip(page * CONFIG.feed_page_size)
            .take(CONFIG.feed_page_size)
            .cloned()
            .collect()
    }

    pub fn last_posts<'a>(
        &'a self,
        caller: Principal,
        realm: Option<String>,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let inverse_filters = self.principal_to_user(caller).and_then(|user| {
            let filters = &user.filters;
            if filters.is_empty() {
                None
            } else {
                Some(filters)
            }
        });
        Box::new(
            {
                let last_id = self.next_post_id.saturating_sub(1);
                Box::new((0..=last_id).rev())
            }
            .filter_map(move |i| Post::get(self, &i))
            .filter(move |post| {
                !post.is_deleted()
                    && (with_comments || post.parent.is_none())
                    && (realm.is_none() || post.realm == realm)
                    && inverse_filters
                        .map(
                            |Filters {
                                 users,
                                 tags,
                                 realms,
                             }| {
                                post.realm
                                    .as_ref()
                                    .map(|id| Some(id) == realm.as_ref() || !realms.contains(id))
                                    .unwrap_or(true)
                                    && !users.contains(&post.user)
                                    && tags.is_disjoint(&post.tags)
                            },
                        )
                        .unwrap_or(true)
            }),
        )
    }

    pub fn recent_tags(
        &self,
        caller: Principal,
        realm: Option<String>,
        n: u64,
    ) -> Vec<(String, u64)> {
        // normalized hashtag -> (user spelled hashtag, occurences)
        let mut tags: HashMap<String, (String, u64)> = Default::default();
        let mut tags_found = 0;
        'OUTER: for post in self
            .last_posts(caller, realm, true)
            .take_while(|post| !post.archived)
        {
            for tag in &post.tags {
                let (_, counter) = tags.entry(tag.to_lowercase()).or_insert((tag.clone(), 0));
                // We only count tags occurences on root posts, if they have comments or reactions
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
        tags.into_iter()
            .filter_map(|(_, (tag, count))| (count > 1).then_some((tag, count)))
            .collect()
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
        handle
            .parse::<u64>()
            .ok()
            .and_then(|id| self.users.get(&id))
            .or_else(|| {
                self.users.values().find(|user| {
                    std::iter::once(&user.name)
                        .chain(user.previous_names.iter())
                        .any(|name| name.to_lowercase() == handle.to_lowercase())
                })
            })
    }

    pub async fn change_principal(
        principal: Principal,
        new_principal_str: String,
    ) -> Result<(), String> {
        if read(|state| state.voted_on_pending_proposal(principal)) {
            return Err("pending proposal with the current principal as voter exists".into());
        }
        #[allow(unused_variables)]
        let account_identifier = mutate(|state| {
            let new_principal =
                Principal::from_text(new_principal_str).map_err(|e| e.to_string())?;
            if state.principals.contains_key(&new_principal) {
                return Err("principal already controls a user".to_string());
            }
            let user_id = state
                .principals
                .remove(&principal)
                .ok_or("no principal found")?;
            state.principals.insert(new_principal, user_id);
            let user = state.users.get_mut(&user_id).expect("no user found");
            user.principal = new_principal;
            let account_identifier =
                AccountIdentifier::new(&id(), &principal_to_subaccount(&new_principal));
            user.account = account_identifier.to_string();
            let accounts = state
                .balances
                .keys()
                .filter(|acc| acc.owner == principal)
                .cloned()
                .collect::<Vec<_>>();
            for acc in accounts {
                crate::token::move_funds(state, &acc, account(new_principal))
                    .expect("couldn't transfer token funds");
            }
            Ok(account_identifier)
        })?;
        #[cfg(not(test))]
        {
            let balance = invoices::account_balance_of_principal(principal).await;
            invoices::transfer(
                account_identifier,
                balance,
                Memo(10101),
                Some(principal_to_subaccount(&principal)),
            )
            .await?;
        }
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

    pub fn logs(&self) -> &Vec<Event> {
        &self.logger.events
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

    pub fn stats(&self, now: u64) -> Stats {
        let mut stalwarts = Vec::new();
        let mut weekly_karma_leaders = Vec::new();
        let mut bootcamp_users = 0;
        let mut users_online = 0;
        let mut invited_users = 0;
        let mut active_users = 0;
        let mut bots = Vec::new();
        let mut cycles = 0;
        for user in self.users.values() {
            if user.stalwart {
                stalwarts.push(user);
            }
            if !user.trusted() {
                bootcamp_users += 1;
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
                if user.karma_to_reward() > 0 {
                    weekly_karma_leaders.push((user.id, user.karma_to_reward()));
                }
            }
            cycles += user.cycles();
        }
        stalwarts.sort_unstable_by_key(|u1| std::cmp::Reverse(u1.karma()));
        weekly_karma_leaders.sort_unstable_by_key(|k| k.1);
        weekly_karma_leaders = weekly_karma_leaders.into_iter().rev().take(12).collect();
        let posts = self.root_posts;
        Stats {
            holders: self.balances.len(),
            e8s_for_one_xdr: self.e8s_for_one_xdr,
            e8s_revenue_per_1k: self.last_revenues.iter().sum::<u64>()
                / self.last_revenues.len().max(1) as u64,
            team_tokens: self.team_tokens.clone(),
            meta: format!("Memory health: {}", self.memory.health("MB")),
            weekly_karma_leaders,
            bootcamp_users,
            module_hash: self.module_hash.clone(),
            canister_id: ic_cdk::id(),
            last_upgrade: self.last_upgrade,
            last_weekly_chores: self.last_weekly_chores,
            last_daily_chores: self.last_weekly_chores,
            last_hourly_chores: self.last_weekly_chores,
            canister_cycle_balance: canister_balance(),
            users: self.users.len(),
            posts,
            comments: Post::count(self) - posts,
            cycles,
            burned_cycles: self.burned_cycles,
            burned_cycles_total: self.burned_cycles_total,
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
        let user = self
            .principal_to_user(principal)
            .ok_or("no user found")?
            .clone();
        if !user.stalwart {
            return Err("only stalwarts can vote on reports".into());
        }
        let stalwarts = self.users.values().filter(|u| u.stalwart).count();
        let (user_id, report, penalty, subject) = match domain.as_str() {
            "post" => Post::mutate(
                self,
                &id,
                |post| -> Result<(UserId, Report, Cycles, String), String> {
                    post.vote_on_report(stalwarts, user.id, vote)?;
                    let post_user = post.user;
                    let post_report = post.report.clone().ok_or("no report")?;
                    Ok((
                        post_user,
                        post_report,
                        CONFIG.reporting_penalty_post,
                        format!("post {}", id),
                    ))
                },
            )?,
            "misbehaviour" => {
                if user.id == id {
                    return Err("votes on own reports are not accepted".into());
                }
                let report = self
                    .users
                    .get_mut(&id)
                    .and_then(|u| u.report.as_mut())
                    .expect("no user found");
                report.vote(stalwarts, user.id, vote)?;
                (
                    id,
                    report.clone(),
                    CONFIG.reporting_penalty_misbehaviour,
                    format!("user {}", id),
                )
            }
            _ => return Err("unknown report type".into()),
        };
        reports::finalize_report(self, &report, penalty, user_id, subject)
    }

    pub fn vote_on_poll(
        &mut self,
        principal: Principal,
        time: u64,
        post_id: PostId,
        vote: u16,
    ) -> Result<(), String> {
        let user = self
            .principal_to_user(principal)
            .ok_or_else(|| "no user found".to_string())?;
        let (user_id, user_realms) = (user.id, user.realms.clone());
        Post::mutate(self, &post_id, |post| {
            post.watchers.insert(user_id);
            post.vote_on_poll(user_id, user_realms.clone(), time, vote)
        })
    }

    pub fn report(
        &mut self,
        principal: Principal,
        domain: String,
        id: u64,
        reason: String,
    ) -> Result<(), String> {
        if reason.len() > 1000 {
            return Err("reason too long".into());
        }
        let cycles_required = if domain == "post" {
            CONFIG.reporting_penalty_post
        } else {
            CONFIG.reporting_penalty_misbehaviour
        } / 2;
        let user = match self.principal_to_user(principal) {
            Some(user) if user.cycles() >= cycles_required => user.clone(),
            _ => {
                return Err(format!(
                    "You need at least {} cycles for this report",
                    cycles_required
                ))
            }
        };
        let report = Some(Report {
            reporter: user.id,
            reason,
            ..Default::default()
        });

        match domain.as_str() {
            "post" => {
                let post_user = Post::mutate(self, &id, |post| {
                    if post.report.is_some() {
                        return Err("this post is already reported".into());
                    }
                    post.report = report.clone();
                    Ok(post.user)
                })?;
                let author_name = self
                    .users
                    .get(&post_user)
                    .map(|user| user.name.clone())
                    .unwrap_or_default();
                self.notify_with_predicate(
                    &|u| u.stalwart && u.id != user.id,
                    format!("@{} reported this post by @{}", user.name, author_name),
                    Predicate::ReportOpen(id),
                );
            }
            "misbehaviour" => {
                let misbehaving_user = self.users.get_mut(&id).ok_or("no user found")?;
                if misbehaving_user.report.as_ref().map(|r| r.closed) == Some(true) {
                    return Err("this user is already reported".into());
                }
                misbehaving_user.report = report;
                let user_name = misbehaving_user.name.clone();
                self.notify_with_predicate(
                    &|u| u.stalwart && u.id != id,
                    format!("@{} reported user @{}", user.name, user_name),
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

        let comments_tree_penalty =
            post.tree_size as Cycles * CONFIG.post_deletion_penalty_factor as Cycles;
        let karma = reaction_karma();
        let reaction_costs = post
            .reactions
            .iter()
            .filter_map(|(r_id, users)| {
                let cost = karma.get(r_id).copied().unwrap_or_default();
                (cost > 0).then_some((users, cost as Cycles))
            })
            .collect::<Vec<_>>();

        let costs: Cycles = CONFIG.post_cost
            + reaction_costs.iter().map(|(_, cost)| *cost).sum::<u64>()
            + comments_tree_penalty;
        if costs > self.users.get(&post.user).ok_or("no user found")?.cycles() {
            return Err(format!(
                "not enough cycles (this post requires {} cycles to be deleted)",
                costs
            ));
        }

        let mut karma_penalty = post.children.len() as Karma * CONFIG.response_reward as Karma;

        // refund rewards
        for (users, amount) in reaction_costs {
            for user_id in users {
                self.cycle_transfer(
                    post.user,
                    *user_id,
                    amount,
                    0,
                    Destination::Cycles,
                    format!("rewards refund after deletion of post {}", post.id),
                    None,
                )?;
                karma_penalty += amount as Karma;
            }
        }

        // penalize for comments tree destruction
        self.charge(
            post.user,
            CONFIG.post_cost + comments_tree_penalty,
            format!("deletion of post {}", post.id),
        )?;

        // subtract all rewards from karma
        self.users
            .get_mut(&post.user)
            .expect("no user found")
            .change_karma(-karma_penalty, format!("deletion of post {}", post.id));

        self.hot.retain(|id| id != &post_id);

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
    }

    pub fn react(
        &mut self,
        principal: Principal,
        post_id: PostId,
        reaction: u16,
        time: u64,
    ) -> Result<(), String> {
        let delta: i64 = match CONFIG.reactions.iter().find(|(id, _)| id == &reaction) {
            Some((_, delta)) => *delta,
            _ => return Err("unknown reaction".into()),
        };
        let user = self
            .principal_to_user(principal)
            .ok_or("no user for principal found")?
            .clone();
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

        let log = format!("reaction to post {}", post_id);
        // If the user is untrusted, they can only upvote, but this does not affect author's karma.
        // We skip this check if the project is in the bootstrap phase and has too few users.
        if self.users.len() as u32 > CONFIG.bootstrap_phase_user_number && !user.trusted() {
            if delta < 0 {
                return Err("bootcamp users can't downvote".into());
            }
            self.charge(user.id, delta.unsigned_abs() + CONFIG.reaction_fee, log)
                .expect("coudln't charge user");
        }
        // If the user is trusted, they initiate a cycle transfer for upvotes, but burn their own cycles on
        // down votes + cycles and karma of the author
        else if delta < 0 {
            self.users
                .get_mut(&post.user)
                .expect("user not found")
                .change_karma(delta, log.clone());
            self.charge(
                user.id,
                delta.unsigned_abs().min(user.cycles()),
                log.clone(),
            )?;
            self.charge(
                post.user,
                delta
                    .unsigned_abs()
                    .min(self.users.get(&post.user).expect("no user found").cycles()),
                log,
            )
            .expect("couldn't charge user");
        } else {
            self.cycle_transfer(
                user.id,
                post.user,
                delta as Cycles,
                CONFIG.reaction_fee,
                Destination::Karma,
                log,
                None,
            )?;
            post.make_hot(&mut self.hot, self.users.len(), user.id);
        }

        self.principal_to_user_mut(principal)
            .expect("no user for principal found")
            .last_activity = time;
        let user_id = user.id;
        Post::mutate(self, &post_id, |post| {
            post.reactions.entry(reaction).or_default().insert(user_id);
            Ok(())
        })
    }

    pub fn toggle_following_user(&mut self, principal: Principal, followee_id: UserId) -> bool {
        let (added, (id, name)) = {
            let user = match self.principal_to_user_mut(principal) {
                Some(user) => user,
                _ => return false,
            };
            (
                if user.followees.contains(&followee_id) {
                    user.followees.remove(&followee_id);
                    false
                } else {
                    user.followees.insert(followee_id);
                    true
                },
                (user.id, user.name.clone()),
            )
        };
        let followee = self.users.get_mut(&followee_id).expect("User not found");
        if added {
            followee.followers.insert(id);
            followee.notify(format!("@{} followed you", name));
        } else {
            followee.followers.remove(&id);
        }
        added
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

pub fn id() -> Principal {
    #[cfg(test)]
    return Principal::anonymous();
    #[cfg(not(test))]
    ic_cdk::id()
}

pub fn time() -> u64 {
    #[cfg(test)]
    return CONFIG.trusted_user_min_age_weeks * WEEK + 1;
    #[cfg(not(test))]
    api::time()
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

    pub fn create_user(state: &mut State, p: Principal) -> UserId {
        create_user_with_params(state, p, &p.to_string().replace('-', ""), true, 1000)
    }

    pub fn create_user_with_cycles(state: &mut State, p: Principal, cycles: Cycles) -> UserId {
        create_user_with_params(state, p, &p.to_string().replace('-', ""), true, cycles)
    }

    pub fn create_untrusted_user(state: &mut State, p: Principal) -> UserId {
        create_user_with_params(state, p, &p.to_string().replace('-', ""), false, 1000)
    }

    fn create_user_with_params(
        state: &mut State,
        p: Principal,
        name: &str,
        trusted: bool,
        cycles: Cycles,
    ) -> UserId {
        let id = state.new_user(p, 0, name.to_string());
        let u = state.users.get_mut(&id).unwrap();
        u.change_cycles(cycles, CyclesDelta::Plus, "").unwrap();
        if trusted {
            u.change_karma(CONFIG.trusted_user_min_karma, "");
            u.apply_rewards();
        }
        id
    }

    #[test]
    fn test_cycle_transfer() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            let id1 = create_user_with_params(state, pr(0), "peter", false, 10000);
            let id2 = create_user_with_params(state, pr(0), "peter", false, 0);

            assert_eq!(state.users.get(&id2).unwrap().cycles(), 0);
            state
                .cycle_transfer(
                    id1,
                    id2,
                    1000,
                    CONFIG.cycle_transaction_fee,
                    Destination::Cycles,
                    "",
                    None,
                )
                .unwrap();
            assert_eq!(state.users.get(&id2).unwrap().cycles(), 1000);
            state
                .cycle_transfer(
                    id1,
                    id2,
                    1000,
                    CONFIG.cycle_transaction_fee,
                    Destination::Cycles,
                    "",
                    None,
                )
                .unwrap();
            assert_eq!(state.users.get(&id2).unwrap().cycles(), 2000);
            assert_eq!(
                state.users.get(&id1).unwrap().cycles(),
                10000 - 2 * (1000 + CONFIG.cycle_transaction_fee)
            );
        });
    }

    #[actix_rt::test]
    async fn test_name_change() {
        let id = STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            create_user_with_params(state, pr(0), "peter", false, 10000)
        });

        let user = read(|state| state.users.get(&id).unwrap().clone());
        assert_eq!(user.name, "peter".to_string());
        assert!(user.previous_names.is_empty());

        // update with wrong principal
        assert!(User::update(
            pr(1),
            Some("john".into()),
            Default::default(),
            vec![],
            Default::default()
        )
        .is_err());

        // correct update
        assert!(User::update(
            pr(0),
            Some("john".into()),
            Default::default(),
            vec![],
            Default::default()
        )
        .is_ok());

        let user = read(|state| state.users.get(&id).unwrap().clone());
        assert_eq!(user.name, "john".to_string());
        assert_eq!(user.previous_names.as_slice(), &["peter"]);

        // The old name is reserved now
        assert_eq!(
            State::create_user(pr(2), "peter".into(), None).await,
            Err("taken".to_string())
        );
    }

    #[test]
    fn test_new_karma_collection() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            for (i, (karma_to_reward, total_karma)) in
                vec![(125, 0), (34, -22), (0, 55)].into_iter().enumerate()
            {
                let id = create_user(state, pr(i as u8));
                let user = state.users.get_mut(&id).unwrap();
                // remove first whatever karma is there
                user.change_karma(-user.karma(), "");
                user.change_karma(total_karma, "");
                user.apply_rewards();
                user.change_karma(karma_to_reward, "");
            }

            let new_karma = state.collect_new_karma();

            let user = state.principal_to_user(pr(0)).unwrap();
            assert_eq!(*new_karma.get(&user.id).unwrap(), 125);
            assert_eq!(user.karma(), 125);

            let user = state.principal_to_user(pr(1)).unwrap();
            // no new karma was collected
            assert!(!new_karma.contains_key(&user.id));
            assert_eq!(user.karma(), -22 + 34);

            let user = state.principal_to_user(pr(2)).unwrap();
            // no new karma was collected
            assert!(!new_karma.contains_key(&user.id));
            assert_eq!(user.karma(), 55);
        });
    }

    #[test]
    fn test_revenue_collection() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            let now = WEEK * CONFIG.revenue_share_activity_weeks;

            for (i, (balance, total_karma, last_activity)) in vec![
                // Active user with 100 tokens and no karma
                (10000, 0, now),
                // Active, with 200 tokens and some karma
                (20000, CONFIG.trusted_user_min_karma, now),
                // Inactive, with 300 tokens and some karma
                (30000, CONFIG.trusted_user_min_karma, 0),
            ]
            .into_iter()
            .enumerate()
            {
                let principal = pr(i as u8);
                let id = create_user(state, principal);
                let user = state.users.get_mut(&id).unwrap();
                // remove first whatever karma is there
                user.change_karma(-user.karma(), "");
                user.change_karma(total_karma, "");
                user.last_activity = last_activity;
                state.balances.insert(account(principal), balance);
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

            let karma_insert = |state: &mut State, user_id, karma| {
                state
                    .users
                    .get_mut(&user_id)
                    .unwrap()
                    .change_karma(karma as Karma, "")
            };

            for i in 0..5 {
                create_user(state, pr(i));
                karma_insert(state, i as u64, 1 + i as u64 * 100);
            }

            let minting_acc = account(Principal::anonymous());
            state
                .balances
                .insert(minting_acc.clone(), CONFIG.total_supply);

            state.mint();

            // no minting hapened due to max supply
            assert_eq!(state.balances.len(), 1);

            state.balances.remove(&minting_acc);
            state.mint();

            assert_eq!(state.balances.len(), 5);
            assert_eq!(*state.balances.get(&account(pr(0))).unwrap(), 100);
            assert_eq!(*state.balances.get(&account(pr(1))).unwrap(), 10100);
            assert_eq!(*state.balances.get(&account(pr(2))).unwrap(), 20100);
            assert_eq!(*state.balances.get(&account(pr(3))).unwrap(), 30100);
            assert_eq!(*state.balances.get(&account(pr(4))).unwrap(), 40100);

            // increase minting ratio
            assert_eq!(state.minting_ratio(), 1);
            state.balances.insert(account(pr(5)), 10000000);
            assert_eq!(state.minting_ratio(), 2);

            // Test circuit breaking
            karma_insert(state, 3, 301);
            karma_insert(state, 4, 60_000);
            state.mint();

            // Tokens were not minted to to circuit breaking
            assert_eq!(*state.balances.get(&account(pr(3))).unwrap(), 30100);
            assert_eq!(*state.balances.get(&account(pr(4))).unwrap(), 40100);

            // Imitate a healthy minting grow by increasing the supply
            state.balances.insert(minting_acc.clone(), 20000000);
            state.mint();

            // Tokens were minted for user 3
            assert_eq!(*state.balances.get(&account(pr(3))).unwrap(), 37600);
            // Tokens were not minted for user 4
            assert_eq!(*state.balances.get(&account(pr(4))).unwrap(), 40100);
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

            // create users each having trusted_user_min_karma + i*10, e.g.
            // user 1: 35, user 2: 45, user 3: 55, etc...
            for i in 1..11 {
                let p = pr(i);
                let id = create_user(state, p);
                let user = state.users.get_mut(&id).unwrap();
                // we create the same amount of new and hard karma so that we have both karma and
                // balances after minting
                user.change_karma(i as Karma * 10, "test");
                user.apply_rewards();
                user.change_karma(i as Karma * 10, "test");
                assert_eq!(
                    user.karma(),
                    i as Karma * 10 + CONFIG.trusted_user_min_karma
                );
                assert!(user.trusted());
            }

            // mint tokens
            state.mint();
            assert_eq!(state.ledger.len(), 10);

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
                // Here we can see that by karma the difference is way smaller becasue values are
                // normalized by the square root.
                assert_eq!(*poll.weighted_by_karma.get(&0).unwrap(), 21);
                assert_eq!(*poll.weighted_by_karma.get(&1).unwrap(), 26);
                assert_eq!(*poll.weighted_by_karma.get(&2).unwrap(), 31);
                assert_eq!(*poll.weighted_by_tokens.get(&0).unwrap(), 9000);
                assert_eq!(*poll.weighted_by_tokens.get(&1).unwrap(), 18000);
                assert_eq!(*poll.weighted_by_tokens.get(&2).unwrap(), 27000);
            } else {
                panic!("should be a poll")
            }
        });
    }

    #[actix_rt::test]
    async fn test_principal_change() {
        let u_id = STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            for i in 1..3 {
                let p = pr(i);
                create_user(state, p);
                let user = state.principal_to_user_mut(pr(i)).unwrap();
                user.change_karma(i as Karma * 111, "test");
                assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
                assert!(user.trusted());
            }

            // mint tokens
            state.mint();
            assert_eq!(state.ledger.len(), 2);
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
            user_id
        });

        let new_principal_str: String =
            "yh4uw-lqajx-4dxcu-rwe6s-kgfyk-6dicz-yisbt-pjg7v-to2u5-morox-hae".into();

        match State::change_principal(pr(1), new_principal_str.clone()).await {
            Err(err)
                if err.contains("pending proposal with the current principal as voter exist") => {}
            val => panic!("unexpected outcome: {:?}", val),
        };

        mutate(|state| state.proposals.get_mut(0).unwrap().status = Status::Executed);

        assert!(State::change_principal(pr(1), new_principal_str.clone())
            .await
            .is_ok());

        mutate(|state| {
            let principal = Principal::from_text(new_principal_str).unwrap();
            assert_eq!(state.principal_to_user(principal).unwrap().id, u_id);
            assert!(state.balances.get(&account(pr(1))).is_none());
            assert_eq!(
                *state.balances.get(&account(principal)).unwrap(),
                11100 - CONFIG.transaction_fee
            );
            let user = state.users.get(&u_id).unwrap();
            assert_eq!(user.principal, principal);
            assert_eq!(
                user.account,
                AccountIdentifier::new(&id(), &principal_to_subaccount(&principal)).to_string()
            );
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
            .last_posts(Principal::anonymous(), None, true)
            .filter(|post| post.realm.as_ref() == Some(&name.to_string()))
            .map(|post| post.id)
            .collect::<Vec<_>>()
    }

    #[test]
    fn test_post_deletion() {
        STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();

            let id = create_user(state, pr(0));
            let user = state.users.get_mut(&id).unwrap();
            assert_eq!(user.karma_to_reward(), 0);
            let upvoter_id = create_user(state, pr(1));
            let user = state.users.get_mut(&upvoter_id).unwrap();
            let upvoter_cycles = user.cycles();
            user.change_karma(1000, "test");
            assert!(user.trusted());
            let uid = create_user(state, pr(2));
            create_user(state, pr(3));
            state
                .users
                .get_mut(&uid)
                .unwrap()
                .change_karma(1000, "test");

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
                state.users.get(&id).unwrap().karma_to_reward(),
                10 + 5 + 2 * CONFIG.response_reward
            );

            assert_eq!(
                state.users.get_mut(&upvoter_id).unwrap().cycles(),
                // reward + fee + post creation
                upvoter_cycles - 10 - 1 - 2
            );

            let versions = vec!["a".into(), "b".into()];
            assert_eq!(
                state.delete_post(pr(1), post_id, versions.clone()),
                Err("not authorized".into())
            );

            state
                .charge(id, state.users.get(&id).unwrap().cycles(), "")
                .unwrap();
            assert_eq!(
                state.delete_post(pr(0), post_id, versions.clone()),
                Err("not enough cycles (this post requires 47 cycles to be deleted)".into())
            );

            state
                .users
                .get_mut(&id)
                .unwrap()
                .change_cycles(1000, CyclesDelta::Plus, "")
                .unwrap();

            assert_eq!(&Post::get(state, &0).unwrap().body, "Test");
            assert_eq!(state.delete_post(pr(0), post_id, versions.clone()), Ok(()));
            assert_eq!(&Post::get(state, &0).unwrap().body, "");
            assert_eq!(Post::get(state, &0).unwrap().hashes.len(), versions.len());

            assert_eq!(
                state.users.get(&upvoter_id).unwrap().cycles(),
                // reward received back
                upvoter_cycles - 10 - 1 - 2 + 10
            );
            assert_eq!(state.users.get(&id).unwrap().karma_to_reward(), 0);

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
            let _u0 = create_user_with_params(state, p0, "user1", true, 1000);
            let _u1 = create_user_with_params(state, p1, "user2", true, 1000);

            let user1 = state.users.get_mut(&_u1).unwrap();
            assert_eq!(user1.cycles(), 1000);
            user1.change_cycles(500, CyclesDelta::Minus, "").unwrap();
            assert_eq!(user1.cycles(), 500);

            let name = "TAGGRDAO".to_string();
            let description = "Test description".to_string();
            let controllers: BTreeSet<_> = vec![_u0].into_iter().collect();

            // simple creation and description change edge cases
            assert_eq!(
                state.create_realm(
                    pr(2),
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description.clone(),
                    controllers.clone()
                ),
                Err("no user found".to_string())
            );

            assert_eq!(
                state.create_realm(
                    p1,
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description.clone(),
                    controllers.clone()
                ),
                Err(
                    "couldn't charge 1000 cycles for realm creation: not enough cycles".to_string()
                )
            );

            assert_eq!(
                state.create_realm(
                    p0,
                    "THIS_NAME_IS_TOO_LONG".to_string(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description.clone(),
                    controllers.clone()
                ),
                Err("realm name too long".to_string())
            );

            assert_eq!(
                state.create_realm(
                    p0,
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description.clone(),
                    Default::default(),
                ),
                Err("no controllers specified".to_string())
            );

            assert_eq!(
                state.create_realm(
                    p0,
                    "TEST NAME".to_string(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description.clone(),
                    controllers.clone()
                ),
                Err("realm name should be an alpha-numeric string".to_string(),)
            );

            assert_eq!(
                state.create_realm(
                    p0,
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description.clone(),
                    controllers.clone()
                ),
                Ok(())
            );

            let user0 = state.users.get_mut(&_u0).unwrap();
            user0.change_cycles(1000, CyclesDelta::Plus, "").unwrap();

            assert_eq!(
                state.create_realm(
                    p0,
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description.clone(),
                    controllers.clone()
                ),
                Err("realm name taken".to_string())
            );

            assert_eq!(
                state.realms.get(&name).unwrap().description,
                "Test description".to_string()
            );

            let new_description = "New test description".to_string();

            assert_eq!(
                state.edit_realm(
                    p0,
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    new_description.clone(),
                    Default::default()
                ),
                Err("no controllers specified".to_string())
            );

            assert_eq!(
                state.edit_realm(
                    pr(2),
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    new_description.clone(),
                    controllers.clone()
                ),
                Err("no user found".to_string())
            );

            assert_eq!(
                state.edit_realm(
                    p0,
                    "WRONGNAME".to_string(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    new_description.clone(),
                    controllers.clone()
                ),
                Err("no realm found".to_string())
            );

            assert_eq!(
                state.edit_realm(
                    p1,
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    new_description.clone(),
                    controllers.clone()
                ),
                Err("not authorized".to_string())
            );

            assert_eq!(
                state.edit_realm(
                    p0,
                    name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    new_description.clone(),
                    controllers.clone()
                ),
                Ok(())
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
            assert_eq!(state.realms.get(&name).unwrap().num_posts, 1);

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

            // comments not possible if user is not in the realm
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
                Err("not a member of the realm TAGGRDAO".to_string())
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
                Ok(2)
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
            user0.change_cycles(1000, CyclesDelta::Plus, "").unwrap();
            assert_eq!(
                state.create_realm(
                    p0,
                    realm_name.clone(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    description,
                    controllers
                ),
                Ok(())
            );

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
            assert_eq!(state.realms.get(&realm_name).unwrap().num_posts, 0);

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
                Ok(5)
            );
            assert_eq!(state.realms.get(&realm_name).unwrap().num_posts, 1);

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
                5,
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
            assert_eq!(Post::get(state, &5).unwrap().realm, Some(realm_name));
            assert_eq!(state.realms.get("TAGGRDAO").unwrap().num_posts, 2);
        });
        assert_eq!(
            Post::edit(
                5,
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
            assert_eq!(state.realms.get("NEW_REALM").unwrap().num_posts, 0);
            assert_eq!(state.realms.get("TAGGRDAO").unwrap().num_posts, 3);
            assert_eq!(
                Post::get(state, &5).unwrap().realm,
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

            let u1 = create_user_with_params(state, pr(0), "user1", true, 1000);
            let u2 = create_user_with_params(state, pr(1), "user2", true, 1000);
            let u3 = create_user_with_params(state, pr(2), "user3", true, 1000);

            assert_eq!(state.user("user1").unwrap().id, u1);
            assert_eq!(state.user("0").unwrap().id, u1);
            assert_eq!(state.user("user2").unwrap().id, u2);
            assert_eq!(state.user("1").unwrap().id, u2);
            assert_eq!(state.user("user3").unwrap().id, u3);
            assert_eq!(state.user("2").unwrap().id, u3);
            assert!(state.user("user22").is_none());
        });
    }

    #[test]
    fn test_inverse_filter() {
        STATE.with(|cell| cell.replace(Default::default()));

        mutate(|state| {
            // create a post author and one post for its principal
            let p = pr(0);
            let post_author_id = create_user_with_cycles(state, p, 2000);

            assert!(state
                .create_realm(
                    p,
                    "TESTREALM".into(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    Default::default(),
                    vec![post_author_id].into_iter().collect(),
                )
                .is_ok());
            state.toggle_realm_membership(p, "TESTREALM".into());

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

            let caller = pr(1);
            let _ = create_user(state, caller);

            // without filters we see the new post
            let post_visible = |state: &State| {
                state
                    .last_posts(caller, None, true)
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
                .personal_feed(state, 0, true)
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
                .personal_feed(state, 0, true)
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
                .personal_feed(state, 0, true)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 1);
            assert!(feed.contains(&post_id));

            // now a different post with the same tags appears
            let p = pr(2);
            let _post_author_id = create_user(state, p);
            let post_id2 = Post::create(
                state,
                "This is a different #post, but with the same #tags".to_string(),
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
                .personal_feed(state, 0, true)
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
                .personal_feed(state, 0, true)
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
                .personal_feed(state, 0, true)
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
                .personal_feed(state, 0, true)
                .map(|post| post.id)
                .collect::<Vec<_>>();
            assert_eq!(feed.len(), 2);
            assert!(feed.contains(&post_id));
            assert!(feed.contains(&post_id2));
        });
    }

    #[test]
    fn test_clean_up() {
        STATE.with(|cell| cell.replace(Default::default()));
        mutate(|state| {
            let inactive_id1 = create_user_with_cycles(state, pr(1), 500);
            let inactive_id2 = create_user_with_cycles(state, pr(2), 100);
            let inactive_id3 = create_user_with_cycles(state, pr(3), 200);
            let active_id = create_user_with_cycles(state, pr(3), 300);

            let user = state.users.get_mut(&inactive_id1).unwrap();
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
            assert_eq!(user.invites_budget, 0);
            let user = state.users.get_mut(&inactive_id3).unwrap();
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
            let user = state.users.get_mut(&active_id).unwrap();
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
            assert_eq!(user.invites_budget, 0);

            let now = WEEK * 27;
            state.users.get_mut(&active_id).unwrap().last_activity = now;

            state.clean_up(now);
            state.charge_for_inactivity(now);

            let penalty = CONFIG.inactivity_penalty;

            // penalized
            let user = state.users.get_mut(&inactive_id1).unwrap();
            assert_eq!(user.cycles(), 500 - penalty);
            assert_eq!(user.karma(), 0);
            assert_eq!(user.invites_budget, 0);
            // not penalized due to low balance, but karma penalized
            let user = state.users.get_mut(&inactive_id2).unwrap();
            assert_eq!(user.cycles(), 100);
            assert_eq!(user.karma(), 0);
            assert_eq!(user.invites_budget, 0);
            // penalized to the minimum balance
            let user = state.users.get_mut(&inactive_id3).unwrap();
            assert_eq!(user.cycles(), penalty * 4);
            assert_eq!(user.invites_budget, 0);
            // Active user not penalized
            let user = state.users.get_mut(&active_id).unwrap();
            assert_eq!(user.cycles(), 300);
            assert_eq!(user.karma(), CONFIG.trusted_user_min_karma);
            assert_eq!(user.invites_budget, CONFIG.invites_budget_cycles);
        })
    }

    #[test]
    fn test_cycles_accounting() {
        STATE.with(|cell| cell.replace(Default::default()));
        mutate(|state| {
            let p0 = pr(0);
            let post_author_id = create_user(state, p0);
            let post_id =
                Post::create(state, "test".to_string(), &[], p0, 0, None, None, None).unwrap();
            let p = pr(1);
            let p2 = pr(2);
            let p3 = pr(3);

            let lurker_id = create_user(state, p);
            create_user(state, p2);
            create_user(state, p3);
            // add more users to skip the bootstrapping phase
            for i in 4..CONFIG.bootstrap_phase_user_number {
                create_user(state, pr(i as u8));
            }
            let farmer_id = create_untrusted_user(state, pr(111));
            let c = CONFIG;
            assert_eq!(state.burned_cycles as Cycles, c.post_cost);
            state
                .users
                .get_mut(&lurker_id)
                .unwrap()
                .change_karma(10, "");
            state.users.get_mut(&lurker_id).unwrap().apply_rewards();
            // make author to a new user
            state
                .users
                .get_mut(&post_author_id)
                .unwrap()
                .change_karma(-CONFIG.trusted_user_min_karma, "");
            let author = state.users.get(&post_author_id).unwrap();
            let farmer = state.users.get(&farmer_id).unwrap();
            let lurker = state.users.get(&lurker_id).unwrap();
            assert!(!author.trusted());
            assert!(!farmer.trusted());
            assert!(lurker.trusted());
            assert_eq!(author.cycles(), c.native_cycles_per_xdr - c.post_cost);
            assert_eq!(lurker.cycles(), c.native_cycles_per_xdr);

            assert_eq!(author.karma(), 0);

            // react on the new post
            assert!(state.react(pr(111), post_id, 1, 0).is_err());
            // this is a noop for author
            assert!(state.react(pr(111), post_id, 100, 0).is_ok());
            let burned_cycles_by_reaction_from_untrusted = 11;
            assert_eq!(
                state.users.get(&post_author_id).unwrap().cycles(),
                c.native_cycles_per_xdr - c.post_cost
            );
            assert!(state.react(p, post_id, 50, 0).is_ok());
            assert!(state.react(p, post_id, 100, 0).is_err());
            assert!(state.react(p2, post_id, 100, 0).is_ok());
            let reaction_costs_1 = 6;
            let burned_cycles_by_reactions = 1 + 1;
            let mut rewards_from_reactions = 5 + 10;

            // try to self upvote (should be a no-op)
            assert!(state.react(p0, post_id, 100, 0).is_err());

            let author = state.users.get(&post_author_id).unwrap();
            assert_eq!(author.cycles(), c.native_cycles_per_xdr - c.post_cost);
            assert_eq!(author.karma_to_reward(), rewards_from_reactions);
            assert_eq!(
                state.burned_cycles as Cycles,
                c.post_cost + burned_cycles_by_reactions + burned_cycles_by_reaction_from_untrusted
            );

            let lurker = state.users.get(&lurker_id).unwrap();
            assert_eq!(lurker.cycles(), c.native_cycles_per_xdr - reaction_costs_1);

            // downvote
            assert!(state.react(p3, post_id, 1, 0).is_ok());
            let reaction_penalty = 3;
            rewards_from_reactions -= 3;
            let author = state.users.get(&post_author_id).unwrap();
            let lurker_3 = state.principal_to_user(p3).unwrap();
            assert_eq!(
                author.cycles(),
                c.native_cycles_per_xdr - c.post_cost - reaction_penalty
            );
            assert_eq!(author.karma_to_reward(), rewards_from_reactions);
            assert_eq!(lurker_3.cycles(), c.native_cycles_per_xdr - 3);
            assert_eq!(
                state.burned_cycles,
                (c.post_cost
                    + burned_cycles_by_reactions
                    + burned_cycles_by_reaction_from_untrusted
                    + 2 * 3) as i64
            );

            Post::create(state, "test".to_string(), &[], p0, 0, Some(0), None, None).unwrap();

            let c = CONFIG;
            assert_eq!(
                state.burned_cycles,
                (2 * c.post_cost
                    + burned_cycles_by_reactions
                    + burned_cycles_by_reaction_from_untrusted
                    + 2 * 3) as i64
            );
            let author = state.users.get(&post_author_id).unwrap();
            assert_eq!(
                author.cycles(),
                c.native_cycles_per_xdr - c.post_cost - c.post_cost - reaction_penalty
            );

            let author = state.users.get_mut(&post_author_id).unwrap();
            author
                .change_cycles(author.cycles(), CyclesDelta::Minus, "")
                .unwrap();

            assert!(Post::create(state, "test".to_string(), &[], p0, 0, None, None, None).is_err());

            assert_eq!(
                state.react(p, post_id, 10, 0),
                Err("multiple reactions are forbidden".into())
            );
            create_user(state, pr(10));
            let lurker = state.principal_to_user_mut(pr(10)).unwrap();
            lurker
                .change_cycles(lurker.cycles(), CyclesDelta::Minus, "")
                .unwrap();
            assert_eq!(
                state.react(pr(10), post_id, 10, 0),
                Err("not enough cycles".into())
            );
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
                user.change_karma(i as i64, "");
                user.apply_rewards();
                // every second user was active
                if i % 2 == 0 {
                    user.last_activity = now;
                    user.active_weeks = CONFIG.min_stalwart_activity_weeks as u32;
                    user.timestamp = 0;
                    user.change_karma(CONFIG.proposal_rejection_penalty as Karma, "");
                    user.apply_rewards();
                }
            }

            state.recompute_stalwarts(now + WEEK * 2);

            // make sure we have right number of stalwarts
            assert_eq!(
                state.users.values().filter(|u| u.stalwart).count(),
                CONFIG.stalwart_percentage * 2
            );
            assert!(!state
                .realms
                .get(CONFIG.dao_realm)
                .unwrap()
                .controllers
                .is_empty());
        })
    }

    #[actix_rt::test]
    async fn test_invites() {
        let principal = pr(1);
        let (id, code, prev_balance) = STATE.with(|cell| {
            cell.replace(Default::default());
            let state = &mut *cell.borrow_mut();
            let id = create_user(state, principal);

            // use too many cycles
            assert_eq!(
                state.create_invite(principal, 1111),
                Err("not enough cycles".to_string())
            );

            // use enough cycles and make sure they were deducted
            let prev_balance = state.users.get(&id).unwrap().cycles();
            assert_eq!(state.create_invite(principal, 111), Ok(()));
            let new_balance = state.users.get(&id).unwrap().cycles();
            // no charging yet
            assert_eq!(new_balance, prev_balance);
            let invite = state.invites(principal);
            assert_eq!(invite.len(), 1);
            let (code, cycles) = invite.get(0).unwrap().clone();
            assert_eq!(cycles, 111);
            (id, code, prev_balance)
        });

        // use the invite
        assert!(State::create_user(pr(2), "name".to_string(), Some(code))
            .await
            .is_ok());

        let new_balance = mutate(|state| state.users.get(&id).unwrap().cycles());
        assert_eq!(new_balance, prev_balance - 111);

        // Subsidized invite
        let (id, code, prev_balance) = mutate(|state| {
            let user = state.users.get_mut(&id).unwrap();
            user.invites_budget = 300;
            let prev_balance = user.cycles();
            assert_eq!(state.create_invite(principal, 222), Ok(()));
            let invite = state.invites(principal);
            let (code, cycles) = invite.get(0).unwrap().clone();
            assert_eq!(cycles, 222);
            (id, code, prev_balance)
        });

        let prev_revenue = read(|state| state.burned_cycles);

        assert!(State::create_user(pr(3), "name2".to_string(), Some(code))
            .await
            .is_ok());

        let user = read(|state| state.users.get(&id).unwrap().clone());
        // Make sure didn't pay with own cycles
        assert_eq!(user.cycles(), prev_balance);
        // Make sure Taggr payed for the invite
        assert_eq!(user.invites_budget, 300 - 222);
        assert_eq!(read(|state| state.burned_cycles), prev_revenue - 222);
    }
}
