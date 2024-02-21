use super::reports::ReportState;
use super::*;
use super::{storage::Storage, user::UserId};
use crate::mutate;
use crate::reports::Report;
use ic_stable_structures::{StableBTreeMap, Storable};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::cell::RefCell;
use std::cmp::{Ordering, PartialOrd};

thread_local! {
    pub static POSTS: RefCell<Option<StableBTreeMap<PostId, Post, crate::Memory>>> = Default::default();
}

pub type PostId = u64;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Poll {
    pub options: Vec<String>,
    pub votes: BTreeMap<u16, BTreeSet<UserId>>,
    pub deadline: u64,
    #[serde(default)]
    pub voters: BTreeSet<UserId>,
    #[serde(default)]
    pub weighted_by_karma: BTreeMap<u16, i64>,
    #[serde(default)]
    pub weighted_by_tokens: BTreeMap<u16, Token>,
}

#[derive(Clone, Serialize, Deserialize)]
pub enum Extension {
    Poll(Poll),
    Proposal(u32),
    Repost(PostId),
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Post {
    pub id: PostId,
    pub body: String,
    pub user: UserId,
    timestamp: u64,
    pub children: Vec<PostId>,
    pub parent: Option<PostId>,
    pub watchers: BTreeSet<UserId>,
    pub tags: BTreeSet<String>,
    pub reactions: BTreeMap<u16, BTreeSet<UserId>>,
    pub patches: Vec<(u64, String)>,
    pub files: BTreeMap<String, (u64, usize)>,
    pub tree_size: u32,
    pub tree_update: u64,
    pub report: Option<Report>,
    pub tips: Vec<(UserId, u64)>,
    pub extension: Option<Extension>,
    pub realm: Option<String>,
    pub hashes: Vec<String>,

    #[serde(default)]
    pub reposts: Vec<PostId>,
    #[serde(default)]
    heat: u32,

    #[serde(skip)]
    pub archived: bool,
}

impl Storable for Post {
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;

    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(serde_cbor::to_vec(self).expect("post serialization failed"))
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        serde_cbor::from_slice(&bytes).expect("post deserialization failed")
    }
}

impl PartialEq for Post {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl PartialOrd for Post {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.id.cmp(&other.id))
    }
}

