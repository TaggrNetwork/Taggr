use super::*;

pub type TipId = u64;

#[derive(Clone, Serialize, Deserialize)]
pub struct Tip {
    id: TipId,
    post_id: PostId,

    sender_id: UserId,

    canister_id: Principal,
    amount: u128,
    /// Index from external transaction
    index: u64,
}

impl Tip {
    pub fn new(
        post_id: PostId,
        sender_id: UserId,
        canister_id: Principal,
        amount: u128,
        index: u64,
    ) -> Self {
        Self {
            post_id,
            id: 0,
            amount,
            canister_id,
            sender_id,
            index,
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn create_post_tip(
    state: &mut State,
    post_id: PostId,
    canister_id: Principal,
    amount: u128,
    memo: Option<Vec<u8>>,
    to_principal: Principal,
    from_principal: Principal,
    index: u64,
) -> Result<Tip, String> {
    let post = Post::get(state, &post_id).ok_or("post not found")?;
    let receiver_id = state
        .principal_to_user(to_principal)
        .ok_or("receiver not found")?
        .id;
    let sender_id = state
        .principal_to_user(from_principal)
        .ok_or("sender not found")?
        .id;
    let realm = post
        .realm
        .as_ref()
        .and_then(|id| state.realms.get(id))
        .ok_or("realm not found")?;
    let memo_u64 = convert_memo_to_u64(memo)?;

    if post.user != receiver_id {
        return Err("receiver does not match with post creator".to_string());
    }
    if realm.native_token != Some(canister_id)
        && realm
            .tokens
            .as_ref()
            .map_or(true, |tokens| !tokens.contains(&canister_id))
    {
        return Err("token is not allowed to tip in realm".to_string());
    }

    if memo_u64 != post_id {
        return Err(format!(
            "memo {} does not match with post id {}",
            memo_u64, post_id
        ));
    }

    let has_external_tip = post.has_external_tip;

    if state
        .post_tip_indexes
        .get(&post_id)
        .map_or(false, |tip_ids| {
            tip_ids.iter().any(|tip_id| {
                if let Some(tip) = state.memory.tips.get(tip_id) {
                    return tip.index == index && tip.canister_id == canister_id;
                }
                false
            })
        })
    {
        return Err("tip external index already exists".to_string());
    }

    // DoS protection
    state.charge(
        sender_id,
        CONFIG.tipping_cost,
        format!("external tipping to user {}", receiver_id),
    )?;

    if Some(true) != has_external_tip {
        Post::mutate(state, &post_id, |post| {
            post.has_external_tip = Some(true);
            Ok(())
        })
        .expect("post not found");
    }

    let mut tip = Tip::new(post_id, sender_id, canister_id, amount, index);
    tip.id = state.memory.tips.len() as u64 + 1;

    // Insert to stable memory
    state.memory.tips.insert(tip.id, tip.clone())?;

    // Create indexes on heap
    if let Some(tip_ids) = state.post_tip_indexes.get_mut(&post_id) {
        tip_ids.push(tip.id);
    } else {
        state.post_tip_indexes.insert(post_id, vec![tip.id]);
    }

    state
        .users
        .get_mut(&receiver_id)
        .expect("user not found")
        .notify_about_post(
            format!("{} tipped you with `{}` for your post", sender_id, amount,),
            post_id,
        );

    Ok(tip)
}

fn convert_memo_to_u64(memo: Option<Vec<u8>>) -> Result<PostId, String> {
    let memo_value = memo.ok_or("memo is not defined")?;

    let mut vec = memo_value.clone();

    // Add leading zeros if needed
    let current_len = vec.len();
    if current_len < 8 {
        let zeros_to_add = 8 - current_len;
        vec.splice(0..0, vec![0; zeros_to_add]);
    }

    let mut num = 0u64;

    // Combine bytes in little-endian order
    for &byte in vec.iter() {
        num = (num << 8) | byte as u64; // Shift left and add byte
    }

    Ok(num)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::tests::{create_user, pr};

    fn setup() -> (u64, Principal, Principal, RealmId) {
        // Create users, realm and post
        mutate(|state| {
            let p = pr(0);
            let p2 = pr(1);
            let user_id = create_user(state, p);
            create_user(state, p2);

            state
                .principal_to_user_mut(p)
                .unwrap()
                .change_credits(100, CreditsDelta::Plus, "")
                .unwrap();

            let realm_name = "test-realm".to_string();
            state
                .create_realm(
                    p,
                    realm_name.clone(),
                    Realm {
                        controllers: vec![user_id].into_iter().collect(),
                        ..Default::default()
                    },
                )
                .expect("realm creation failed");

            state.toggle_realm_membership(p, realm_name.clone());

            (
                Post::create(
                    state,
                    "Hello world!".into(),
                    &[],
                    p,
                    0,
                    None,
                    Some(realm_name.clone()),
                    None,
                )
                .unwrap(),
                p,
                p2,
                realm_name.clone(),
            )
        })
    }

    #[test]
    fn test_tip_validity() {
        // Create users, realm and post
        let (post_id, principal, principal_2, realm_id) = setup();
        let canister_id = pr(100);

        // Success
        mutate(|state| {
            // Add native token
            state
                .realms
                .get_mut(&realm_id)
                .expect("realm not found")
                .native_token = Some(canister_id);

            // Check sender credits
            let sender_credits = state
                .principal_to_user(principal_2)
                .expect("user not found")
                .credits();

            // Create tip
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                Some(vec![0, 0, 0, 0]),
                principal,
                principal_2,
                0,
            );
            assert_eq!(r.map(|tip| tip.id), Ok(1));

            // 5 credits to be consumed
            assert_eq!(
                sender_credits - 5,
                state
                    .principal_to_user(principal_2)
                    .expect("user not found")
                    .credits()
            );

            // Tip indexes
            assert_eq!(
                state.post_tip_indexes.iter().collect::<Vec<_>>(),
                vec![(&0, &vec![1])] // Both elements are Vec references
            );
        });

        // Post not found
        mutate(|state| {
            let r = create_post_tip(
                state,
                2, // Uknown post
                canister_id,
                1,
                Some(vec![0, 0, 0, 0]),
                principal,
                principal_2,
                0,
            );
            assert_eq!(r.err(), Some("post not found".to_string()));
        });

        // Receiver not found
        mutate(|state| {
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                Some(vec![0, 0, 0, 0]),
                pr(3), // Uknown receiver
                principal_2,
                0,
            );
            assert_eq!(r.err(), Some("receiver not found".to_string()));
        });

        // Sender not found
        mutate(|state| {
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                Some(vec![0, 0, 0, 0]),
                principal,
                pr(4), // Uknown sender
                0,
            );
            assert_eq!(r.err(), Some("sender not found".to_string()));
        });

        // Realm not found
        mutate(|state| {
            // Mock uknown realm
            state.posts.get_mut(&post_id).expect("post not found").realm =
                Some("uknown-realm".to_string());

            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                Some(vec![0, 0, 0, 0]),
                principal,
                principal_2,
                0,
            );
            assert_eq!(r.err(), Some("realm not found".to_string()));

            // Move back correct realm
            state.posts.get_mut(&post_id).expect("post not found").realm = Some(realm_id);
        });

