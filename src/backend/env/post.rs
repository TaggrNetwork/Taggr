use super::*;
use super::{storage::Storage, user::UserId};
use crate::mutate;
use crate::reports::Report;
use serde::{Deserialize, Serialize};

pub type PostId = u64;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Poll {
    pub options: Vec<String>,
    pub votes: BTreeMap<u16, BTreeSet<UserId>>,
    pub deadline: u64,
    #[serde(default)]
    pub weighted_by_karma: BTreeMap<u16, Karma>,
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
}

impl Post {
    pub fn new(
        user: UserId,
        tags: BTreeSet<String>,
        body: String,
        timestamp: u64,
        parent: Option<PostId>,
        mut extension: Option<Extension>,
        realm: Option<String>,
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
            realm,
        }
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
    ) -> Result<(), String> {
        if let Some(realm) = self.realm.as_ref() {
            if !user_realms.contains(realm) {
                return Err(format!("you're not in realm {}", realm));
            }
        }
        let timestamp = self.timestamp();
        if let Some(Extension::Poll(poll)) = self.extension.as_mut() {
            // no multiple choice
            if poll.votes.values().flatten().any(|id| id == &user_id) {
                return Err("double vote".to_string());
            }
            if time < timestamp + HOUR * poll.deadline && poll.options.len() as u16 > vote {
                poll.votes.entry(vote).or_default().insert(user_id);
            }
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
        for (id, blob) in blobs.into_iter() {
            // only if the id is new, add it.
            if read(|state| {
                Post::get(state, &post_id)
                    .map(|post| post.files.keys().any(|file_id| file_id.contains(&id)))
            })
            .unwrap_or_default()
            {
                continue;
            }
            match Storage::write_to_bucket(blob.as_slice()).await.clone() {
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
                    return Err(err);
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
    }

    pub fn costs(&self, blobs: usize) -> Cycles {
        let tags = self.tags.len() as Cycles;
        CONFIG.post_cost.max(tags as Cycles * CONFIG.tag_cost)
            + blobs as Cycles * CONFIG.blob_cost
            + if matches!(self.extension, Some(Extension::Poll(_))) {
                CONFIG.poll_cost
            } else {
                0
            }
    }

    pub fn make_hot(&self, hot_list: &mut VecDeque<PostId>, total_users: usize, user_id: UserId) {
        // if it's a comment or reaction is from the users itself, exit
        if self.parent.is_some() || self.user == user_id {
            return;
        };
        let engagements = self
            .reactions
            .iter()
            .filter_map(|(id, users)| {
                (*id >= CONFIG.min_positive_reaction_id).then_some(users.len())
            })
            .sum::<usize>() as u32
            + self.tree_size;

        if engagements as f32 / (total_users as f32) < CONFIG.hot_post_engagement_percentage {
            return;
        }
        // negative reactions balance
        let karma = reaction_karma();
        if self
            .reactions
            .iter()
            .map(|(r_id, users)| {
                karma.get(r_id).copied().unwrap_or_default() * users.len() as Karma
            })
            .sum::<i64>()
            < 0
        {
            return;
        }

        let prev_len = hot_list.len();
        hot_list.retain(|post_id| *post_id != self.id);
        hot_list.push_front(self.id);
        if hot_list.len() > prev_len {
            hot_list.pop_back();
        }
    }

    /// Checks if the poll has ended. If not, returns `Ok(false)`. If the poll ended,
    /// returns `Ok(true)` and assings the result weighted by the square root of karma and by the token
    /// voting power.
    pub fn conclude_poll(state: &mut State, post_id: &PostId, now: u64) -> Result<bool, String> {
        let (balances, users) = Post::get(state, post_id)
            .and_then(|post| {
                if let Some(Extension::Poll(poll)) = post.extension.as_ref() {
                    let user_ids = poll.votes.values().flatten().cloned();
                    let users = user_ids
                        .filter_map(|id| state.users.get(&id).map(|user| (id, user.clone())))
                        .collect::<BTreeMap<_, _>>();
                    Some((
                        users
                            .values()
                            .map(|user| {
                                (
                                    user.principal,
                                    state
                                        .balances
                                        .get(&account(user.principal))
                                        .copied()
                                        .unwrap_or_default(),
                                )
                            })
                            .collect::<BTreeMap<_, _>>(),
                        users,
                    ))
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
                poll.weighted_by_karma = poll
                    .votes
                    .clone()
                    .into_iter()
                    .map(|(k, ids)| {
                        (
                            k,
                            ids.iter()
                                .filter_map(|id| users.get(id))
                                .filter(|user| user.karma() > 0)
                                .map(|user| (user.karma() as f32).sqrt() as Karma)
                                .sum(),
                        )
                    })
                    .collect();

                poll.weighted_by_tokens = poll
                    .votes
                    .iter()
                    .map(|(k, ids)| {
                        (
                            *k,
                            ids.iter()
                                .filter_map(|id| users.get(id))
                                .filter_map(|user| balances.get(&user.principal))
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
                return Err("you're not in the realm".into());
            }
            let user_id = user.id;
            post.tags = tags(CONFIG.max_tag_length, &body);
            post.body = body;
            post.valid(&blobs)?;
            let files_before = post.files.len();
            let costs = post.costs(post.files.len().saturating_sub(files_before));
            state.charge(user_id, costs, format!("editing of post {}", id))?;
            post.patches.push((post.timestamp, patch));
            post.timestamp = timestamp;

            let current_realm = post.realm.clone();

            Post::save(state, post.clone());

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

        let limit = if principal == id() {
            10 // canister itself can post up to 10 posts per hour to not skip NNS proposals
        } else if user.is_bot() {
            1
        } else if parent.is_none() {
            CONFIG.max_posts_per_hour
        } else {
            CONFIG.max_comments_per_hour
        } as usize;

        if user
            .posts
            .iter()
            .rev()
            .filter_map(|id| Post::get(state, id))
            .filter(|post| {
                !(parent.is_none() ^ post.parent.is_none())
                    && post.timestamp() > timestamp.saturating_sub(HOUR)
            })
            .count()
            >= limit
        {
            return Err(format!(
                "not more than {} {} per hour are allowed",
                limit,
                if parent.is_none() {
                    "posts"
                } else {
                    "comments"
                }
            ));
        }
        let realm = match parent.and_then(|id| Post::get(state, &id)) {
            Some(post) => post.realm.clone(),
            None => match picked_realm {
                Some(value) if value.to_lowercase() == CONFIG.name.to_lowercase() => None,
                Some(value) => Some(value),
                None => user.current_realm.clone(),
            },
        };
        if let Some(name) = &realm {
            if !user.realms.contains(name) {
                return Err(format!("not a member of the realm {}", name));
            }
        }
        let user_id = user.id;
        let mut post = Post::new(
            user_id,
            tags(CONFIG.max_tag_length, &body),
            body,
            timestamp,
            parent,
            extension,
            realm.clone(),
        );
        let costs = post.costs(blobs.len());
        post.valid(blobs)?;
        let trusted_user = user.trusted();
        let future_id = state.next_post_id;
        state.charge(user_id, costs, format!("new post {}", future_id))?;
        let id = state.new_post_id();
        let user = state.users.get_mut(&user_id).expect("no user found");
        user.posts.push(id);
        post.id = id;
        if let Some(realm) = realm.and_then(|name| state.realms.get_mut(&name)) {
            realm.posts.push(id);
        }
        if let Some(parent_id) = post.parent {
            let result = Post::mutate(state, &parent_id, |parent_post| {
                parent_post.children.push(id);
                parent_post.watchers.insert(user_id);
                if parent_post.user != user_id && trusted_user {
                    return Ok(Some((parent_post.user, parent_post.id)));
                }
                Ok(None)
            })?;
            // Reward user for spawning activity with their post.
            if let Some((parent_post_author, parent_post_id)) = result {
                state.spend_to_user_karma(
                    parent_post_author,
                    CONFIG.response_reward,
                    format!("response to post {}", parent_post_id),
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

        let users_len = state.users.len();
        let mut hot_posts = std::mem::take(&mut state.hot);
        state
            .thread(id)
            .filter(|post_id| post_id != &id)
            .try_for_each(|id| {
                Post::mutate(state, &id, |post| {
                    post.tree_size += 1;
                    post.tree_update = timestamp;
                    post.make_hot(&mut hot_posts, users_len, user_id);
                    Ok(())
                })
            })
            .expect("couldn't adjust post on the thread");

        state.hot = hot_posts;
        Ok(id)
    }

    pub fn count(state: &State) -> usize {
        state.posts.len()
    }

    pub fn get<'a>(state: &'a State, post_id: &PostId) -> Option<&'a Post> {
        state.posts.get(post_id)
    }

    pub fn mutate<T, F>(state: &mut State, post_id: &PostId, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut Post) -> Result<T, String>,
    {
        let mut post = state.posts.remove(post_id).ok_or("no post found")?;
        let result = f(&mut post);
        if state.posts.insert(*post_id, post).is_some() {
            panic!("no post should exist")
        }
        result
    }

    fn save(state: &mut State, post: Post) {
        state.posts.insert(post.id, post);
    }
}

pub fn change_realm(state: &mut State, root_post_id: PostId, new_realm: Option<String>) {
    let mut post_ids = vec![root_post_id];

    while let Some(post_id) = post_ids.pop() {
        let Post {
            children, realm, ..
        } = Post::get(state, &post_id).expect("no post found").clone();
        post_ids.extend_from_slice(&children);

        if let Some(realm_id) = realm.as_ref() {
            state
                .realms
                .get_mut(realm_id)
                .expect("no realm found")
                .posts
                .retain(|id| id != &post_id);
        }

        if let Some(realm_id) = new_realm.as_ref() {
            let realm = state.realms.get_mut(realm_id).expect("no realm found");
            realm.posts.push(post_id);
            realm.posts.sort_unstable();
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
