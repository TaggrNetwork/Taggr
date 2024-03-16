use super::{reports::Report, *};
use ic_ledger_types::{AccountIdentifier, DEFAULT_SUBACCOUNT};
use serde::{Deserialize, Serialize};

pub type UserId = u64;

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
    downvotes: usize,
}

impl UserFilter {
    pub fn passes(&self, filter: &UserFilter) -> bool {
        let UserFilter {
            age_days,
            safe,
            balance,
            num_followers,
            downvotes,
        } = filter;
        (*downvotes == 0 || self.downvotes <= *downvotes)
            && self.age_days >= *age_days
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
    rewards: i64,
    pub feeds: Vec<BTreeSet<String>>,
    pub followees: BTreeSet<UserId>,
    pub followers: BTreeSet<UserId>,
    pub timestamp: u64,
    messages: u64,
    pub last_activity: u64,
    pub stalwart: bool,
    pub controllers: Vec<String>,
    pub invited_by: Option<UserId>,
    pub accounting: VecDeque<(Time, String, i64, String)>,
    pub realms: Vec<String>,
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
    pub karma_donations: BTreeMap<UserId, Credits>,
    pub previous_names: Vec<String>,
    pub governance: bool,
    pub notifications: BTreeMap<u64, (Notification, bool)>,
    pub downvotes: BTreeMap<UserId, Time>,
    pub show_posts_in_realms: bool,
    pub posts: Vec<PostId>,
    // TODO: delete
    pub miner: bool,
    pub controlled_realms: HashSet<RealmId>,
    #[serde(default)]
    pub mode: Mode,
}

impl User {
    pub fn deactivate(&mut self) {
        self.active_weeks = 0;
        self.notifications.clear();
        self.accounting.clear();
        self.draft.take();
    }

    pub fn accepts(&self, user_id: UserId, filter: &UserFilter) -> bool {
        !self.blacklist.contains(&user_id)
            && !self.filters.users.contains(&user_id)
            && (self.followees.contains(&user_id) || filter.passes(&self.filters.noise))
    }

    pub fn get_filter(&self) -> UserFilter {
        UserFilter {
            age_days: (time() - self.timestamp) / DAY,
            safe: !self.controversial(),
            balance: self.total_balance() / token::base(),
            num_followers: self.followers.len(),
            downvotes: self.downvotes.len(),
        }
    }

    pub fn controversial(&self) -> bool {
        self.rewards < 0
            || self
                .post_reports
                .values()
                .any(|timestamp| timestamp + CONFIG.user_report_validity_days * DAY >= time())
            || self
                .report
                .as_ref()
                .map(|report| report.pending_or_recently_confirmed())
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
            karma_donations: Default::default(),
            previous_names: Default::default(),
            rewards: 0,
            cold_wallet: None,
            cold_balance: 0,
            governance: true,
            miner: true,
            downvotes: Default::default(),
            show_posts_in_realms: true,
            mode: Mode::default(),
        }
    }

    pub fn total_balance(&self) -> Token {
        self.balance + self.cold_balance
    }

