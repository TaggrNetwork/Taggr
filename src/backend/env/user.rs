use super::{post_iterators::IteratorMerger, reports::Report, *};
use api::management_canister::main::CanisterId;
use ic_ledger_types::{AccountIdentifier, DEFAULT_SUBACCOUNT};
use serde::{Deserialize, Serialize};

pub type UserId = u64;

#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct Pfp {
    pub nonce: u64,
    pub palette_nonce: u64,
    pub colors: u64,
    pub genesis: bool,
}

impl Default for Pfp {
    fn default() -> Self {
        Self {
            nonce: 0,
            palette_nonce: 2,
            colors: 3,
            genesis: true,
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
pub struct Filters {
    pub users: BTreeSet<UserId>,
    pub tags: BTreeSet<String>,
    pub realms: BTreeSet<String>,
    pub noise: UserFilter,
}

#[derive(PartialEq)]
pub enum CreditsDelta {
    Plus,
    Minus,
}

#[derive(Clone, Serialize, Deserialize)]
pub enum Predicate {
    // TODO: delete
    ReportOpen(PostId),
    UserReportOpen(UserId),
    Proposal(PostId),
}

#[derive(Clone, Serialize, Deserialize)]
pub enum Notification {
    NewPost(String, PostId),
    Generic(String),
    Conditional(String, Predicate),
    WatchedPostEntries(PostId, Vec<PostId>),
}

// This struct will hold user's new post until it's saved.
pub struct Draft {
    pub body: String,
    pub realm: Option<String>,
    pub extension: Option<Blob>,
    pub blobs: Vec<(String, Blob)>,
}

#[derive(Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserFilter {
    age_days: u64,
    safe: bool,
    balance: Token,
    num_followers: usize,
}

impl UserFilter {
    pub fn passes(&self, filter: &UserFilter) -> bool {
        let UserFilter {
            age_days,
            safe,
            balance,
            num_followers,
            ..
        } = filter;
        self.age_days >= *age_days
            && (self.safe || !*safe)
            && self.balance >= *balance
            && self.num_followers >= *num_followers
    }
}

#[derive(Default, Debug, Serialize, Deserialize, PartialEq)]
pub enum Mode {
    #[default]
    Mining,
    Rewards,
    Credits,
}

#[derive(Serialize, Deserialize)]
pub struct User {
    pub id: UserId,
    pub name: String,
    pub num_posts: usize,
    pub bookmarks: VecDeque<PostId>,
    pub about: String,
    pub account: String,
    pub settings: BTreeMap<String, String>,
    pub cold_wallet: Option<Principal>,
    cycles: Credits,
    pub rewards: i64,
    pub feeds: Vec<Vec<String>>,
    pub followees: BTreeSet<UserId>,
    pub followers: BTreeSet<UserId>,
    pub timestamp: u64,
    messages: u64,
    pub last_activity: u64,
    pub stalwart: bool,
    pub controllers: Vec<String>,
    pub invited_by: Option<UserId>,
    pub accounting: VecDeque<(Time, String, i64, String)>,
    pub realms: Vec<RealmId>,
    pub balance: Token,
    pub cold_balance: Token,
    pub active_weeks: u32,
    pub principal: Principal,
    pub report: Option<Report>,
    pub post_reports: BTreeMap<PostId, Time>,
    pub blacklist: BTreeSet<UserId>,
    pub treasury_e8s: u64,
    #[serde(skip)]
    pub draft: Option<Draft>,
    pub filters: Filters,
    pub previous_names: Vec<String>,
    pub governance: bool,
    pub notifications: BTreeMap<u64, (Notification, bool)>,
    pub show_posts_in_realms: bool,
    pub posts: Vec<PostId>,
    pub controlled_realms: HashSet<RealmId>,
    pub mode: Mode,
    // Amount of credits burned per week; used for the random rewards only.
    credits_burned: Credits,
    pub pfp: Pfp,
    #[serde(default)]
    pub deactivated: bool,
    #[serde(default)]
    wallet_tokens: HashSet<CanisterId>,
}

impl User {
    pub fn deactivate(&mut self) {
        self.active_weeks = 0;
        self.notifications.clear();
        self.accounting.clear();
        self.draft.take();
    }

    pub fn should_see(&self, state: &State, realm: Option<&RealmId>, post: &Post) -> bool {
        !post.matches_filters(realm, &self.filters)
            && state
                .users
                .get(&post.user)
                .map(|author| self.accepts(post.user, &author.get_filter()))
                .unwrap_or(true)
    }

    pub fn accepts(&self, user_id: UserId, filter: &UserFilter) -> bool {
        !self.blacklist.contains(&user_id)
            && !self.filters.users.contains(&user_id)
            && (self.followees.contains(&user_id) || filter.passes(&self.filters.noise))
    }

    pub fn account_age(&self, units: u64) -> u64 {
        (time() - self.timestamp) / units
    }

    pub fn get_filter(&self) -> UserFilter {
        UserFilter {
            age_days: self.account_age(DAY),
            safe: !self.controversial(),
            balance: self.total_balance() / token::base(),
            num_followers: self.followers.len(),
        }
    }

    pub fn controversial(&self) -> bool {
        self.post_reports
            .values()
            .any(|timestamp| timestamp + CONFIG.user_report_validity_days * DAY >= time())
            || self
                .report
                .as_ref()
                .map(|report| report.recently_confirmed())
                .unwrap_or_default()
    }

    pub fn new(principal: Principal, id: UserId, timestamp: u64, name: String) -> Self {
        Self {
            id,
            name,
            about: Default::default(),
            report: None,
            post_reports: Default::default(),
            blacklist: Default::default(),
            posts: Default::default(),
            account: AccountIdentifier::new(&principal, &DEFAULT_SUBACCOUNT).to_string(),
            settings: Default::default(),
            cycles: 0,
            credits_burned: 0,
            timestamp,
            num_posts: 0,
            bookmarks: Default::default(),
            feeds: Default::default(),
            followees: vec![id].into_iter().collect(),
            followers: Default::default(),
            accounting: Default::default(),
            controllers: Default::default(),
            controlled_realms: Default::default(),
            last_activity: timestamp,
            stalwart: false,
            invited_by: None,
            realms: Default::default(),
            messages: 0,
            notifications: Default::default(),
            balance: 0,
            active_weeks: 0,
            principal,
            treasury_e8s: 0,
            draft: None,
            filters: Default::default(),
            previous_names: Default::default(),
            rewards: 0,
            cold_wallet: None,
            cold_balance: 0,
            governance: true,
            show_posts_in_realms: true,
            mode: Mode::default(),
            pfp: Default::default(),
            deactivated: false,
            wallet_tokens: Default::default(),
        }
    }

    pub fn total_balance(&self) -> Token {
        self.balance + self.cold_balance
    }

    /// Returns all posts of the user.
    /// If no domain is specified (e.g. for excess penalty computations), return all
    /// posts without restrictions. Otherwise, return a filter corresponding to thedomain config.
    pub fn posts<'a>(
        &'a self,
        domain: Option<&String>,
        state: &'a State,
        offset: PostId,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let filter = match domain {
            None => Box::new(|_: &Post| true),
            Some(domain) => match domain_realm_post_filter(state, domain, None) {
                Some(filter) => filter,
                None => return Box::new(std::iter::empty()),
            },
        };

        Box::new(
            self.posts
                .iter()
                .rev()
                .skip_while(move |post_id| offset > 0 && post_id > &&offset)
                .filter_map(move |post_id| Post::get(state, post_id))
                .filter(move |post| filter(post) && (with_comments || post.parent.is_none())),
        )
    }

    pub fn toggle_bookmark(&mut self, post_id: PostId) -> bool {
        if self.bookmarks.contains(&post_id) {
            self.bookmarks.retain(|id| id != &post_id);
            return false;
        }
        self.bookmarks.push_front(post_id);
        self.notify_about_post("Added to your bookmarks", post_id);
        true
    }

    pub fn toggle_blacklist(&mut self, user_id: UserId) {
        if self.blacklist.contains(&user_id) {
            self.blacklist.remove(&user_id);
        } else {
            self.blacklist.insert(user_id);
        }
    }

    pub fn toggle_filter(&mut self, filter: String, mut value: String) -> Result<(), String> {
        value = value.trim().to_lowercase();
        match filter.as_str() {
            "user" => match value.parse() {
                Err(_) => Err("cannot parse user id".to_string()),
                Ok(id) => {
                    if !self.filters.users.remove(&id) {
                        self.filters.users.insert(id);
                        self.followees.remove(&id);
                    }
                    Ok(())
                }
            },
            "tag" => {
                if !self.filters.tags.remove(&value) {
                    self.filters.tags.insert(value.to_lowercase());
                    self.feeds.retain(|feed| !feed.contains(&value));
                }
                Ok(())
            }
            "realm" => {
                if !self.filters.realms.remove(&value) {
                    self.filters.realms.insert(value);
                }
                Ok(())
            }
            _ => Err("filter unknown".into()),
        }
    }

    /// Returns `true` if the user was active within the last `n` time units (days, weeks, etc).
    pub fn active_within(&self, n: u64, time_units: u64, now: u64) -> bool {
        self.last_activity + n * time_units > now
    }

    pub fn valid_info(
        about: &str,
        principals: &[String],
        settings: &BTreeMap<String, String>,
    ) -> bool {
        about.len()
            + settings
                .keys()
                .chain(settings.values())
                .map(|v| v.len())
                .sum::<usize>()
            + principals.iter().map(|v| v.len()).sum::<usize>()
            < CONFIG.max_user_info_length
    }

    fn insert_notifications(&mut self, notification: Notification) {
        if self.is_bot() {
            return;
        }
        self.messages += 1;
        self.notifications
            .insert(self.messages, (notification, false));
        while self.notifications.len() > 100 {
            self.notifications.pop_first();
        }
    }

    pub fn clear_notifications(&mut self, mut ids: Vec<u64>) {
        if ids.is_empty() {
            ids = self.notifications.keys().cloned().collect();
        }
        ids.into_iter().for_each(|id| {
            if let Some((_, read)) = self.notifications.get_mut(&id) {
                *read = true
            };
        });
    }

    pub fn toggle_following_feed(&mut self, tags: &[String]) -> bool {
        if tags.iter().any(|t| t.len() > 50) {
            return false;
        }

        let tags = tags.iter().map(|tag| tag.to_lowercase()).collect();
        if let Some(i) = covered_by_feeds(&self.feeds, &tags, true) {
            self.feeds.remove(i);
            return false;
        }
        if let Some(tag) = tags.first() {
            self.filters.tags.remove(tag);
        }
        self.feeds.push(tags.into_iter().collect());
        true
    }

    pub fn personal_feed<'a>(
        &'a self,
        domain: String,
        state: &'a State,
        offset: PostId,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let mut iterators: Vec<Box<dyn Iterator<Item = &'a Post> + 'a>> = self
            .followees
            .iter()
            .filter_map(move |id| state.users.get(id))
            .map(|user| user.posts(Some(&domain), state, 0, false))
            .collect();

        for feed in self.feeds.iter() {
            iterators.push(state.posts_by_tags_and_users(&domain, None, offset, feed, false))
        }

        Box::new(
            IteratorMerger::new(MergeStrategy::Or, iterators.into_iter().collect()).filter(
                move |post| {
                    self.should_see(state, None, post)
                        && post
                            .realm
                            .as_ref()
                            .map(|realm_id| {
                                // We only show posts from followees in realms the user is not a
                                // member of if the corresponding setting is enabled.
                                self.show_posts_in_realms || self.realms.contains(realm_id)
                            })
                            .unwrap_or(true)
                },
            ),
        )
    }