        // Receiver does not match with post creator
        mutate(|state| {
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                Some(vec![0, 0, 0, 0]),
                principal_2, // Post creator is principal
                principal_2,
                0,
            );
            assert_eq!(
                r.err(),
                Some("receiver does not match with post creator".to_string())
            );
        });

        // Token is not as native or under tokens
        mutate(|state| {
            let random_canister_id = pr(200);
            let r = create_post_tip(
                state,
                post_id,
                random_canister_id, // Tip is in different token
                1,
                Some(vec![0, 0, 0, 0]),
                principal,
                principal_2,
                0,
            );
            assert_eq!(
                r.err(),
                Some("token is not allowed to tip in realm".to_string())
            );
        });

        // Memo does not match with post id
        mutate(|state| {
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                Some(vec![0, 0, 0, 1]), // Different memo
                principal,
                principal_2,
                0,
            );
            assert_eq!(
                r.err(),
                Some(format!(
                    "memo {} does not match with post id {}",
                    1, post_id
                ))
            );
        });

        // Tip external index already exists
        mutate(|state| {
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                Some(vec![0, 0, 0, 0]),
                principal,
                principal_2,
                0, // External index 0 already exists
            );
            assert_eq!(
                r.err(),
                Some("tip external index already exists".to_string())
            );
        });
    }
}
