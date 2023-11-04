use super::{reports::Report, *};
use ic_ledger_types::AccountIdentifier;
use serde::{Deserialize, Serialize};

pub type UserId = u64;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Filters {
    pub users: BTreeSet<UserId>,
    pub tags: BTreeSet<String>,
    pub realms: BTreeSet<String>,
}

impl Filters {
    pub fn is_empty(&self) -> bool {
        self.users.is_empty() && self.tags.is_empty() && self.realms.is_empty()
    }
}

#[derive(PartialEq)]
pub enum CyclesDelta {
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
    WatchedPostEntries(Vec<u64>),
}

// This struct will hold user's new post until it's saved.
#[derive(Clone)]
pub struct Draft {
    pub body: String,
    pub realm: Option<String>,
    pub extension: Option<Blob>,
    pub blobs: Vec<(String, Blob)>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct User {
    pub id: UserId,
    pub name: String,
    #[serde(default)]
    pub num_posts: u64,
    pub bookmarks: VecDeque<PostId>,
    pub about: String,
    pub account: String,
    pub settings: String,
    karma: Karma,
    rewarded_karma: u64,
    cycles: Cycles,
    pub feeds: Vec<BTreeSet<String>>,
    pub followees: BTreeSet<UserId>,
    pub followers: BTreeSet<UserId>,
    pub timestamp: u64,
    pub inbox: HashMap<String, Notification>,
    messages: u64,
    pub last_activity: u64,
    pub stalwart: bool,
    pub controllers: Vec<String>,
    pub invited_by: Option<UserId>,
    pub accounting: VecDeque<(u64, String, i64, String)>,
    pub realms: Vec<String>,
    pub balance: Token,
    pub active_weeks: u32,
    pub principal: Principal,
    pub report: Option<Report>,
    pub karma_from_last_posts: BTreeMap<UserId, Karma>,
    pub treasury_e8s: u64,
    pub invites_budget: Cycles,
    #[serde(skip)]
    pub draft: Option<Draft>,
    pub filters: Filters,
    pub karma_donations: BTreeMap<UserId, u32>,
    #[serde(default)]
    pub previous_names: Vec<String>,
}

impl User {
    pub fn new(principal: Principal, id: UserId, timestamp: u64, name: String) -> Self {
        Self {
            id,
            name,
            about: Default::default(),
            report: None,
            account: AccountIdentifier::new(
                &super::id(),
                &invoices::principal_to_subaccount(&principal),
            )
            .to_string(),
            settings: Default::default(),
            cycles: 0,
            karma: 0,
            rewarded_karma: 0,
            timestamp,
            num_posts: 0,
            bookmarks: Default::default(),
            feeds: Default::default(),
            followees: Default::default(),
            followers: Default::default(),
            accounting: Default::default(),
            controllers: Default::default(),
            last_activity: timestamp,
            stalwart: false,
            invited_by: None,
            realms: Default::default(),
            messages: 0,
            inbox: Default::default(),
            balance: 0,
            active_weeks: 0,
            principal,
            karma_from_last_posts: Default::default(),
            treasury_e8s: 0,
            invites_budget: 0,
            draft: None,
            filters: Default::default(),
            karma_donations: Default::default(),
            previous_names: Default::default(),
        }
    }

    pub fn posts<'a>(&'a self, state: &'a State) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let id = self.id;
        Box::new(
            state
                .last_posts(Principal::anonymous(), None, true)
                .filter(move |post| post.user == id),
        )
    }

    pub fn toggle_bookmark(&mut self, post_id: PostId) -> bool {
        if self.bookmarks.contains(&post_id) {
            self.bookmarks.retain(|id| id != &post_id);
            return false;
        }
        self.bookmarks.push_front(post_id);
        true
    }

