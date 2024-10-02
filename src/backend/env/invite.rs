use super::{user::UserId, Credits, Principal, RealmId, State, User};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct Invite {
    pub credits: Credits,
    pub credits_per_user: Credits,
    pub joined_user_ids: BTreeSet<UserId>,
    pub realm_id: Option<RealmId>,
    /// Owner id
    pub user_id: UserId,
}

impl Invite {
    pub fn new(
        credits: Credits,
        credits_per_user: Credits,
        realm_id: Option<RealmId>,
        user_id: UserId,
    ) -> Self {
        // Convert empty realm_id to None
        let converted_relm_id: Option<RealmId> = realm_id.filter(|id| !id.is_empty());

        Self {
            credits,
            credits_per_user,
            joined_user_ids: BTreeSet::new(),
            realm_id: converted_relm_id,
            user_id,
        }
    }

    pub fn consume(&mut self, joined_user_id: UserId) -> Result<(), String> {
        let new_credits = self
            .credits
            .checked_sub(self.credits_per_user)
            .ok_or("Invite credits too low")?;
        self.credits = new_credits;

        if self.joined_user_ids.contains(&joined_user_id) {
            return Err("User already credited".into());
        }

        self.joined_user_ids.insert(joined_user_id);

        Ok(())
    }

    pub fn update(
        &mut self,
        credits: Option<Credits>,
        realm_id: Option<RealmId>,
        user_id: UserId,
    ) -> Result<(), String> {
        if self.user_id != user_id {
            return Err("Owner does not match".into());
        }

        if let Some(new_credits) = credits {
            self.credits = new_credits;
        }

        if let Some(id) = realm_id {
            if id.is_empty() {
                self.realm_id = None;
            } else {
                self.realm_id = Some(id);
            }
        }

        Ok(())
    }
}

pub fn invites_by_principal(state: &State, principal: Principal) -> Vec<(String, Invite)> {
    state
        .principal_to_user(principal)
        .map(|user| {
            state
                .invite_codes
                .iter()
                .filter(|(_, invite)| invite.user_id == user.id)
                .map(|(code, invite)| (code.clone(), invite.clone()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub fn validate_user_invites_credits(
    state: &State,
    user: &User,
    new_credits: Credits,
    old_credits: Option<Credits>,
) -> Result<(), String> {
    if user.credits() < new_credits {
        return Err("not enough credits".into());
    }

    let total_invites_credits: Credits = state
        .invite_codes
        .values()
        .filter(|invite| invite.user_id == user.id)
        .map(|invite| invite.credits)
        .sum();

    let total_with_diff = total_invites_credits
        .checked_add(new_credits)
        .ok_or("Invite credits overflow")?
        .checked_sub(old_credits.unwrap_or_default());

    match total_with_diff {
        Some(total_with_diff) => {
            if total_with_diff > user.credits() {
                return Err(format!(
                    "You don't have enough credits to support invites {} , {}",
                    user.credits(),
                    total_with_diff
                ));
            }
        }
        None => {
            return Err("Invite credits overflow".into());
        }
    }

    Ok(())
}

pub fn validate_realm_id(state: &State, realm_id: Option<&RealmId>) -> Result<(), String> {
    if let Some(id) = realm_id {
        if !id.is_empty() && !state.realms.contains_key(id) {
            return Err(format!("Realm {} not found", id.clone()));
        };
    }

    Ok(())
}