    pub fn posts<'a>(
        &'a self,
        state: &'a State,
        offset: PostId,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        Box::new(
            self.posts
                .iter()
                .rev()
                .skip_while(move |post_id| offset > 0 && post_id > &&offset)
                .filter_map(move |post_id| Post::get(state, post_id))
                .filter(move |post| with_comments || post.parent.is_none()),
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

    pub fn toggle_filter(&mut self, filter: String, value: String) -> Result<(), String> {
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
                    self.filters.tags.insert(value.clone());
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

    pub fn active_within_weeks(&self, now: u64, n: u64) -> bool {
        self.last_activity + n * WEEK > now
    }

    pub fn valid_info(about: &str, settings: &BTreeMap<String, String>) -> bool {
        about.len()
            + settings
                .keys()
                .chain(settings.values())
                .map(|v| v.len())
                .sum::<usize>()
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

    pub fn toggle_following_feed(&mut self, tags: Vec<String>) -> bool {
        let tags = tags.into_iter().map(|tag| tag.to_lowercase()).collect();
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
        state: &'a State,
        page: usize,
        offset: PostId,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        Box::new(
            state
                .last_posts(None, offset, self.timestamp, false)
                .filter(move |post| {
                    !post.matches_filters(&self.filters)
                        && post
                            .realm
                            .as_ref()
                            .map(|realm_id| {
                                self.show_posts_in_realms || self.realms.contains(realm_id)
                            })
                            .unwrap_or(true)
                })
                .filter(move |post| {
                    if self.followees.contains(&post.user) {
                        return true;
                    }
                    let lc_tags: BTreeSet<_> = post.tags.iter().map(|t| t.to_lowercase()).collect();
                    covered_by_feeds(&self.feeds, &lc_tags, false).is_some()
                })
                .skip(page * CONFIG.feed_page_size)
                .take(CONFIG.feed_page_size),
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
        if delta == CreditsDelta::Minus && amount <= self.cycles || delta == CreditsDelta::Plus {
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
            return Ok(());
        }
        Err("not enough credits".into())
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
                if !User::valid_info(&user.about, &settings) {
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
        clear_avatar: bool,
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
            if !User::valid_info(&about, &user.settings) {
                return Err("inputs too long".to_string());
            }
            let user_id = user.id;
            let old_name = user.name.clone();
            if clear_avatar {
                let _ = state.memory.avatars.remove(&user_id);
            }
            if let Some(name) = &new_name {
                state.validate_username(name)?;
                state.charge(user_id, CONFIG.name_change_cost, "name change")?;
                state
                    .logger
                    .info(format!("@{} changed name to @{} 🪪", old_name, name));
            }
            if let Some(user) = state.principal_to_user_mut(caller) {
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
                Ok(())
            } else {
                Err("no user found".into())
            }
        })
    }

    pub fn eligible_for_minting(&self) -> bool {
        self.mode == Mode::Mining && !self.controversial() &&
            // While `controversial` covers users with negative rewards, user with 0 rewards should
            // not be picked for minting because they either have no rewards, or they were
            // downvoted back to zero and then nothing should be minted for them.
            self.rewards() > 0
    }

    pub fn mintable_tokens(
        &self,
        state: &State,
        user_shares: u64,
        boostraping_mode: bool,
    ) -> Box<dyn Iterator<Item = (UserId, Token)> + '_> {
        if self.controversial() {
            return Box::new(std::iter::empty());
        }
        let ratio = state.minting_ratio();
        let base = token::base();
        let karma_donated_total: Credits = self.karma_donations.values().sum();
        // we can donate only min(balance/ratio, donated_karma/ratio);
        let donated_karma = karma_donated_total * base;
        let spendable_tokens = if boostraping_mode {
            // During the bootstrap period, use karma and not balances
            donated_karma
        } else {
            let minting_power = state
                .minting_power
                .get(&self.principal)
                .copied()
                .unwrap_or_default();
            self.total_balance()
                .min(minting_power)
                .min(donated_karma)
                .min(CONFIG.max_spendable_tokens)
        } / ratio;
        let spendable_tokens_per_user = spendable_tokens / user_shares;

        let priority_factor = |user_id| {
            let balance = state
                .users
                .get(&user_id)
                .map(|user| user.total_balance())
                .unwrap_or_default()
                / base;
            if balance <= 100 {
                1.2
            } else if balance <= 250 {
                1.15
            } else if balance <= 500 {
                1.1
            } else {
                1.0
            }
        };

        let shares = self
            .karma_donations
            .iter()
            .map(|(user_id, karma_donated)| {
                (
                    *user_id,
                    (*karma_donated as f32 / karma_donated_total as f32
                        * priority_factor(*user_id)
                        * 100.0_f32) as u64,
                )
            })
            .collect::<Vec<_>>();

        let total = shares.iter().map(|(_, share)| share).sum::<u64>();

        Box::new(
            shares
                .into_iter()
                .map(move |(user_id, share)| {
                    (
                        user_id,
                        spendable_tokens_per_user
                            .min((share as f32 / total as f32 * spendable_tokens as f32) as Token),
                    )
                })
                .filter(|(_, balance)| balance > &0),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::tests::pr;
    use crate::tests::{create_user, insert_balance};

    #[test]
    fn test_user_filters() {
        let user = User::new(pr(0), 0, 0, "test".into());
        assert!(user.get_filter().passes(&UserFilter::default()));

        assert!(!UserFilter {
            age_days: 12,
            safe: false,
            balance: 333,
            num_followers: 34,
            downvotes: 0,
        }
        .passes(&UserFilter {
            age_days: 7,
            downvotes: 0,
            safe: true,
            balance: 1,
            num_followers: 0
        }));

        assert!(UserFilter {
            age_days: 12,
            downvotes: 0,
            safe: false,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            downvotes: 0,
            balance: 1,
            num_followers: 0
        }));

        assert!(UserFilter {
            age_days: 12,
            downvotes: 0,
            safe: true,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: true,
            downvotes: 0,
            balance: 1,
            num_followers: 0
        }));

        assert!(!UserFilter {
            age_days: 12,
            safe: true,
            downvotes: 0,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            downvotes: 0,
            balance: 777,
            num_followers: 0
        }));

        assert!(UserFilter {
            age_days: 12,
            safe: true,
            downvotes: 0,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            downvotes: 0,
            balance: 1,
            num_followers: 0
        }));

        assert!(!UserFilter {
            age_days: 12,
            safe: true,
            downvotes: 7,
            balance: 333,
            num_followers: 34
        }
        .passes(&UserFilter {
            age_days: 7,
            safe: false,
            downvotes: 5,
            balance: 1,
            num_followers: 0
        }));
    }