    pub fn toggle_filter(&mut self, filter: String, value: String) -> Result<(), String> {
        match filter.as_str() {
            "user" => match value.parse() {
                Err(_) => Err("cannot parse user id".to_string()),
                Ok(id) => {
                    if !self.filters.users.remove(&id) {
                        self.filters.users.insert(id);
                    }
                    Ok(())
                }
            },
            "tag" => {
                if !self.filters.tags.remove(&value) {
                    self.filters.tags.insert(value);
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

    pub fn trusted(&self) -> bool {
        self.karma >= CONFIG.trusted_user_min_karma
            && time().saturating_sub(self.timestamp) >= CONFIG.trusted_user_min_age_weeks * WEEK
    }

    pub fn valid_info(about: &str, settings: &str) -> bool {
        about.len() + settings.len() < CONFIG.max_user_info_length
    }

    pub fn clear_notifications(&mut self, ids: Vec<String>) {
        if ids.is_empty() {
            self.inbox = Default::default();
        } else {
            ids.into_iter().for_each(|id| {
                self.inbox.remove(&id);
            });
        }
    }

    pub fn toggle_following_feed(&mut self, tags: Vec<String>) -> bool {
        let tags = tags.into_iter().map(|tag| tag.to_lowercase()).collect();
        if let Some(i) = covered_by_feeds(&self.feeds, &tags, true) {
            self.feeds.remove(i);
            return false;
        }
        self.feeds.push(tags.into_iter().collect());
        true
    }

    pub fn personal_feed<'a>(
        &'a self,
        state: &'a State,
        page: usize,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let posts_by_tags = Box::new(
            state
                .last_posts(self.principal, None, with_comments)
                .filter(move |post| {
                    let lc_tags: BTreeSet<_> = post.tags.iter().map(|t| t.to_lowercase()).collect();
                    covered_by_feeds(&self.feeds, &lc_tags, false).is_some()
                }),
        );

        let mut iterators: Vec<Box<dyn Iterator<Item = &'a Post> + 'a>> = self
            .followees
            .iter()
            .filter_map(move |id| state.users.get(id))
            .map(|user| user.posts(state))
            .collect();

        iterators.push(posts_by_tags);

        Box::new(
            IteratorMerger {
                iterators: iterators.into_iter().map(|i| i.peekable()).collect(),
            }
            .filter(move |post| with_comments || post.parent.is_none())
            // if the post if from a realm, it's only included if user if part of it
            .filter(move |post| {
                post.realm
                    .as_ref()
                    .map(|id| self.realms.contains(id))
                    .unwrap_or(true)
            })
            .skip(page * CONFIG.feed_page_size)
            .take(CONFIG.feed_page_size),
        )
    }

    pub fn notify_with_params<T: AsRef<str>>(&mut self, message: T, predicate: Option<Predicate>) {
        self.messages += 1;
        let id = self.messages;
        match predicate {
            None => self.inbox.insert(
                format!("generic_{id}"),
                Notification::Generic(message.as_ref().into()),
            ),
            Some(p) => self.inbox.insert(
                format!("conditional_{id}"),
                Notification::Conditional(message.as_ref().into(), p),
            ),
        };
    }

    pub fn notify<T: AsRef<str>>(&mut self, message: T) {
        self.notify_with_params(message, None)
    }

    pub fn notify_about_post<T: AsRef<str>>(&mut self, message: T, post_id: PostId) {
        self.messages += 1;
        let id = self.messages;
        self.inbox.insert(
            format!("generic_{id}"),
            Notification::NewPost(message.as_ref().into(), post_id),
        );
    }

    pub fn notify_about_watched_post(&mut self, post_id: PostId, comment: PostId, parent: PostId) {
        let id = format!("watched_{post_id}");
        if let Notification::WatchedPostEntries(entries) = self
            .inbox
            .entry(id)
            .or_insert_with(|| Notification::WatchedPostEntries(Default::default()))
        {
            entries.retain(|id| *id != parent);
            entries.push(comment);
        }
    }

    pub fn is_bot(&self) -> bool {
        self.controllers.iter().any(|p| p.len() == 27)
    }

    pub fn change_cycles<T: ToString>(
        &mut self,
        amount: Cycles,
        delta: CyclesDelta,
        log: T,
    ) -> Result<(), String> {
        if delta == CyclesDelta::Minus && amount <= self.cycles || delta == CyclesDelta::Plus {
            if delta == CyclesDelta::Plus {
                self.cycles += amount;
            } else {
                self.cycles -= amount;
            }
            self.accounting.push_front((
                time(),
                "CYC".to_string(),
                if delta == CyclesDelta::Plus {
                    amount as i64
                } else {
                    -(amount as i64)
                },
                log.to_string(),
            ));
            return Ok(());
        }
        Err("not enough cycles".into())
    }

    pub fn change_karma<T: ToString>(&mut self, amount: Karma, log: T) {
        if amount > 0 {
            if self.karma >= 0 {
                // if total karma is positivie and the amount is positive, increase rewards
                self.rewarded_karma += amount as u64;
            } else {
                // if total karma is negative and the amount positive, increase total karma, not
                // rewards
                self.karma += amount;
            }
        } else if amount.abs() > self.rewarded_karma as Karma {
            // if amount is negative and larger than collected rewards, destroy them and
            // subtract from total karma the rest.
            self.karma -= amount.abs() - self.rewarded_karma as Karma;
            self.rewarded_karma = 0;
        } else {
            // if amount is negative and small than collected rewards, subtract from rewards
            self.rewarded_karma = self.rewarded_karma.saturating_sub(amount.unsigned_abs());
        }
        if self.karma < 0 {
            self.rewarded_karma = 0;
        }
        self.accounting
            .push_front((time(), "KRM".to_string(), amount, log.to_string()));
    }

    pub fn compute_karma_donation(&mut self, sender: UserId, amount: Cycles) -> Cycles {
        let donations = self.karma_donations.entry(sender).or_insert(100);
        let effective_amount = (*donations as u64 * amount / 100).max(1);
        if amount > 1 {
            *donations = (*donations).saturating_sub(CONFIG.karma_donation_decline_percentage);
        }
        effective_amount
    }

    pub fn karma_to_reward(&self) -> u64 {
        self.rewarded_karma
    }

    pub fn apply_rewards(&mut self) {
        self.karma += self.rewarded_karma as Karma;
        self.rewarded_karma = 0;
    }

    pub fn cycles(&self) -> Cycles {
        self.cycles
    }

    pub fn karma(&self) -> Karma {
        self.karma
    }

    pub fn top_up_cycles_from_karma(&mut self) -> Result<Cycles, String> {
        let cycles_needed = CONFIG.native_cycles_per_xdr.saturating_sub(self.cycles());
        let top_up = cycles_needed.min(self.rewarded_karma) as Cycles;
        if top_up == 0 {
            return Ok(0);
        }
        self.change_cycles(top_up, CyclesDelta::Plus, "cycles top-up from karma")
            .map(|_| top_up)
    }

    pub fn top_up_cycles_from_revenue(
        &mut self,
        revenue: &mut u64,
        e8s_for_one_xdr: u64,
    ) -> Result<(), String> {
        let cycles_needed = CONFIG.native_cycles_per_xdr.saturating_sub(self.cycles());
        if *revenue > 0 && cycles_needed > 0 {
            let e8s_needed = cycles_needed * e8s_for_one_xdr / CONFIG.native_cycles_per_xdr;
            let top_up_e8s = e8s_needed.min(*revenue);
            let cycles =
                top_up_e8s as f32 / e8s_for_one_xdr as f32 * CONFIG.native_cycles_per_xdr as f32;
            *revenue = (*revenue).saturating_sub(top_up_e8s);
            self.change_cycles(
                cycles as Cycles,
                CyclesDelta::Plus,
                "cycles top-up from revenue",
            )?;
        }
        Ok(())
    }

    pub fn update(
        caller: Principal,
        new_name: Option<String>,
        about: String,
        principals: Vec<String>,
        settings: String,
    ) -> Result<(), String> {
        if !User::valid_info(&about, &settings) {
            return Err("invalid user info".to_string());
        }
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
            let user_id = user.id;
            let old_name = user.name.clone();
            if let Some(name) = &new_name {
                state.validate_username(name)?;
                state.charge(user_id, CONFIG.name_change_cost, "name change")?;
                state
                    .logger
                    .info(format!("@{} changed name to @{} 🪪", old_name, name));
            }
            if let Some(user) = state.principal_to_user_mut(caller) {
                user.about = about;
                user.settings = settings;
                user.controllers = principals;
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
}

struct IteratorMerger<'a, T> {
    iterators: Vec<std::iter::Peekable<Box<dyn Iterator<Item = &'a T> + 'a>>>,
}

impl<'a, T: Clone + PartialOrd> Iterator for IteratorMerger<'a, T> {
    type Item = &'a T;

    fn next(&mut self) -> Option<Self::Item> {
        let mut max_val = None;
        let mut indexes = vec![];
        for (i, iter) in self.iterators.iter_mut().enumerate() {
            let candidate = iter.peek().cloned();
            if candidate == max_val {
                indexes.push(i);
            } else if candidate > max_val {
                max_val = candidate;
                indexes = vec![i];
            }
        }
        max_val.as_ref()?;
        indexes.into_iter().for_each(|i| {
            self.iterators[i].next();
        });
        max_val
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::tests::pr;

    #[test]
    fn test_automatic_top_up() {
        let mut user = User::new(pr(0), 66, 0, Default::default());
        let e8s_for_one_xdr = 3095_0000;

        // no top up triggered
        user.cycles = 1000;
        user.rewarded_karma = 30;
        user.top_up_cycles_from_karma().unwrap();
        assert_eq!(user.rewarded_karma, 30);
        let mut revenue = 2000_0000;
        user.top_up_cycles_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 2000_0000);
        assert_eq!(user.cycles(), 1000);

        // rewards are enough
        user.cycles = 980;
        user.rewarded_karma = 30;
        let cycles = user.top_up_cycles_from_karma().unwrap();
        assert_eq!(cycles, 20);
        let mut revenue = 2000_0000;
        user.top_up_cycles_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 2000_0000);
        assert_eq!(user.cycles(), 1000);

        // rewards are still enough
        user.cycles = 0;
        user.rewarded_karma = 3000;
        let cycles = user.top_up_cycles_from_karma().unwrap();
        assert_eq!(cycles, 1000);
        let mut revenue = 2000_0000;
        user.top_up_cycles_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 2000_0000);
        assert_eq!(user.cycles(), 1000);

        // rewards are not enough
        user.cycles = 0;
        user.rewarded_karma = 500;
        let cycles = user.top_up_cycles_from_karma().unwrap();
        assert_eq!(cycles, 500);
        let mut revenue = 2000_0000;
        user.top_up_cycles_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 452_5000);
        assert_eq!(user.cycles(), 1000);

        // rewards and revenue not enough
        user.cycles = 0;
        user.rewarded_karma = 500;
        let cycles = user.top_up_cycles_from_karma().unwrap();
        assert_eq!(cycles, 500);
        let mut revenue = 1000_0000;
        user.top_up_cycles_from_revenue(&mut revenue, e8s_for_one_xdr)
            .unwrap();
        assert_eq!(revenue, 0);
        assert_eq!(user.cycles(), 823);
    }

    #[test]
    fn test_donation_decline() {
        let mut u = User::new(pr(0), 66, 0, Default::default());
        assert_eq!(u.compute_karma_donation(777, 10), 10);
        assert_eq!(u.compute_karma_donation(777, 10), 8);
        assert_eq!(u.compute_karma_donation(777, 1), 1);
        assert_eq!(u.compute_karma_donation(777, 1), 1);
        assert_eq!(u.compute_karma_donation(777, 1), 1);
        assert_eq!(u.compute_karma_donation(777, 10), 7);
        assert_eq!(u.compute_karma_donation(777, 5), 2);
        assert_eq!(u.compute_karma_donation(777, 10), 4);
        assert_eq!(u.compute_karma_donation(777, 1), 1);
        assert_eq!(u.compute_karma_donation(777, 1), 1);
        assert_eq!(u.compute_karma_donation(777, 1), 1);
        assert_eq!(u.compute_karma_donation(777, 10), 2);
        assert_eq!(u.compute_karma_donation(777, 10), 1);
        assert_eq!(u.compute_karma_donation(777, 10), 1);
        assert_eq!(u.compute_karma_donation(777, 10), 1);
    }

    #[test]
    fn test_rewarding() {
        let mut u = User::new(pr(0), 66, 0, Default::default());

        assert_eq!(u.karma(), 0);
        assert_eq!(u.karma_to_reward(), 0);

        u.change_karma(100, "");
        assert_eq!(u.karma(), 0);
        assert_eq!(u.karma_to_reward(), 100);

        u.change_karma(-50, "");
        assert_eq!(u.karma(), 0);
        assert_eq!(u.karma_to_reward(), 50);

        u.change_karma(-100, "");
        assert_eq!(u.karma(), -50);
        assert_eq!(u.karma_to_reward(), 0);

        u.change_karma(100, "");
        assert_eq!(u.karma(), 50);
        assert_eq!(u.karma_to_reward(), 0);

        u.change_karma(20, "");
        assert_eq!(u.karma(), 50);
        assert_eq!(u.karma_to_reward(), 20);

        u.apply_rewards();
        assert_eq!(u.karma(), 70);
        assert_eq!(u.karma_to_reward(), 0);

        u.change_karma(-100, "");
        assert_eq!(u.karma(), -30);
        assert_eq!(u.karma_to_reward(), 0);
    }

    #[test]
    fn test_change_cycles() {
        let mut u = User::new(pr(1), 66, 0, Default::default());
        u.cycles = 100;
        assert!(u.change_cycles(55, CyclesDelta::Plus, "").is_ok());
        assert_eq!(u.cycles(), 155);
        assert!(u.change_cycles(156, CyclesDelta::Minus, "").is_err());
        assert!(u.change_cycles(155, CyclesDelta::Minus, "").is_ok());
        assert_eq!(u.cycles(), 0);
    }

    #[test]
    fn test_change_karma() {
        let mut u = User::new(pr(1), 66, 0, Default::default());
        u.karma = 100;
        u.rewarded_karma = 100;
        assert_eq!(u.karma(), 100);
        assert_eq!(u.karma_to_reward(), 100);
        u.change_karma(-150, "");
        assert_eq!(u.karma(), 50);
        assert_eq!(u.karma_to_reward(), 0);
    }
}
