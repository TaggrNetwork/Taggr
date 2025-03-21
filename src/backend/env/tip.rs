use super::*;

pub type TipId = u64;

#[derive(Clone, Serialize, Deserialize)]
pub struct Tip {
    id: TipId,
    post_id: PostId,

    sender_id: UserId,

    canister_id: Principal,
    amount: u128,
}

impl Tip {
    pub fn new(post_id: PostId, sender_id: UserId, canister_id: Principal, amount: u128) -> Self {
        Self {
            post_id,
            id: 0,
            amount,
            canister_id,
            sender_id,
        }
    }
}

pub fn create_post_tip(
    state: &mut State,
    post_id: PostId,
    canister_id: Principal,
    amount: u64,
    memo: Option<Vec<u8>>,
    to_principal: Principal,
    from_principal: Principal,
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
        return Err("user does not match with post creator".to_string());
    }
    if let Some(native_token) = realm.native_token {
        if native_token != canister_id {
            return Err("token is not native realm token".to_string());
        }
    }
    if memo_u64 != post_id {
        return Err(format!(
            "memo {} does not match with post id {}",
            memo_u64, post_id
        ));
    }

    let has_external_tip = post.has_external_tip;

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

    let mut tip = Tip::new(post_id, sender_id, canister_id, amount as u128);
    tip.id = state.post_tips.len() as u64;

    if let Some(post_tips) = state.post_tips.get_mut(&post_id) {
        post_tips.push(tip.clone());
    } else {
        state.post_tips.insert(post_id, vec![tip.clone()]);
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
