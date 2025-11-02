use candid::Nat;
use icrc_ledger_types::icrc3::transactions::GetTransactionsRequest;

use super::{token::Memo, *};

#[derive(Clone, Serialize, Deserialize)]
pub struct Tip {
    sender_id: UserId,

    canister_id: Principal,
    amount: u128,
    /// Index from external transaction
    index: u64,
}

#[allow(clippy::too_many_arguments)]
fn create_post_tip(
    state: &mut State,
    post_id: PostId,
    canister_id: Principal,
    amount: u128,
    memo: Memo,
    to: Principal,
    from: Principal,
    index: u64,
) -> Result<Tip, String> {
    let receiver_id = state.principal_to_user(to).ok_or("receiver not found")?.id;
    let post = Post::get(state, &post_id).ok_or("post not found")?;
    if post.user != receiver_id {
        return Err("receiver does not match with post creator".to_string());
    }

    let (sender_id, sender_name) = state
        .principal_to_user(from)
        .map(|sender| (sender.id, sender.name.clone()))
        .ok_or("sender not found")?;

    let memo = memo_to_u64(memo)?;

    if memo != post_id {
        return Err(format!(
            "memo {} does not match with post id {}",
            memo, post_id
        ));
    }

    if post.external_tips.iter().any(|tip| tip.index == index) {
        return Err("tip external index already exists".to_string());
    }

    let tip = Tip {
        sender_id,
        canister_id,
        amount,
        index,
    };

    Post::mutate(state, &post_id, |post| {
        post.external_tips.push(tip.clone());
        Ok(())
    })
    .map_err(|err| format!("failed to add tip to post: {}", err))?;

    state
        .users
        .get_mut(&receiver_id)
        .expect("user not found")
        .notify_about_post(format!("You got a tip from @{}", sender_name), post_id);

    Ok(tip)
}

fn memo_to_u64(memo: Vec<u8>) -> Result<u64, String> {
    let mut padded = [0u8; 8];
    let len = std::cmp::min(memo.len(), 8);
    padded[8 - len..].copy_from_slice(&memo[..len]);
    Ok(u64::from_be_bytes(padded))
}

pub async fn add_tip(
    post_id: PostId,
    canister_id: Principal,
    caller: Principal,
    start_index: u64,
) -> Result<Tip, String> {
    match try_tip(post_id, canister_id, caller, start_index).await {
        Ok(tip) => Ok(tip),
        Err(e) => {
            // Penalize user for failed tip attempt since inter-canister calls are expensive
            mutate(|state| {
                let sender_id = state.principal_to_user(caller).expect("user not found").id;
                state.charge(
                    sender_id,
                    CONFIG.tipping_cost * 50,
                    format!("failed external tipping for post {}", post_id),
                )
            })?;

            Err(e)
        }
    }
}

async fn try_tip(
    post_id: PostId,
    canister_id: Principal,
    caller: Principal,
    start_index: u64,
) -> Result<Tip, String> {
    let args = GetTransactionsRequest {
        start: Nat::from(start_index),
        length: Nat::from(1_u128),
    };
    let response = canisters::get_transactions(canister_id, args).await?;
    let Some(transfer) = response
        .transactions
        .first()
        .and_then(|tx| tx.transfer.as_ref())
    else {
        return Err(format!("no transfer transaction at index {}", start_index));
    };

    mutate(|state| {
        let amount = u128::try_from(&transfer.amount.0).expect("Wrong amount");
        let memo = transfer.memo.as_ref().unwrap().0.to_vec();
        if transfer.from.owner != caller {
            return Err("caller is not transaction sender".into());
        }
        create_post_tip(
            state,
            post_id,
            canister_id,
            amount,
            memo,
            transfer.to.owner,
            transfer.from.owner,
            start_index,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::{
        realms::create_realm,
        tests::{create_user, pr},
    };

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
            create_realm(
                state,
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
                vec![0, 0, 0, 0],
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
                vec![0, 0, 0, 0],
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
                vec![0, 0, 0, 0],
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
                vec![0, 0, 0, 0],
                principal,
                pr(4), // Uknown sender
                0,
            );
            assert_eq!(r.err(), Some("sender not found".to_string()));
        });

        // Receiver does not match with post creator
        mutate(|state| {
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                vec![0, 0, 0, 0],
                principal_2, // Post creator is principal
                principal_2,
                0,
            );
            assert_eq!(
                r.err(),
                Some("receiver does not match with post creator".to_string())
            );
        });

        // Memo does not match with post id
        mutate(|state| {
            let r = create_post_tip(
                state,
                post_id,
                canister_id,
                1,
                vec![0, 0, 0, 1], // Different memo
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
                vec![0, 0, 0, 0],
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
