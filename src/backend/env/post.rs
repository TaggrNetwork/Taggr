use std::cmp::{Ordering, PartialOrd};

use super::*;
use super::{storage::Storage, user::UserId};
use crate::mutate;
use crate::reports::Report;
use serde::{Deserialize, Serialize};

static mut CACHE: Option<BTreeMap<PostId, Box<Post>>> = None;

// This is a static cache that is only populated during one queries's life cycle. The reason why it's
// needed is that `Post::get` always returns a reference to a post. But when we load an archived
// post, we read raw bytes from the stable memory and deserialize them into a value. To return a
// reference to that value, we need to anchor it somewhere on the heap. This is where we need our
// cache. But we also _cannot_ store posts inside the cache directly, because any mutation of the
// cache within a query life cycle will restructure the hash map and hence break all references.
// To work around this issue, we go through one level of indirection and box all posts (put them on
// to the heap) and then only add the pointers to the boxed value into the cache. This way,
// when we get a reference to a post and dereference twice, we get a stable reference.
fn cache<'a>() -> &'a mut BTreeMap<PostId, Box<Post>> {
    unsafe {
        if CACHE.is_none() {
            CACHE = Some(Default::default())
        }
        CACHE.as_mut().expect("no cache instantiated")
    }
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
    heat: u32,

    #[serde(skip)]
    pub archived: bool,
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
        let existing_blobs = read(|state| {
            Post::get(state, &post_id)
                .map(|post| post.files.keys().cloned().collect::<BTreeSet<_>>())
        })
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
        report.vote(stalwarts, stalwart, confirmed)?;
        let approved = report.closed && report.confirmed_by.len() > report.rejected_by.len();
        if approved {
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

    pub fn costs(&self, blobs: usize) -> Credits {
        let tags = self.tags.len() as Credits;
        CONFIG.post_cost.max(tags as Credits * CONFIG.tag_cost)
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

        self.heat += (user_balance as f32).sqrt() as u32;
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
        let users = Post::get(state, post_id)
            .and_then(|post| {
                if let Some(Extension::Poll(poll)) = post.extension.as_ref() {
                    let user_ids = poll.votes.values().flatten().cloned();
                    let users = user_ids
                        .filter_map(|id| state.users.get(&id).map(|user| (id, user.clone())))
                        .collect::<BTreeMap<_, _>>();
                    Some(users)
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
                    .map(|(k, ids)| {
                        (
                            *k,
                            ids.iter()
                                .filter_map(|id| users.get(id))
                                .map(|user| user.balance)
                                .sum(),
                        )
                    })
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
            let user = state
                .principal_to_user(principal)
                .ok_or("no user found")?
                .clone();
            let mut post = Post::get(state, &id).ok_or("no post found")?.clone();
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
            let costs = post.costs(new_blobs);
            state.charge_in_realm(
                user_id,
                costs,
                post.realm.as_ref(),
                format!("editing of post [{0}](#/post/{0})", id),
            )?;
            post.patches.push((post.timestamp, patch));
            post.timestamp = timestamp;

            let current_realm = post.realm.clone();

            // After we validated the new edited copy of the post, charged the user, we should remove the
            // old post, and insert the edited one.
            Post::take(state, &id);
            Post::save(state, post);

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
            return Err("Bots can't create comments currently".into());
        }

        let excess_factor = user
            .posts(state, 0)
            .filter(|post| {
                if parent.is_none() {
                    post.parent.is_none() && post.timestamp() + DAY > timestamp
                } else {
                    post.parent.is_some() && post.timestamp() + HOUR > timestamp
                }
            })
            .count()
            .saturating_sub(if parent.is_none() {
                CONFIG.max_posts_per_day
            } else {
                CONFIG.max_comments_per_hour
            });

        let realm = match parent.and_then(|id| Post::get(state, &id)) {
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
                    || whitelist.is_empty() && !user.matches(&realm.filter, time())
                {
                    return Err(format!(
                        "{} realm is gated and you are not allowed to post to this realm",
                        realm_id
                    ));
                }
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
        let costs = post.costs(blobs.len());
        post.valid(blobs)?;
        let future_id = state.next_post_id;
        if excess_factor > 0 {
            state.charge_in_realm(
                user_id,
                CONFIG.excess_penalty * excess_factor as Credits,
                realm.as_ref(),
                "excessive posting penalty",
            )?;
        }
        state.charge_in_realm(
            user_id,
            costs,
            realm.as_ref(),
            format!("new post [{0}](#/post/{0})", future_id),
        )?;
        let user = state.users.get_mut(&user_id).expect("no user found");
        user.num_posts += 1;
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
            realm.num_posts += 1;
            realm.last_update = timestamp;
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
        if matches!(&post.extension, &Some(Extension::Poll(_))) {
            state.pending_polls.insert(post.id);
        }

        notify_about(state, &post);

        if post.parent.is_none() {
            state.root_posts += 1
        }

        Post::save(state, post);

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

    pub fn count(state: &State) -> usize {
        state.posts.len() + state.memory.posts.len()
    }

    // Get the post from the heap if available, or load from the stable memory into the cache and
    // return the reference to it
    pub fn get<'a>(state: &'a State, post_id: &PostId) -> Option<&'a Post> {
        state.posts.get(post_id).or_else(|| {
            let boxed = cache().get(post_id).or_else(|| {
                state.memory.posts.get(post_id).and_then(|mut post: Post| {
                    let cache = cache();
                    post.archived = true;
                    cache.insert(*post_id, Box::new(post));
                    cache.get(post_id)
                })
            });
            boxed.map(|ptr| &**ptr)
        })
    }

    // Takes the post from cold or hot memory
    fn take(state: &mut State, post_id: &PostId) -> Post {
        cache().remove(post_id);
        state
            .posts
            .remove(post_id)
            .ok_or("no post found".to_string())
            .or_else(|_| state.memory.posts.remove(post_id))
            .expect("couldn't take post")
    }

    // Takes the post from hot or cold memory, mutates and inserts into the hot memory
    pub fn mutate<T, F>(state: &mut State, post_id: &PostId, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut Post) -> Result<T, String>,
    {
        let mut post = Post::take(state, post_id);
        let result = f(&mut post);
        Post::save(state, post);
        result
    }

    fn save(state: &mut State, post: Post) {
        if state.posts.insert(post.id, post).is_some() {
            panic!("no post should exist")
        }
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

// Moves a configured number of posts from hot to cold memory.
pub fn archive_cold_posts(state: &mut State, max_posts_in_heap: usize) -> Result<(), String> {
    let mut posts: Vec<&Post> = state.posts.values().collect();
    let posts_to_archive = posts
        .len()
        .saturating_sub(max_posts_in_heap)
        // We cap the number at `max_posts_in_heap` because we know for sure this archiving will
        // never run out of instructions.
        .min(max_posts_in_heap);
    if posts_to_archive == 0 {
        return Ok(());
    }

    // sort from newest to oldest
    posts.sort_unstable_by_key(|p| std::cmp::Reverse(p.timestamp()));
    let ids = posts.into_iter().map(|post| post.id).collect::<Vec<_>>();

    ids.into_iter()
        .skip(max_posts_in_heap)
        .try_for_each(|post_id| {
            let post = state
                .posts
                .remove(&post_id)
                .ok_or(format!("no post found for id={post_id}"))?;
            state.memory.posts.insert(post_id, post)
        })
        .expect("couldn't archive post");

    state
        .logger
        .debug(format!("`{}` posts archived.", posts_to_archive));
    Ok(())
}

pub fn change_realm(state: &mut State, root_post_id: PostId, new_realm: Option<String>) {
    let mut post_ids = vec![root_post_id];

    while let Some(post_id) = post_ids.pop() {
        let Post {
            children, realm, ..
        } = Post::get(state, &post_id).expect("no post found").clone();
        post_ids.extend_from_slice(&children);

        if let Some(id) = realm {
            let realm = state.realms.get_mut(&id).expect("no realm found");
            realm.num_posts -= 1;
            realm.last_update = time();
        }
        if let Some(id) = &new_realm {
            let realm = state.realms.get_mut(id).expect("no realm found");
            realm.num_posts += 1;
            realm.last_update = time();
        }

        Post::mutate(state, &post_id, |post| {
            post.realm = new_realm.clone();
            Ok(())
        })
        .expect("couldn't mutate post");
    }
}

fn notify_about(state: &mut State, post: &Post) {
    let post_user_name = state
        .users
        .get(&post.user)
        .expect("no user found")
        .name
        .clone();
    let mut notified: HashSet<_> = HashSet::new();
    // Don't notify the author
    notified.insert(post.user);
    if let Some(parent) = post
        .parent
        .and_then(|parent_id| Post::get(state, &parent_id))
    {
        let parent_author = parent.user;
        if parent_author != post.user {
            if let Some(user) = state.users.get_mut(&parent_author) {
                user.notify_about_post(
                    format!("@{} replied to your post", post_user_name,),
                    post.id,
                );
                notified.insert(user.id);
            }
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
            user.notify_about_post(
                format!("@{} mentioned you in a post", post_user_name),
                post.id,
            );
            notified.insert(user.id);
        });

    if let Some(parent_id) = post.parent {
        state
            .thread(parent_id)
            .filter_map(|id| Post::get(state, &id))
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
                    user.notify_about_watched_post(
                        post_id,
                        post.id,
                        post.parent.expect("no parent found"),
                    );
                }
                notified.insert(user_id);
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
    use crate::{
        env::tests::{create_user, pr},
        STATE,
    };

    #[test]
    fn test_post_archiving() {
        static mut MEM_END: u64 = 16;
        static mut MEMORY: Option<Vec<u8>> = None;
        unsafe {
            let size = 1024 * 512;
            MEMORY = Some(Vec::with_capacity(size));
            for _ in 0..size {
                MEMORY.as_mut().unwrap().push(0);
            }
        };
        let mem_grow = |n| unsafe {
            MEM_END += n;
            Ok(0)
        };
        fn mem_end() -> u64 {
            unsafe { MEM_END }
        }
        let writer = |offset, buf: &[u8]| {
            buf.iter().enumerate().for_each(|(i, byte)| unsafe {
                MEMORY.as_mut().unwrap()[offset as usize + i] = *byte
            });
        };
        let reader = |offset, buf: &mut [u8]| {
            for (i, b) in buf.iter_mut().enumerate() {
                *b = unsafe { MEMORY.as_ref().unwrap()[offset as usize + i] }
            }
        };
        STATE.with(|cell| {
            cell.replace(Default::default());
            cell.borrow_mut().memory.set_test_api(
                Box::new(mem_grow),
                Box::new(mem_end),
                Box::new(writer),
                Box::new(reader),
            );
        });

        mutate(|state| {
            for i in 0..10 {
                create_user(state, pr(i));
                let id = Post::create(
                    state,
                    format!("test {}", i),
                    &[],
                    pr(i),
                    0,
                    None,
                    None,
                    None,
                )
                .unwrap();
                // Make every new post be older than the previous one
                Post::mutate(state, &id, |post| {
                    post.timestamp = 10 << i;
                    Ok(())
                })
                .unwrap();
            }

            assert_eq!(state.posts.len(), 10);
            // Trigger post archiving
            archive_cold_posts(state, 5).unwrap();
            assert_eq!(
                state.memory.health("B"),
                "boundary=849B, mem_size=849B, segments=0".to_string()
            );

            // Make sure we have the right numbers in cold and hot memories
            assert_eq!(state.posts.len(), 5);
            assert_eq!(state.memory.posts.len(), 5);

            // Make sure the first posts are deserialized correctly and are marked as archived
            for i in 0..5 {
                let post = Post::get(state, &i).unwrap();
                assert!(post.archived);
                assert_eq!(post.body, format!("test {}", i));
            }
            for i in 5..10 {
                assert!(!Post::get(state, &i).unwrap().archived);
            }

            // Mutate post 1 by reacting on it
            state.react(pr(0), 1, 10, 0).unwrap();

            // This should unarchive the post
            assert!(!Post::get(state, &1).unwrap().archived);
            assert_eq!(state.posts.len(), 6);
            assert_eq!(state.memory.posts.len(), 4);

            // Create a comment on 3rd post
            Post::create(
                state,
                "comment".to_string(),
                &[],
                pr(4),
                0,
                Some(3),
                None,
                None,
            )
            .unwrap();

            // Make sure the post is unarchived
            assert!(!Post::get(state, &3).unwrap().archived);
            assert_eq!(state.posts.len(), 8);
            assert_eq!(state.memory.posts.len(), 3);
            assert_eq!(
                state.memory.health("B"),
                "boundary=849B, mem_size=849B, segments=2".to_string()
            );

            // Archive posts again
            archive_cold_posts(state, 5).unwrap();
            assert_eq!(state.posts.len(), 5);
            assert_eq!(state.memory.posts.len(), 6);
            // Segments were reduced, becasue the new post 10 fits into a gap left from one of the
            // old posts
            assert_eq!(
                state.memory.health("B"),
                "boundary=1187B, mem_size=1187B, segments=1".to_string()
            );
        });
    }

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
        let mut p = Post::default();
        // empty post
        assert_eq!(p.costs(Default::default()), CONFIG.post_cost);

        // one tag
        p.tags = ["world"].iter().map(|x| x.to_string()).collect();
        assert_eq!(p.costs(0), CONFIG.tag_cost);

        // two tags
        p.tags = ["hello", "world"].iter().map(|x| x.to_string()).collect();
        assert_eq!(p.costs(0), 2 * CONFIG.tag_cost);

        // two tags and a blob
        p.tags = ["hello", "world"].iter().map(|x| x.to_string()).collect();
        assert_eq!(p.costs(1), 2 * CONFIG.tag_cost + CONFIG.blob_cost);
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
