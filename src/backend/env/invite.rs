use super::{user::UserId, Credits, Principal, RealmId, State, User};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct Invite {
    pub credits: Credits,
    pub credits_per_user: Credits,
    pub joined_user_ids: BTreeSet<UserId>,
    pub realm_id: Option<RealmId>,
    pub inviter_user_id: UserId,
}

impl Invite {
    pub fn new(
        credits: Credits,
        credits_per_user: Credits,
        realm_id: Option<RealmId>,
        inviter_user_id: UserId,
    ) -> Self {
        // Convert empty realm_id to None
        let converted_relm_id: Option<RealmId> = realm_id.filter(|id| !id.is_empty());

        Self {
            credits,
            credits_per_user,
            joined_user_ids: BTreeSet::new(),
            realm_id: converted_relm_id,
            inviter_user_id,
        }
    }

    pub fn consume(&mut self, joined_user_id: UserId) -> Result<(), String> {
        if self.joined_user_ids.contains(&joined_user_id) {
            return Err("User already credited".into());
        }

        let new_credits = self
            .credits
            .checked_sub(self.credits_per_user)
            .ok_or("Invite credits too low")?;
        self.credits = new_credits;

        self.joined_user_ids.insert(joined_user_id);

        Ok(())
    }

    pub fn update(
        &mut self,
        credits: Option<Credits>,
        realm_id: Option<RealmId>,
        user_id: UserId,
    ) -> Result<(), String> {
        if self.inviter_user_id != user_id {
            return Err("Owner does not match".into());
        }

        if let Some(new_credits) = credits {
            if new_credits % self.credits_per_user != 0 {
                return Err(format!(
                    "Credits per user are not a multiple of credits {} {}",
                    new_credits, self.credits_per_user
                ));
            }

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

pub fn invites_by_principal(
    state: &State,
    principal: Principal,
) -> Box<impl Iterator<Item = (&String, &Invite)>> {
    let invites = state
        .principal_to_user(principal)
        .ok_or("Principal not found")
        .map(|user| user.id)
        .map(|user_id| {
            state
                .invite_codes
                .iter()
                .filter(move |(_, invite)| invite.inviter_user_id == user_id)
        })
        .expect("Failed to filter invites");

    Box::new(invites)
}

/**
 * Check allocated credits in invites do not exceed user's credits balance
 *
 * Protects against creating infinite number of invites
 */
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
        .filter(|invite| invite.inviter_user_id == user.id)
        .map(|invite| invite.credits)
        .sum();

    let total_with_diff = total_invites_credits
        .checked_add(new_credits)
        .ok_or("Invite credits overflow")?
        .checked_sub(old_credits.unwrap_or_default())
        .ok_or("Invite credits overflow")?;

    if total_with_diff > user.credits() {
        return Err(format!(
            "You don't have enough credits to support invites {} , {}",
            user.credits(),
            total_with_diff
        ));
    }

    Ok(())
}