    #[test]
    fn test_minted_tokens_cap() {
        let state = &mut State::default();
        let donor_id = create_user(state, pr(0));
        let u1 = create_user(state, pr(1));
        let u2 = create_user(state, pr(2));
        let u3 = create_user(state, pr(3));
        insert_balance(state, pr(0), 6000); // spendable tokens
        assert_eq!(state.minting_ratio(), 1);

        let donor = state.users.get_mut(&donor_id).unwrap();
        donor.karma_donations.insert(u1, 330);
        donor.karma_donations.insert(u2, 660);
        donor.karma_donations.insert(u3, 990);
        // Donate
        let mintable_tokens = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();
        assert_eq!(mintable_tokens.len(), 3);

        let donor = state.users.get_mut(&donor_id).unwrap();

        // Assume the donor minted 6k tokens
        assert_eq!(state.minting_power.get(&pr(0)).unwrap(), &6000);

        // Simulate a tx to the cold wallet
        donor.balance -= 5500;
        donor.cold_balance += 5500;

        // Ensure we mint as many tokens as before
        assert_eq!(
            mintable_tokens,
            state
                .users
                .get(&donor_id)
                .unwrap()
                .mintable_tokens(state, 1, false)
                .collect::<BTreeMap<_, _>>()
        );

        // Simulate an outflow of 50% from the cold wallet
        let donor = state.users.get_mut(&donor_id).unwrap();
        donor.cold_balance -= 3000;
        let mintable_tokens_after_outflow = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();

        // Rewards have halved
        for id in &[u1, u2, u3] {
            assert_eq!(
                *mintable_tokens.get(id).unwrap(),
                mintable_tokens_after_outflow.get(id).unwrap() * 2,
            );
        }

        // Simulate an inflow of 100%
        let donor = state.users.get_mut(&donor_id).unwrap();
        donor.balance += 6000;
        let mintable_tokens_after_inflow = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();

        // Rewards are back to the minting levels, but not more!
        for id in &[u1, u2, u3] {
            assert_eq!(
                mintable_tokens.get(id).unwrap(),
                mintable_tokens_after_inflow.get(id).unwrap(),
            );
        }

        // Simulate an outflow from all wallets
        let donor = state.users.get_mut(&donor_id).unwrap();
        donor.balance = 0;
        donor.cold_balance = 0;
        let mintable_tokens_after_selloff = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();
        assert!(mintable_tokens_after_selloff.is_empty());

        // Simulate an inflow of 10% of the original minted balance
        let donor = state.users.get_mut(&donor_id).unwrap();
        assert_eq!(donor.balance, 0);
        assert_eq!(donor.cold_balance, 0);
        donor.balance += 600;
        let mintable_tokens_after_buyback = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();

        // Rewards are back to the minting levels, but not more!
        for id in &[u1, u2, u3] {
            assert_eq!(
                mintable_tokens.get(id).unwrap() / 10,
                *mintable_tokens_after_buyback.get(id).unwrap(),
            );
        }
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
    // check that we cannot donate more tokens than rewards / ratio even if the balance would allow
    fn test_mintable_tokens_with_balance_higher_than_karma() {
        let state = &mut State::default();
        let donor_id = create_user(state, pr(0));
        let u1 = create_user(state, pr(1));
        let u2 = create_user(state, pr(2));
        let u3 = create_user(state, pr(3));
        let u4 = create_user(state, pr(4));
        insert_balance(state, pr(255), 20000000);
        insert_balance(state, pr(0), 600000); // spendable tokens
        insert_balance(state, pr(1), 9900);
        insert_balance(state, pr(2), 24900);
        insert_balance(state, pr(3), 49900);
        insert_balance(state, pr(4), 100000);
        assert_eq!(state.minting_ratio(), 4);
        let bob = state.users.get_mut(&donor_id).unwrap();

        bob.karma_donations.insert(u1, 330);
        bob.karma_donations.insert(u2, 660);
        bob.karma_donations.insert(u3, 990);
        bob.karma_donations.insert(u4, 1020);
        let mintable_tokens = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();
        assert_eq!(mintable_tokens.len(), 4);

        assert_eq!(mintable_tokens.get(&u1).unwrap(), &9027);
        assert_eq!(mintable_tokens.get(&u2).unwrap(), &17361);
        assert_eq!(mintable_tokens.get(&u3).unwrap(), &25000);
        assert_eq!(mintable_tokens.get(&u4).unwrap(), &23611);
        assert_eq!(
            mintable_tokens.values().sum::<u64>(),
            300000 / state.minting_ratio() - 1
        );

        // test the mintable tokens cap
        insert_balance(state, pr(0), 22000000);
        let bob = state.users.get_mut(&donor_id).unwrap();

        bob.karma_donations.clear();
        bob.karma_donations.insert(u1, 15000000);
        let mintable_tokens = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            mintable_tokens.get(&u1).unwrap(),
            &(12000000 / state.minting_ratio())
        );
    }

