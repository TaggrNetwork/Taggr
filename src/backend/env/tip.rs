use candid::Nat;
use icrc_ledger_types::{icrc::generic_value::ICRC3Value, icrc3::blocks::ICRC3GenericBlock};

use super::{token::Memo, *};

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

fn create_post_tip(
    state: &mut State,
    post_id: PostId,
    canister_id: Principal,
    amount: u128,
    memo: Option<Memo>,
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

fn memo_to_u64(memo: Option<Vec<u8>>) -> Result<u64, String> {
    let memo_value = memo.ok_or("memo is not defined")?;

    let mut padded = [0u8; 8];
    let len = std::cmp::min(memo_value.len(), 8);
    padded[8 - len..].copy_from_slice(&memo_value[..len]);
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
                    format!("external tipping for post {}", post_id),
                )
            })?;

            return Err(e);
        }
    }
}

async fn try_tip(
    post_id: PostId,
    canister_id: Principal,
    caller: Principal,
    start_index: u64,
) -> Result<Tip, String> {
    let args = canisters::GetBlocksArgs {
        start: Nat::from(start_index),
        length: Nat::from(1_u64),
    };
    let response = canisters::get_icrc3_get_blocks(canister_id, args).await?;

    let Some(block_with_id) = response.blocks.first() else {
        return Err(format!("transaction not found at index {}", start_index));
    };

    let (amount, from, to, memo) = convert_icrc3_block_to_transfer(&block_with_id.block)?;

    if from.owner != caller {
        return Err("you are not the transaction initiator".into());
    }

    mutate(|state| {
        create_post_tip(
            state,
            post_id,
            canister_id,
            amount,
            memo,
            to.owner,
            from.owner,
            start_index,
        )
    })
}

pub fn convert_icrc3_block_to_transfer(
    block: &ICRC3GenericBlock,
) -> Result<(u128, Account, Account, Option<Memo>), String> {
    let block_map = match block {
        ICRC3Value::Map(map) => Some(map),
        _ => None,
    }
    .ok_or("block map not found")?;

    let tx = block_map
        .get("tx")
        .and_then(|tx| match tx {
            ICRC3Value::Map(m) => Some(m),
            _ => None,
        })
        .ok_or("tx map not found")?;

    let memo = block_map
        .get("memo")
        .or(tx.get("memo"))
        .and_then(|icrc3_value| match icrc3_value {
            ICRC3Value::Blob(m) => Some(m.clone().to_vec()),
            _ => None,
        });

    let amount = tx
        .get("amt")
        .and_then(|icrc3_value| match icrc3_value {
            ICRC3Value::Nat(a) => Some(a.clone()),
            _ => None,
        })
        .ok_or("amount not found")?;
    let amount = u128::try_from(&amount.0).ok().ok_or("amount not found")?;

    let from = tx
        .get("from")
        .and_then(|icrc3_value| match icrc3_value {
            ICRC3Value::Array(from_array) => {
                if let Some(value) = from_array.first() {
                    return match value {
                        ICRC3Value::Blob(blob) => Some(Principal::from_slice(blob)),
                        _ => None,
                    };
                }
                None
            }
            _ => None,
        })
        .ok_or("from not found")?;

    let to = tx
        .get("to")
        .and_then(|icrc3_value| match icrc3_value {
            ICRC3Value::Array(from_array) => {
                if let Some(value) = from_array.first() {
                    return match value {
                        ICRC3Value::Blob(blob) => Some(Principal::from_slice(blob)),
                        _ => None,
                    };
                }
                None
            }
            _ => None,
        })
        .ok_or("to not found")?;

    Ok((amount, account(from), account(to), memo))
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
