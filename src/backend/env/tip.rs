use candid::Nat;

use super::{canisters::GetTransactionsArgs, *};

#[derive(Clone, Serialize, Deserialize)]
pub struct Tip {
    sender_id: UserId,

    canister_id: Principal,
    amount: u128,
    /// Index from external transaction
    index: u64,
}

impl Tip {
    pub fn new(sender_id: UserId, canister_id: Principal, amount: u128, index: u64) -> Self {
        Self {
            amount,
            canister_id,
            sender_id,
            index,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn create_post_tip(
    state: &mut State,
    post_id: PostId,
    canister_id: Principal,
    amount: u128,
    memo: Option<Vec<u8>>,
    to_principal: Principal,
    from_principal: Principal,
    index: u64,
) -> Result<Tip, String> {
    let receiver_id = state
        .principal_to_user(to_principal)
        .ok_or("receiver not found")?
        .id;
    let (sender_id, sender_name) = state
        .principal_to_user(from_principal)
        .map(|sender| (sender.id, sender.name.clone()))
        .ok_or("sender not found")?;
    let post = Post::get(state, &post_id).ok_or("post not found")?;
    let realm = post
        .realm
        .as_ref()
        .and_then(|id| state.realms.get(id))
        .ok_or("realm not found")?;
    let memo_u64 = convert_memo_to_u64(memo)?;

    if post.user != receiver_id {
        return Err("receiver does not match with post creator".to_string());
    }
    if realm
        .tokens
        .as_ref()
        .map_or(false, |tokens| !tokens.contains(&canister_id))
    {
        return Err("token is not allowed to tip in realm".to_string());
    }

    if memo_u64 != post_id {
        return Err(format!(
            "memo {} does not match with post id {}",
            memo_u64, post_id
        ));
    }

    if post.external_tips.iter().any(|tip| tip.index == index) {
        return Err("tip external index already exists".to_string());
    }

    let tip = Tip::new(sender_id, canister_id, amount, index);

    Post::mutate(state, &post_id, |post| {
        post.external_tips.push(tip.clone());
        Ok(())
    })
    .expect("could not find post");

    state
        .users
        .get_mut(&receiver_id)
        .expect("user not found")
        .notify_about_post(
            format!("@{} tipped you with for your post", sender_name),
            post_id,
        );

    Ok(tip)
}

#[allow(clippy::too_many_arguments)]
pub async fn try_tip(
    post_id: PostId,
    canister_id: Principal,
    caller: Principal,
    start_index: u64,
) -> Result<Tip, String> {
    // DoS protection
    mutate(|state| {
        let sender_id = state.principal_to_user(caller).expect("user not found").id;
        state.charge(
            sender_id,
            CONFIG.tipping_cost,
            format!("external tipping for post {}", post_id),
        )
    })?;

    let args = GetTransactionsArgs {
        start: Nat::from(start_index),
        length: Nat::from(1_u128),
    };
    let response = canisters::get_transactions(canister_id, args).await;
    if let Some(transaction) = response
        .expect("Failed to retrive transactions")
        .transactions
        .first()
    {
        match &transaction.transfer {
            Some(transfer) => mutate(|state| {
                let amount = u128::try_from(&transfer.amount.0).expect("Wrong amount");
                let memo = transfer.memo.as_ref().unwrap().0.to_vec();
                if caller != transfer.from.owner {
                    return Err("caller different to tx sender".into());
                }
                create_post_tip(
                    state,
                    post_id,
                    canister_id,
                    amount,
                    Some(memo),
                    transfer.to.owner,
                    transfer.from.owner,
                    start_index,
                )
            }),
            None => Err("Transaction is not a transfer!".into()),
        }
    } else {
        Err(format!(
            "We could not find transaction at index {}",
            start_index
        ))
    }
}

fn convert_memo_to_u64(memo: Option<Vec<u8>>) -> Result<u64, String> {
    let memo_value = memo.ok_or("memo is not defined")?;

    let mut padded = [0u8; 8];
    let len = std::cmp::min(memo_value.len(), 8);
    padded[8 - len..].copy_from_slice(&memo_value[..len]);
    Ok(u64::from_be_bytes(padded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::tests::{create_user, pr};

    /// ### Returns
    /// post_id, post_owner, receiver, realm_id
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
            // Add tokens
            let tokens = BTreeSet::from([canister_id]);
            state
                .realms
                .get_mut(&realm_id)
                .expect("realm not found")
                .tokens = Some(tokens);

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
            assert_eq!(r.map(|tip| tip.index), Ok(0));
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
