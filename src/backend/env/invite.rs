use crate::optional;

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
        let converted_realm_id: Option<RealmId> = realm_id.filter(|id| !id.is_empty());

        Self {
            credits,
            credits_per_user,
            joined_user_ids: BTreeSet::new(),
            realm_id: converted_realm_id,
            inviter_user_id,
        }
    }

    pub fn consume(&mut self, joined_user_id: UserId) -> Result<(), String> {
        if self.joined_user_ids.contains(&joined_user_id) {
            return Err("user already credited".into());
        }

        let new_credits = self
            .credits
            .checked_sub(self.credits_per_user)
            .expect("invite credits too low");
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
            return Err("owner does not match".into());
        }

        if let Some(new_credits) = credits {
            if new_credits % self.credits_per_user != 0 {
                return Err(format!(
                    "credits per user {} are not a multiple of new credits {}",
                    self.credits_per_user, new_credits,
                ));
            }

            // Protect against creating invite and setting to 0 without usage
            if new_credits == 0 && self.joined_user_ids.is_empty() {
                return Err("cannot set credits to 0 as it has never been used".into());
            }

            self.credits = new_credits;
        }

        self.realm_id = optional(realm_id.unwrap_or_default());

        Ok(())
    }
}

pub fn invites_by_principal(
    state: &State,
    principal: Principal,
) -> Box<dyn Iterator<Item = (&'_ String, &'_ Invite)> + '_> {
    match state.principal_to_user(principal).map(|user| {
        state
            .invite_codes
            .iter()
            .filter(move |(_, invite)| invite.inviter_user_id == user.id)
    }) {
        Some(iter) => Box::new(iter),
        _ => Box::new(std::iter::empty()),
    }
}

/// Check allocated credits in invites do not exceed user's credits balance.
/// Protects against creating infinite number of invites.
pub fn validate_user_invites_credits(
    state: &State,
    user: &User,
    new_credits: Credits,
    old_credits: Option<Credits>,
) -> Result<(), String> {
    let total_invites_credits: Credits = state
        .invite_codes
        .values()
        .filter(|invite| invite.inviter_user_id == user.id)
        .map(|invite| invite.credits)
        .sum();

    let total_with_diff = total_invites_credits
        .checked_add(new_credits)
        .ok_or("invite credits overflow")?
        .checked_sub(old_credits.unwrap_or_default())
        .ok_or("invite credits underflow")?;

    if total_with_diff > user.credits() {
        return Err(format!(
            "not enough credits available: {} (needed for invites: {})",
            user.credits(),
            total_with_diff
        ));
    }

    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use crate::{
        mutate,
        tests::{create_user, pr},
    };

    use super::*;

    #[test]
    fn test_invite_validation() {
        mutate(|state| {
            let user_id = create_user(state, pr(0));

            state.invite_codes.insert(
                "foo".into(),
                Invite {
                    credits: 500,
                    ..Default::default()
                },
            );
            state.invite_codes.insert(
                "bar".into(),
                Invite {
                    credits: 490,
                    ..Default::default()
                },
            );

            let user = state.users.get(&user_id).unwrap();
            assert_eq!(user.credits(), 1000);

            assert_eq!(
                validate_user_invites_credits(state, user, 1100, None),
                Err("not enough credits available: 1000 (needed for invites: 2090)".into())
            );

            assert_eq!(
                validate_user_invites_credits(state, user, 100, Some(2000)),
                Err("invite credits underflow".into())
            );

            assert_eq!(
                validate_user_invites_credits(state, user, 100, Some(1)),
                Err("not enough credits available: 1000 (needed for invites: 1089)".into())
            );
        })
    }
}
