use super::{reports::Report, *};
use ic_ledger_types::AccountIdentifier;
use serde::{Deserialize, Serialize};

pub type UserId = u64;

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

#[derive(Clone, Serialize, Deserialize)]
pub struct User {
    pub id: UserId,
    pub name: String,
    pub posts: Vec<PostId>,
    bookmarks: VecDeque<PostId>,
    pub about: String,
    pub account: String,
    settings: String,
    karma: Karma,
    pub rewarded_karma: Karma,
    pub cycles: Cycles,
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
    pub current_realm: Option<String>,
    pub balance: Token,
    pub active_weeks: u32,
    pub principal: Principal,
    pub report: Option<Report>,

    #[serde(default)]
    pub karma_from_last_posts: BTreeMap<UserId, Karma>,

    #[serde(default)]
    pub treasury_e8s: u64,
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
            posts: Default::default(),
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
            current_realm: None,
            messages: 0,
            inbox: Default::default(),
            balance: 0,
            active_weeks: 0,
            principal,
            karma_from_last_posts: Default::default(),
            treasury_e8s: 0,
        }
    }

    pub fn update(&mut self, about: String, principals: Vec<String>, settings: String) {
        self.about = about;
        self.settings = settings;
        self.controllers = principals;
    }

    pub fn toggle_bookmark(&mut self, post_id: PostId) -> bool {
        if self.bookmarks.contains(&post_id) {
            self.bookmarks.retain(|id| id != &post_id);
            return false;
        }
        self.bookmarks.push_front(post_id);
        true
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
        principal: Principal,
        state: &'a State,
        page: usize,
        with_comments: bool,
    ) -> Box<dyn Iterator<Item = &'a Post> + 'a> {
        let posts_by_tags = Box::new(
            state
                .last_posts(principal, with_comments)
                .filter(move |post| {
                    let lc_tags: BTreeSet<_> = post.tags.iter().map(|t| t.to_lowercase()).collect();
                    covered_by_feeds(&self.feeds, &lc_tags, false).is_some()
                })
                .map(|post| &post.id),
        );

        let mut iterators: Vec<Box<dyn Iterator<Item = &'a PostId> + 'a>> = self
            .followees
            .iter()
            .filter_map(move |id| state.users.get(id))
            .map(|user| {
                let iter: Box<dyn Iterator<Item = &'a PostId> + 'a> =
                    Box::new(user.posts.iter().rev());
                iter
            })
            .collect();

        iterators.push(posts_by_tags);

        Box::new(
            IteratorMerger {
                iterators: iterators.into_iter().map(|i| i.peekable()).collect(),
            }
            .filter_map(move |id| state.posts.get(&id))
            .filter(move |post| with_comments || post.parent.is_none())
            .filter(move |post| {
                // Either  the user is in no realm or in the realm of the post
                (self.current_realm.is_none() || post.realm == self.current_realm)
                   // if the post if from a realm, it's only included if user if part of it
                    && post
                        .realm
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
                self.rewarded_karma += amount;
            } else {
                // if total karma is negative and the amount positive, increase total karma, not
                // rewards
                self.karma += amount;
            }
        } else if amount.abs() > self.rewarded_karma {
            // if amount is negative and larger than collected rewards, destroy them and
            // subtract from total karma the rest.
            self.karma -= amount.abs() - self.rewarded_karma;
            self.rewarded_karma = 0;
        } else {
            // if amount is negative and small than collected rewards, subtract from rewards
            self.rewarded_karma += amount;
        }
        if self.karma < 0 {
            self.rewarded_karma = 0;
        }
        self.accounting
            .push_front((time(), "KRM".to_string(), amount, log.to_string()));
    }

    pub fn karma_to_reward(&self) -> Karma {
        self.rewarded_karma
    }

    pub fn apply_rewards(&mut self) {
        self.karma += self.rewarded_karma;
        self.rewarded_karma = 0;
    }

    pub fn cycles(&self) -> Cycles {
        self.cycles
    }

    pub fn karma(&self) -> Karma {
        self.karma
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::tests::pr;

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