    pub fn notify_with_params<T: AsRef<str>>(&mut self, message: T, predicate: Option<Predicate>) {
        self.insert_notifications(match predicate {
            None => Notification::Generic(message.as_ref().into()),
            Some(predicate) => Notification::Conditional(message.as_ref().into(), predicate),
        });
    }

    pub fn notify<T: AsRef<str>>(&mut self, message: T) {
        self.notify_with_params(message, None)
    }

    pub fn notify_about_post<T: AsRef<str>>(&mut self, message: T, post_id: PostId) {
        self.insert_notifications(Notification::NewPost(message.as_ref().into(), post_id));
    }

    pub fn notify_about_watched_post(&mut self, post_id: PostId, comment: PostId, parent: PostId) {
        let entry = self
            .notifications
            .iter()
            .find(|(_, notification)| {
                matches!(notification, (Notification::WatchedPostEntries(id, _), false)
                        if id == &post_id)
            })
            .map(|(a, b)| (*a, b.clone()));
        let notification = entry
            .map(|(existing_id, mut notification)| {
                self.notifications.remove(&existing_id);
                if let Notification::WatchedPostEntries(_, entries) = &mut notification.0 {
                    entries.retain(|id| *id != parent);
                    entries.push(comment);
                }
                notification.0
            })
            .unwrap_or_else(|| Notification::WatchedPostEntries(post_id, vec![comment]));
        self.insert_notifications(notification);
    }