    #[test]
    // check that we cannot donate more tokens than balance / ratio even if donated rewards was high
    fn test_mintable_tokens_with_karma_higher_than_balance() {
        let state = &mut State::default();
        let donor_id = create_user(state, pr(0));
        let u1 = create_user(state, pr(1));
        let u2 = create_user(state, pr(2));
        let u3 = create_user(state, pr(3));
        let u4 = create_user(state, pr(4));
        insert_balance(state, pr(255), 20000000);
        insert_balance(state, pr(0), 60000); // spendable tokens
        insert_balance(state, pr(1), 9900);
        insert_balance(state, pr(2), 24900);
        insert_balance(state, pr(3), 49900);
        insert_balance(state, pr(4), 100000);
        assert_eq!(state.minting_ratio(), 4);
        let bob = state.users.get_mut(&donor_id).unwrap();

        bob.karma_donations.insert(u1, 330);
        bob.karma_donations.insert(u2, 660);
        bob.karma_donations.insert(u3, 990);
        bob.karma_donations.insert(u4, 1020);
        let mintable_tokens = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 1, false)
            .collect::<BTreeMap<_, _>>();
        assert_eq!(mintable_tokens.len(), 4);

        assert_eq!(mintable_tokens.get(&u1).unwrap(), &1805);
        assert_eq!(mintable_tokens.get(&u2).unwrap(), &3472);
        assert_eq!(mintable_tokens.get(&u3).unwrap(), &5000);
        assert_eq!(mintable_tokens.get(&u4).unwrap(), &4722);

        assert_eq!(
            mintable_tokens.values().sum::<u64>(),
            60000 / state.minting_ratio() - 1
        );
    }

    #[test]
    fn test_mintable_tokens_with_user_share() {
        let state = &mut State::default();
        let donor_id = create_user(state, pr(0));
        let u1 = create_user(state, pr(1));
        let u2 = create_user(state, pr(2));
        let u3 = create_user(state, pr(3));
        let u4 = create_user(state, pr(4));
        insert_balance(state, pr(255), 20000000);
        insert_balance(state, pr(0), 600000); // spendable tokens
        insert_balance(state, pr(1), 9900);
        insert_balance(state, pr(2), 24900);
        insert_balance(state, pr(3), 49900);
        insert_balance(state, pr(4), 100000);
        assert_eq!(state.minting_ratio(), 4);
        let bob = state.users.get_mut(&donor_id).unwrap();

        bob.karma_donations.insert(u1, 330);
        bob.karma_donations.insert(u2, 660);
        bob.karma_donations.insert(u3, 990);
        bob.karma_donations.insert(u4, 1020);
        let mintable_tokens = state
            .users
            .get(&donor_id)
            .unwrap()
            .mintable_tokens(state, 10, false)
            .collect::<BTreeMap<_, _>>();
        assert_eq!(mintable_tokens.len(), 4);

        assert_eq!(mintable_tokens.get(&u1).unwrap(), &7500);
        assert_eq!(mintable_tokens.get(&u2).unwrap(), &7500);
        assert_eq!(mintable_tokens.get(&u3).unwrap(), &7500);
        assert_eq!(mintable_tokens.get(&u4).unwrap(), &7500);
    }

    #[test]
    fn test_change_credits() {
        let mut u = User::new(pr(1), 66, 0, Default::default());
        u.cycles = 100;
        assert!(u.change_credits(55, CreditsDelta::Plus, "").is_ok());
        assert_eq!(u.credits(), 155);
        assert!(u.change_credits(156, CreditsDelta::Minus, "").is_err());
        assert!(u.change_credits(155, CreditsDelta::Minus, "").is_ok());
        assert_eq!(u.credits(), 0);
    }
}