impl Post {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        user: UserId,
        tags: BTreeSet<String>,
        body: String,
        timestamp: u64,
        parent: Option<PostId>,
        mut extension: Option<Extension>,
        realm: Option<String>,
        heat: u32,
    ) -> Self {
        // initialize all extensions properly
        if let Some(Extension::Poll(poll)) = &mut extension {
            poll.votes.clear()
        };

        Self {
            id: 0,
            tags,
            body: body.trim().into(),
            user,
            timestamp,
            children: Default::default(),
            watchers: [user].iter().cloned().collect(),
            reactions: Default::default(),
            parent,
            patches: Default::default(),
            files: Default::default(),
            tips: Default::default(),
            hashes: Default::default(),
            reposts: Default::default(),
            tree_size: 0,
            tree_update: timestamp,
            report: None,
            extension,
            archived: false,
            realm,
            heat,
        }
    }

    pub fn creation_timestamp(&self) -> u64 {
        self.timestamp
    }

    // Return post's original timestamp, either by taking the minimum from the edits or the one
    // assigned to `timestamp`.
    pub fn timestamp(&self) -> u64 {
        self.patches
            .iter()
            .map(|(timestamp, _)| timestamp)
            .min()
            .copied()
            .unwrap_or(self.timestamp)
    }

    pub fn toggle_following(&mut self, user_id: UserId) -> bool {
        if self.watchers.contains(&user_id) {
            self.watchers.remove(&user_id);
            return false;
        }
        self.watchers.insert(user_id);
        true
    }

    pub fn vote_on_poll(
        &mut self,
        user_id: UserId,
        user_realms: Vec<String>,
        time: u64,
        vote: u16,
        anonymously: bool,
    ) -> Result<(), String> {
        if let Some(realm) = self.realm.as_ref() {
            if !user_realms.contains(realm) {
                return Err(format!("you're not in realm {}", realm));
            }
        }
        let timestamp = self.timestamp();
        if let Some(Extension::Poll(poll)) = self.extension.as_mut() {
            if poll.options.len() as u16 <= vote {
                return Err("invalid vote".into());
            }
            if time > timestamp + HOUR * poll.deadline {
                return Err("poll expired".into());
            }

            // if user voted already, check the conditions
            if poll.voters.contains(&user_id) {
                // if the voter voted unanonymously
                if poll.votes.values().flatten().any(|id| id == &user_id) {
                    // check if the user can still re-vote
                    if time + CONFIG.poll_revote_deadline_hours * HOUR
                        >= timestamp + HOUR * poll.deadline
                    {
                        return Err("your vote cannot be changed anymore".into());
                    }
                    poll.votes.values_mut().for_each(|votes| {
                        votes.remove(&user_id);
                    });
                } else {
                    return Err("anonymous votes cannot be changed".into());
                }
            }
            poll.voters.insert(user_id);
            poll.votes.entry(vote).or_default().insert(if anonymously {
                UserId::MAX
            } else {
                user_id
            });
        }
        Ok(())
    }

    pub fn valid(&self, blobs: &[(String, Blob)]) -> Result<(), String> {
        if self.body.is_empty() || self.body.chars().count() > CONFIG.max_post_length {
            return Err("invalid post content".into());
        }
        if !blobs.iter().all(|(key, blob)| {
            key.len() <= 8 && blob.len() > 0 && blob.len() <= CONFIG.max_blob_size_bytes
        }) {
            return Err("invalid blobs".into());
        }
        Ok(())
    }

    pub async fn save_blobs(post_id: PostId, blobs: Vec<(String, Blob)>) -> Result<(), String> {
        let existing_blobs = Post::get(&post_id)
            .map(|post| post.files.keys().cloned().collect::<BTreeSet<_>>())
            .unwrap_or_default();

        for (id, blob) in blobs
            .into_iter()
            .filter(|(id, _)| !existing_blobs.contains(id))
        {
            match Storage::write_to_bucket(blob.as_slice()).await {
                Ok((bucket_id, offset)) => mutate(|state| {
                    Post::mutate(state, &post_id, |post| {
                        post.files
                            .insert(format!("{}@{}", id, bucket_id), (offset, blob.len()));
                        Ok(())
                    })
                }),
                Err(err) => {
                    let msg = format!("Couldn't write a blob to bucket: {:?}", err);
                    mutate(|state| state.logger.error(&msg));
                    Err(err)
                }
            }?
        }
        Ok(())
    }

    pub fn vote_on_report(
        &mut self,
        stalwarts: usize,
        stalwart: UserId,
        confirmed: bool,
    ) -> Result<(), String> {
        if self.user == stalwart {
            return Err("no voting on own posts".into());
        }
        let report = self.report.as_mut().ok_or("no report found".to_string())?;
        if let ReportState::Confirmed = report.vote(stalwarts, stalwart, confirmed)? {
            self.delete(vec![self.body.clone()]);
        }
        Ok(())
    }

    pub fn is_deleted(&self) -> bool {
        !self.hashes.is_empty()
    }

    pub fn delete(&mut self, versions: Vec<String>) {
        self.files.clear();
        self.body.clear();
        self.patches.clear();
        self.tags.clear();
        self.extension = None;
        self.hashes = versions
            .into_iter()
            .map(|value| {
                let mut hasher = Sha256::new();
                hasher.update(value.as_bytes());
                format!("{:x}", hasher.finalize())
            })
            .collect();
        if let Some(report) = self.report.as_mut() {
            report.closed = true;
        }
    }

    pub fn costs(&self, state: &State, blobs: usize) -> Credits {
        CONFIG.post_cost
            + state.tags_cost(Box::new(self.tags.iter()))
            + blobs as Credits * CONFIG.blob_cost
            + if matches!(self.extension, Some(Extension::Poll(_))) {
                CONFIG.poll_cost
            } else {
                0
            }
    }

    pub fn make_hot(&mut self, user_id: UserId, user_balance: Token) {
        // if it's a comment, a reaction is from the users itself or the post is too old, exit
        if self.parent.is_some()
            || self.user == user_id
            || self.timestamp() + CONFIG.max_age_hot_post_days * DAY < time()
        {
            return;
        };

        // negative reactions balance
        let rewards = config::reaction_rewards();
        if self
            .reactions
            .iter()
            .map(|(r_id, users)| {
                rewards.get(r_id).copied().unwrap_or_default() * users.len() as i64
            })
            .sum::<i64>()
            < 0
        {
            return;
        }

        let endorsement1 = (user_balance as f32).sqrt() as u32;
        let endorsement2 = (endorsement1 as f32).sqrt() as u32;

        self.heat += endorsement1 + self.reposts.len() as u32 * endorsement2;
    }

    pub fn heat(&self) -> u64 {
        let time_left = (CONFIG.max_age_hot_post_days * DAY)
            .saturating_sub(time().saturating_sub(self.timestamp))
            / 1000000;
        self.heat as u64 * time_left
    }

    /// Checks if the poll has ended. If not, returns `Ok(false)`. If the poll ended,
    /// returns `Ok(true)` and assings the result weighted by the token voting power.
    pub fn conclude_poll(state: &mut State, post_id: &PostId, now: u64) -> Result<bool, String> {
        let user_balances = Post::get(post_id)
            .and_then(|post| {
                if let Some(Extension::Poll(poll)) = post.extension.as_ref() {
                    let user_ids = poll.votes.values().flatten().cloned();
                    let balances = user_ids
                        .filter_map(|id| {
                            state.users.get(&id).map(|user| (id, user.total_balance()))
                        })
                        .collect::<BTreeMap<_, _>>();
                    Some(balances)
                } else {
                    None
                }
            })
            .ok_or("no post with poll found")?;

        Post::mutate(state, post_id, |post| {
            let timestamp = post.timestamp();
            if let Some(Extension::Poll(poll)) = post.extension.as_mut() {
                if timestamp + poll.deadline * HOUR > now {
                    return Ok(false);
                }
                poll.weighted_by_tokens = poll
                    .votes
                    .iter()
                    .map(|(k, ids)| (*k, ids.iter().filter_map(|id| user_balances.get(id)).sum()))
                    .collect();

                return Ok(true);
            }
            Err("no poll extension".into())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn edit(
        id: PostId,
        body: String,
        blobs: Vec<(String, Blob)>,
        patch: String,
        picked_realm: Option<String>,
        principal: Principal,
        timestamp: u64,
    ) -> Result<(), String> {
        mutate(|state| {
            let user = state.principal_to_user(principal).ok_or("no user found")?;
            let mut post = Post::get(&id).ok_or("no post found")?.clone();
            if post.user != user.id {
                return Err("unauthorized".to_string());
            }
            if let Some(false) = picked_realm.as_ref().map(|name| user.realms.contains(name)) {
                if post.parent.is_none() {
                    return Err("you're not in the realm".into());
                }
            }
            let user_id = user.id;
            post.tags = tags(CONFIG.max_tag_length, &body);
            post.body = body;
            post.valid(&blobs)?;
            let old_blob_ids = post
                .files
                .keys()
                .filter_map(|key| key.split('@').next())
                .collect::<BTreeSet<_>>();
            let new_blobs = blobs
                .iter()
                .filter(|(id, _)| !old_blob_ids.contains(id.as_str()))
                .count();
            let costs = post.costs(state, new_blobs);
            state.charge_in_realm(
                user_id,
                costs,
                post.realm.as_ref(),
                format!("editing of post [{0}](#/post/{0})", id),
            )?;
            post.patches.push((post.timestamp, patch));
            post.timestamp = timestamp;

            let current_realm = post.realm.clone();

            Post::save(post);

            if current_realm != picked_realm {
                change_realm(state, id, picked_realm)
            }
            Ok(())
        })?;

        Post::save_blobs(id, blobs).await?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create(
        state: &mut State,
        body: String,
        blobs: &[(String, Blob)],
        principal: Principal,
        timestamp: u64,
        parent: Option<PostId>,
        picked_realm: Option<String>,
        extension: Option<Extension>,
    ) -> Result<PostId, String> {
        if state.read_only {
            return Err("read-only mode".into());
        }
        let user = match state.principal_to_user(principal) {
            Some(user) => user,
            // look for an authorized controller
            None => {
                let controller_id = principal.to_string();
                match state
                    .users
                    .values()
                    .find(|u| u.controllers.contains(&controller_id))
                {
                    Some(user) => user,
                    None => return Err(format!("no user with controller {} found", controller_id)),
                }
            }
        };

        if user.is_bot() && parent.is_some() {
            return Err("bots can't create comments".into());
        }

        let realm = match parent.and_then(|id| Post::get(&id)) {
            Some(parent) => parent.realm.clone(),
            None => match picked_realm {
                Some(value) if value.to_lowercase() == CONFIG.name.to_lowercase() => None,
                value => value,
            },
        };
        if let Some(realm_id) = &realm {
            if parent.is_none() && !user.realms.contains(realm_id) {
                return Err(format!("not a member of the realm {}", realm_id));
            }
            if let Some(realm) = state.realms.get(realm_id) {
                let whitelist = &realm.whitelist;
                if !whitelist.is_empty() && !whitelist.contains(&user.id)
                    || whitelist.is_empty() && !user.get_filter().passes(&realm.filter)
                {
                    return Err(format!(
                        "{} realm is gated and you are not allowed to post to this realm",
                        realm_id
                    ));
                }
            }
        } else if let Some(discussion_owner) = parent.and_then(|post_id| {
            state.thread(post_id).next().and_then(|post_id| {
                Post::get(&post_id).and_then(|post| state.users.get(&post.user))
            })
        }) {
            if !discussion_owner.accepts(user.id, &user.get_filter()) {
                return Err(format!(
                    "you cannot participate in discussions started by {}",
                    discussion_owner.name
                ));
            }
        }

        let user_id = user.id;
        let controversial = user.controversial();
        let user_balance = user.balance;
        let mut post = Post::new(
            user_id,
            tags(CONFIG.max_tag_length, &body),
            body,
            timestamp,
            parent,
            extension,
            realm.clone(),
            (user_balance / token::base()).min(CONFIG.post_heat_token_balance_cap) as u32,
        );
        let costs = post.costs(state, blobs.len());
        post.valid(blobs)?;
        let future_id = state.next_post_id;
        let is_comment = parent.is_some();
        let excess_factor = user
            .posts(0, is_comment)
            .take_while(|post| post.timestamp() + if is_comment { HOUR } else { DAY } > timestamp)
            .count()
            .saturating_sub(if is_comment {
                CONFIG.max_comments_per_hour
            } else {
                CONFIG.max_posts_per_day
            });
        if excess_factor > 0 {
            let excess_penalty = CONFIG.excess_penalty * excess_factor as Credits;
            state.charge_in_realm(
                user_id,
                excess_penalty + blobs.len() as Credits * excess_penalty,
                realm.as_ref(),
                "excessive posting penalty",
            )?;
        }
        state.charge_in_realm(
            user_id,
            costs,
            realm.as_ref(),
            format!(
                "new {0} [{1}](#/post/{1})",
                if parent.is_some() { "comment" } else { "post" },
                future_id
            ),
        )?;
        let user = state.users.get_mut(&user_id).expect("no user found");
        user.posts.push(future_id);
        // reorder realms
        if let Some(name) = &realm {
            if user.realms.contains(name) {
                user.realms.retain(|id| id != name);
                user.realms.push(name.clone());
            }
        }
        user.last_activity = timestamp;
        let id = state.new_post_id();
        post.id = id;
        if let Some(realm) = realm.and_then(|name| state.realms.get_mut(&name)) {
            if parent.is_none() {
                realm.posts.push(post.id);
            }
            realm.last_update = timestamp;
        }
        if !post.tags.is_empty() {
            state.posts_with_tags.push(post.id)
        }
        if let Some(parent_id) = post.parent {
            let result = Post::mutate(state, &parent_id, |parent_post| {
                parent_post.children.push(id);
                parent_post.watchers.insert(user_id);
                if parent_post.user != user_id {
                    return Ok(Some((parent_post.user, parent_post.id)));
                }
                Ok(None)
            })?;
            // Reward user for spawning activity with their post.
            if let Some((parent_post_author, parent_post_id)) = result {
                state.spend_to_user_rewards(
                    parent_post_author,
                    CONFIG.response_reward,
                    format!("response to post [{0}](#/post/{0})", parent_post_id),
                )
            }
        }
        match post.extension.as_ref() {
            Some(Extension::Poll(_)) => {
                state.pending_polls.insert(post.id);
            }
            Some(Extension::Repost(post_id)) => {
                Post::mutate(state, post_id, |post| {
                    post.reposts.push(id);
                    Ok(())
                })?;
            }
            _ => (),
        };

        notify_about(state, &post);

        if post.parent.is_none() {
            state.root_posts += 1
        }

        Post::save(post);

        state
            .thread(id)
            .filter(|post_id| post_id != &id)
            .try_for_each(|id| {
                Post::mutate(state, &id, |post| {
                    post.tree_size += 1;
                    post.tree_update = timestamp;
                    if !controversial {
                        post.make_hot(user_id, user_balance);
                    }
                    Ok(())
                })
            })
            .expect("couldn't adjust post on the thread");

        Ok(id)
    }

    pub fn count() -> u64 {
        POSTS.with(|p| p.borrow().as_ref().unwrap().len())
    }

    pub fn get(post_id: &PostId) -> Option<Post> {
        POSTS.with(|p| p.borrow().as_ref().unwrap().get(post_id))
    }

    /// Mutates the post. Note that the mutation is applied even if errors occur. This function
    /// should only be used for fail-safe mutation.
    pub fn mutate<T, F>(state: &mut State, post_id: &PostId, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut Post) -> Result<T, String>,
    {
        if state.read_only {
            return Err("read-only mode".into());
        }
        let mut post = POSTS
            .with(|p| p.borrow_mut().as_mut().unwrap().remove(post_id))
            .ok_or("no post found")?;
        let result = f(&mut post);
        Post::save(post);
        result
    }

    pub fn save(post: Post) {
        POSTS.with(|p| p.borrow_mut().as_mut().unwrap().insert(post.id, post));
    }

    pub fn matches_filters(&self, filters: &Filters) -> bool {
        filters.users.contains(&self.user)
            || filters.tags.intersection(&self.tags).count() > 0
            || self
                .realm
                .as_ref()
                .map(|id| filters.realms.contains(id))
                .unwrap_or_default()
    }
}

pub fn change_realm(state: &mut State, root_post_id: PostId, new_realm: Option<String>) {
    let mut post_ids = vec![root_post_id];

    while let Some(post_id) = post_ids.pop() {
        let Some((children, realm)) =
            Post::get(&post_id).map(|post| (post.children.clone(), post.realm.clone()))
        else {
            continue;
        };
        post_ids.extend_from_slice(&children);
        let root = Post::mutate(state, &post_id, |post| {
            post.realm = new_realm.clone();
            Ok(post.parent.is_none())
        })
        .expect("couldn't mutate post");

        if let Some(id) = realm {
            let realm = state.realms.get_mut(&id).expect("no realm found");
            realm.posts.retain(|id| id != &root_post_id);
            realm.last_update = time();
        }
        if let Some(id) = &new_realm {
            let realm = state.realms.get_mut(id).expect("no realm found");
            if root {
                realm.posts.push(root_post_id);
            }
            realm.last_update = time();
        }
    }
}

fn notify_about(state: &mut State, post: &Post) {
    let post_user = state.users.get(&post.user).expect("no user found");
    let user_filter = post_user.get_filter();

    let mut notified: HashSet<_> = HashSet::new();
    // Don't notify the author
    notified.insert(post.user);
    if let Some(parent) = post.parent.and_then(|parent_id| Post::get(&parent_id)) {
        let parent_author = parent.user;
        if parent_author != post.user {
            if let Some(user) = state.users.get_mut(&parent_author) {
                if user.accepts(post.user, &user_filter) {
                    user.notify_about_post("A new reply to your post", post.id);
                    notified.insert(user.id);
                }
            }
        }
    }

    if let Some(Extension::Repost(post_id)) = post.extension.as_ref() {
        let Some(user_id) =
            Post::get(post_id).and_then(|post| state.users.get(&post.user).map(|user| user.id))
        else {
            return;
        };
        if notified.contains(&user_id) {
            return;
        }
        if let Some(user) = state.users.get_mut(&user_id) {
            if user.accepts(post.user, &user_filter) {
                user.notify_about_post("A new repost of your post", post.id);
            }
            notified.insert(user.id);
        }
    }

    user_handles(CONFIG.max_tag_length, &post.body)
        .into_iter()
        .filter_map(|handle| state.user(&handle).map(|user| user.id))
        .filter(|id| !notified.contains(id))
        .collect::<Vec<_>>()
        .into_iter()
        .for_each(|mentioned_user_id| {
            let user = state
                .users
                .get_mut(&mentioned_user_id)
                .expect("no user found");
            if user.accepts(post.user, &user_filter) {
                user.notify_about_post("You were mentioned in a post", post.id);
                notified.insert(user.id);
            }
        });

    if let Some(parent_id) = post.parent {
        state
            .thread(parent_id)
            .filter_map(|id| Post::get(&id))
            .flat_map(|post| {
                post.watchers
                    .clone()
                    .into_iter()
                    .map(move |user_id| (post.id, user_id))
            })
            .collect::<Vec<_>>()
            .into_iter()
            .for_each(|(post_id, user_id)| {
                if notified.contains(&user_id) {
                    return;
                }
                if let Some(user) = state.users.get_mut(&user_id) {
                    if user.accepts(post.user, &user_filter) {
                        user.notify_about_watched_post(
                            post_id,
                            post.id,
                            post.parent.expect("no parent found"),
                        );
                    }
                    notified.insert(user_id);
                }
            });
    }
}

// Extracts hashtags from a string.
fn tags(max_tag_length: usize, input: &str) -> BTreeSet<String> {
    tokens(max_tag_length, input, &['#', '$'])
}

// Extracts user names from a string.
fn user_handles(max_tag_length: usize, input: &str) -> BTreeSet<String> {
    tokens(max_tag_length, input, &['@'])
}

fn tokens(max_tag_length: usize, input: &str, tokens: &[char]) -> BTreeSet<String> {
    use std::iter::FromIterator;
    let mut tags = Vec::new();
    let mut tag = Vec::new();
    let mut token_found = false;
    let mut whitespace_seen = true;
    for c in input.chars() {
        match c {
            t if whitespace_seen && tokens.contains(&t) => {
                token_found = true;
            }
            c if token_found => {
                if c.is_alphanumeric() || ['-', '_'].iter().any(|v| v == &c) {
                    tag.push(c);
                } else {
                    if !tag.iter().all(|c| c.is_numeric()) {
                        tags.push(String::from_iter(tag.clone()));
                    }
                    tag.clear();
                    token_found = false;
                }
            }
            _ => {}
        }
        whitespace_seen = c == ' ' || c == '\n' || c == '\t';
    }
    tags.push(String::from_iter(tag));
    tags.into_iter()
        .filter(|tag| {
            let l = tag.chars().count();
            l > 0 && l <= max_tag_length
        })
        .collect::<BTreeSet<_>>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hashtag_extraction() {
        let tags = |body| {
            let c = CONFIG;
            let mut t: Vec<_> = tags(c.max_tag_length, body).into_iter().collect();
            t.sort_unstable();
            t.join(" ")
        };
        assert_eq!(tags("This is a string without hashtags!"), "");
        assert_eq!(tags("This is a #string with hashtags!"), "string");
        assert_eq!(tags("#This is a #string with two hashtags!"), "This string");
        assert_eq!(tags("This string has no tags.#bug"), "");
        assert_eq!(tags("This is $TOKEN symbol"), "TOKEN");
        assert_eq!(
            tags("#This is a #string with $333 hashtags!"),
            "This string"
        );
        assert_eq!(tags("#year2021"), "year2021");
        assert_eq!(tags("#year2021 #year2021 #"), "year2021");
        assert_eq!(tags("#Ta1 #ta2"), "Ta1 ta2");
        assert_eq!(tags("#Tag #tag"), "Tag tag");
        assert_eq!(tags("Ой у #лузі червона #калина"), "калина лузі");
        assert_eq!(tags("This is a #feature-request"), "feature-request");
        assert_eq!(tags("Support #under_score"), "under_score");
    }

    #[test]
    fn test_costs() {
        let mut state = State::default();
        let mut p = Post::default();

        // empty post
        assert_eq!(p.costs(&state, Default::default()), CONFIG.post_cost);

        // tag without subscribers
        p.tags = ["world"].iter().map(|x| x.to_string()).collect();
        assert_eq!(p.costs(&state, 0), CONFIG.post_cost);

        state.tag_subscribers.insert("world".into(), 3);
        // tag with subscribers
        p.tags = ["world"].iter().map(|x| x.to_string()).collect();
        assert_eq!(p.costs(&state, 0), CONFIG.post_cost + 3);

        state.tag_subscribers.insert("hello".into(), 10);

        // two tags
        p.tags = ["hello", "world"].iter().map(|x| x.to_string()).collect();
        assert_eq!(p.costs(&state, 0), CONFIG.post_cost + 3 + 10);

        // two tags and a blob
        p.tags = ["hello", "world"].iter().map(|x| x.to_string()).collect();
        assert_eq!(
            p.costs(&state, 1),
            CONFIG.post_cost + 3 + 10 + CONFIG.blob_cost
        );
    }

    #[test]
    fn test_validity() {
        let mut p = Post::default();
        // empty body
        assert!(p.valid(Default::default()).is_err());

        // too long body
        p.body = String::from_utf8(
            "test"
                .as_bytes()
                .iter()
                .cycle()
                .take(CONFIG.max_post_length + 1)
                .cloned()
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(p.valid(Default::default()).is_err());

        // valid body
        p.body = "Hello world!".to_string();
        assert!(p.valid(Default::default()).is_ok());

        // too long blob id
        assert!(p
            .valid(
                vec![(
                    "abcdefghX".to_string(),
                    ByteBuf::from(
                        [0, 1]
                            .iter()
                            .cycle()
                            .take(CONFIG.max_blob_size_bytes)
                            .cloned()
                            .collect::<Vec<_>>()
                    )
                )]
                .as_slice()
            )
            .is_err());

        // valid blob
        assert!(p
            .valid(
                vec![(
                    "abcdefgh".to_string(),
                    ByteBuf::from(
                        [0, 1]
                            .iter()
                            .cycle()
                            .take(CONFIG.max_blob_size_bytes)
                            .cloned()
                            .collect::<Vec<_>>()
                    )
                )]
                .as_slice()
            )
            .is_ok());

        // empty blob
        assert!(p
            .valid(vec![("abcdefgh".to_string(), Default::default())].as_slice())
            .is_err());
    }
}