    pub fn is_bot(&self) -> bool {
        self.controllers.iter().any(|p| p.len() == 27)
    }

    pub fn change_credits<T: ToString>(
        &mut self,
        amount: Credits,
        delta: CreditsDelta,
        log: T,
    ) -> Result<(), String> {
        if delta == CreditsDelta::Minus && amount > self.cycles {
            return Err(format!("not enough credits (required: {amount})"));
        }

        if delta == CreditsDelta::Plus {
            self.cycles = self
                .cycles
                .checked_add(amount)
                .ok_or("wrong positive delta amount")?;
        } else {
            self.cycles = self
                .cycles
                .checked_sub(amount)
                .ok_or("wrong negative delta amount")?;
        }

        self.add_accounting_log(
            time(),
            "CRE".to_string(),
            if delta == CreditsDelta::Plus {
                amount as i64
            } else {
                -(amount as i64)
            },
            log.to_string(),
        );

        Ok(())
    }

    pub fn change_rewards<T: ToString>(&mut self, amount: i64, log: T) {
        // The top up only works if the rewards balance is non-negative
        if self.mode == Mode::Credits && self.rewards() >= 0 && amount > 0 {
            self.change_credits(amount.unsigned_abs(), CreditsDelta::Plus, log)
                .expect("couldn't change credits");
            return;
        }
        self.rewards = self.rewards.saturating_add(amount);
        self.add_accounting_log(time(), "RWD".to_string(), amount, log.to_string());
    }

    fn add_accounting_log(&mut self, time: Time, level: String, amount: i64, log: String) {
        self.accounting.push_front((time, level, amount, log));
        while self.accounting.len() > 100 {
            self.accounting.pop_back();
        }
    }

    pub fn rewards(&self) -> i64 {
        self.rewards
    }

    pub fn take_positive_rewards(&mut self) -> i64 {
        if self.rewards > 0 {
            std::mem::take(&mut self.rewards)
        } else {
            0
        }
    }

    pub fn credits(&self) -> Credits {
        self.cycles
    }

    pub fn credits_burned(&self) -> Credits {
        self.credits_burned
    }

    pub fn add_burned_credits(&mut self, delta: Credits) {
        self.credits_burned += delta
    }

    pub fn take_credits_burned(&mut self) -> Credits {
        std::mem::take(&mut self.credits_burned)
    }

    pub fn top_up_credits_from_revenue(
        &mut self,
        revenue: &mut u64,
        e8s_for_one_xdr: u64,
    ) -> Result<(), String> {
        let credits_needed = CONFIG.credits_per_xdr.saturating_sub(self.credits());
        if *revenue > 0 && credits_needed > 0 {
            let e8s_needed = credits_needed * e8s_for_one_xdr / CONFIG.credits_per_xdr;
            let top_up_e8s = e8s_needed.min(*revenue);
            let credits =
                top_up_e8s as f32 / e8s_for_one_xdr as f32 * CONFIG.credits_per_xdr as f32;
            *revenue = (*revenue).saturating_sub(top_up_e8s);
            self.change_credits(
                credits as Credits,
                CreditsDelta::Plus,
                "credits top-up from revenue",
            )?;
        }
        Ok(())
    }

    pub fn update_settings(
        caller: Principal,
        settings: BTreeMap<String, String>,
    ) -> Result<(), String> {
        mutate(|state| {
            if let Some(user) = state.principal_to_user_mut(caller) {
                if !User::valid_info(&user.about, &[], &settings) {
                    return Err("inputs too long".to_string());
                }
                user.settings = settings;
            }
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update(
        caller: Principal,
        new_name: Option<String>,
        about: String,
        principals: Vec<String>,
        filter: UserFilter,
        governance: bool,
        mode: Mode,
        show_posts_in_realms: bool,
        mut pfp: Pfp,
    ) -> Result<(), String> {
        if read(|state| {
            state
                .users
                .values()
                .filter(|user| user.principal != caller)
                .flat_map(|user| user.controllers.iter())
                .collect::<BTreeSet<_>>()
                .intersection(&principals.iter().collect())
                .count()
        }) > 0
        {
            return Err("controller already assigned to another user".into());
        }

        mutate(|state| {
            let user = state.principal_to_user(caller).ok_or("user not found")?;
            if !User::valid_info(&about, &principals, &user.settings) {
                return Err("inputs too long".to_string());
            }
            let user_id = user.id;
            let current_name = user.name.clone();
            let current_pfp = user.pfp.clone();
            if let Some(name) = &new_name {
                state.validate_username(name)?;
                state.charge(user_id, CONFIG.identity_change_cost, "name change")?;
                state
                    .logger
                    .info(format!("@{} changed name to @{} 🪪", current_name, name));
            }
            let pfp_changhed = current_pfp != pfp;
            if pfp_changhed {
                if !current_pfp.genesis {
                    state.charge(user_id, CONFIG.identity_change_cost, "avataggr change")?;
                }
                pfp.genesis = false;
            }
            let Some(user) = state.principal_to_user_mut(caller) else {
                return Err("no user found".into());
            };
            if user.rewards() > 0 && mode == Mode::Credits {
                return Err("switching to the credits mode is only possible when a user has no pending rewards".into());
            }
            user.about = about;
            user.controllers = principals;
            user.governance = governance;
            user.mode = mode;
            user.filters.noise = filter;
            user.show_posts_in_realms = show_posts_in_realms;
            if let Some(name) = new_name {
                user.previous_names.push(user.name.clone());
                user.name = name;
            }
            if pfp_changhed {
                state.set_pfp(user_id, pfp)?;
            }
            Ok(())
        })
    }

    /// Protect against stealing credits from invites: all accounts younger than 30 days,
    /// cannot send more credits than they have burned in a week.
    pub fn validate_send_credits(&self, state: &State) -> Result<(), String> {
        if self.account_age(DAY) > 30 {
            return Ok(());
        }

        let Some(invited_by) = self.invited_by else {
            return Ok(());
        };

        let Some(invite) = state.invite_codes.values().find(|invite| {
            invited_by == invite.inviter_user_id && invite.joined_user_ids.contains(&self.id)
        }) else {
            return Ok(());
        };

        if self.credits_burned() < invite.credits_per_user {
            return Err("you are not allowed to send credits acquired in an invite".into());
        }

        Ok(())
    }

    pub fn update_wallet_tokens(caller: Principal, ids: HashSet<CanisterId>) -> Result<(), String> {
        if ids.len() > 50 {
            return Err("too many tokens".into());
        }
        mutate(|state| {
            if let Some(user) = state.principal_to_user_mut(caller) {
                user.wallet_tokens = ids;
            }
        });
        Ok(())
    }
}

pub async fn create_user(
    principal: Principal,
    name: String,
    invite_code: Option<String>,
) -> Result<Option<RealmId>, String> {
    // Validations.
    read(|state| {
        state.validate_username(&name)?;
        if let Some(user) = state.principal_to_user(principal) {
            return Err(format!("principal already assigned to user @{}", user.name));
        }
        Ok(())
    })?;

    if let Some(code) = invite_code {
        return create_user_from_invite(principal, name, code);
    }

    let (paid_icp_invoice, paid_btc_invoice) = read(|state| {
        (
            state.accounting.has_paid_icp_invoice(&principal),
            state.accounting.has_paid_btc_invoice(&principal),
        )
    });

    if !paid_icp_invoice && !paid_btc_invoice {
        return Err("payment missing".to_string());
    }

    mutate(|state| state.new_user(principal, time(), name, None))?;

    // After the user has beed created, transfer credits.
    if paid_icp_invoice {
        State::mint_credits_with_icp(principal, 0)
            .await
            .map(|_| (None))
    } else {
        State::mint_credits_with_btc(principal)
            .await
            .map(|_| (None))
    }
}

fn create_user_from_invite(
    principal: Principal,
    name: String,
    code: String,
) -> Result<Option<RealmId>, String> {
    mutate(|state| {
        let Invite {
            credits,
            credits_per_user,
            inviter_user_id,
            realm_id,
            ..
        } = state
            .invite_codes
            .get(&code)
            .cloned()
            .ok_or("invite not found")?;

        if credits < credits_per_user {
            return Err("invite has not enough credits".to_string());
        }

        let inviter = state
            .users
            .get_mut(&inviter_user_id)
            .ok_or("user not found")?;

        if inviter.credits() < credits_per_user {
            return Err("inviter has not enough credits".into());
        }

        let new_user_id = state.new_user(principal, time(), name.clone(), None)?;

        state
            .invite_codes
            .get_mut(&code)
            .expect("invite not found") // Revert newly created user in an edge case
            .consume(new_user_id)?;

        state
            .credit_transfer(
                inviter_user_id,
                new_user_id,
                credits_per_user,
                0,
                Destination::Credits,
                "claimed by invited user",
                None,
            )
            .unwrap_or_else(|err| panic!("couldn't use the invite: {}", err));

        if let Some(id) = realm_id.clone() {
            state.toggle_realm_membership(principal, id);
        }

        let user = state.users.get_mut(&new_user_id).expect("user not found");
        user.invited_by = Some(inviter_user_id);
        let inviter = state
            .users
            .get_mut(&inviter_user_id)
            .expect("user not found");
        inviter.notify(format!(
            "Your invite was used by @{}! Thanks for helping #{} grow! 🤗",
            name, CONFIG.name
        ));

        Ok(realm_id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        env::{invite::tests::create_invite_with_realm, tests::pr},
        tests::create_user,
    };

    #[test]
    fn test_validate_send_credits() {
        mutate(|state| {
            let (inviter_id, code, _) = create_invite_with_realm(state, pr(6));
            create_user(state, pr(7));
            state.principal_to_user_mut(pr(7)).unwrap().invited_by = Some(inviter_id);
            let user_id = state.principal_to_user(pr(7)).unwrap().id;
            let invite = state.invite_codes.get_mut(&code).expect("invite not found");
            assert_eq!(invite.consume(user_id), Ok(()));
            let user = state.principal_to_user(pr(7)).unwrap();
            let error = "you are not allowed to send credits acquired in an invite".into();
            assert_eq!(user.validate_send_credits(state), Err(error));

            // Make user burn enough credits
            state
                .principal_to_user_mut(pr(7))
                .unwrap()
                .add_burned_credits(1000);
            let user = state.principal_to_user(pr(7)).unwrap();
            assert_eq!(user.validate_send_credits(state), Ok(()));
        });
    }

    #[test]
    fn test_user_filters() {
        let user = User::new(pr(0), 0, 0, "test".into());
        assert!(user.get_filter().passes(&UserFilter::default()));

        assert!(!UserFilter {
            age_days: 12,
            safe: false,
            balance: 333,
            num_followers: 34,
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: true,
            balance: 1,
            num_followers: 0
        }));

        assert!(UserFilter {
            age_days: 12,
            safe: false,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            balance: 1,
            num_followers: 0
        }));

        assert!(UserFilter {
            age_days: 12,
            safe: true,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: true,
            balance: 1,
            num_followers: 0
        }));

        assert!(!UserFilter {
            age_days: 12,
            safe: true,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            balance: 777,
            num_followers: 0
        }));

        assert!(UserFilter {
            age_days: 12,
            safe: true,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            balance: 1,
            num_followers: 0
        }));

        assert!(!UserFilter {
            age_days: 12,
            safe: true,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            balance: 1,
            num_followers: 35
        }));
    }

    #[test]
    fn test_automatic_top_up() {
        let mut user = User::new(pr(0), 66, 0, Default::default());
        user.mode = Mode::Credits;
        let e8s_for_one_xdr = 3095_0000;

        // simple top up
        user.cycles = 1000;
        user.change_rewards(30, "");
        assert_eq!(user.cycles, 1030);

        // decrease in rewards does not remove credits, but creates a "debt"
        user.change_rewards(-30, "");
        assert_eq!(user.cycles, 1030);
        assert_eq!(user.rewards(), -30);
        user.change_rewards(35, "");
        assert_eq!(user.cycles, 1030);
        assert_eq!(user.rewards(), 5);

        // Chraging credits works as before
        user.change_credits(30, CreditsDelta::Minus, "").unwrap();
        assert_eq!(user.cycles, 1000);

        let mut revenue = 2000_0000;
        user.top_up_credits_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 2000_0000);
        assert_eq!(user.credits(), 1000);

        // rewards are enough
        user.cycles = 980;
        user.rewards = 30;
        user.change_rewards(30, "");
        let mut revenue = 2000_0000;
        user.top_up_credits_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 2000_0000);
        assert_eq!(user.credits(), 1010);

        // rewards are still enough
        user.cycles = 0;
        user.rewards = 3000;
        user.change_rewards(1010, "");
        let mut revenue = 2000_0000;
        user.top_up_credits_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 2000_0000);
        assert_eq!(user.credits(), 1010);

        // rewards are not enough
        user.cycles = 0;
        user.rewards = 500;
        let mut revenue = 2000_0000;
        user.top_up_credits_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 0);
        assert_eq!(user.credits(), 646);
    }

    #[test]
    fn test_change_credits() {
        let mut u = User::new(pr(1), 66, 0, Default::default());
        u.cycles = 100;
        assert!(u.change_credits(55, CreditsDelta::Plus, "").is_ok());
        assert_eq!(u.credits(), 155);
        assert_eq!(u.credits_burned(), 0);
        assert!(u.change_credits(156, CreditsDelta::Minus, "").is_err());
        assert!(u.change_credits(155, CreditsDelta::Minus, "").is_ok());
        assert_eq!(u.take_credits_burned(), 0);
        assert_eq!(u.credits(), 0);
    }

    #[test]
    fn test_update_weallet_tokens() {
        User::new(pr(2), 66, 0, Default::default());
        assert!(User::update_wallet_tokens(pr(1), vec![pr(2)].into_iter().collect()).is_ok());

        // More than 250 caniters
        let canisters = (0..251).map(pr).collect();
        assert_eq!(
            User::update_wallet_tokens(pr(1), canisters),
            Err("too many tokens".into())
        );
    }
}
