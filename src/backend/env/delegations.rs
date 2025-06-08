use candid::Principal;

use super::{State, Time};

/// Sets a session principal for a user.
pub fn set_delegation(
    state: &mut State,
    domain: String,
    caller: Principal,
    session_principal: String,
    now: Time,
) -> Result<(), String> {
    if state.principal_to_user(caller).is_none() {
        return Err("user not found".into());
    }
    if !state.domains.contains_key(&domain) {
        return Err("domain not found".into());
    }

    state.delegations.insert(
        Principal::from_text(session_principal)
            .map_err(|err| format!("couldn't parse the principal id: {err}"))?,
        (caller, domain, now),
    );
    Ok(())
}

/// Returns the delegate principal if one exists
pub fn resolve_delegation(state: &State, caller: Principal) -> Option<Principal> {
    state
        .delegations
        .get(&caller)
        .map(|(principal, _, _)| principal)
        .copied()
}

#[cfg(test)]
mod tests {
    use crate::{
        env::{DomainConfig, WEEK},
        mutate,
        tests::{create_user, pr},
        time,
    };

    use super::*;

    #[test]
    fn test_delegations() {
        mutate(|state| {
            state.init();

            // Create test users
            let user_principal = pr(1);
            let _user_id = create_user(state, user_principal);

            // Add a test domain
            state
                .domains
                .insert("example.com".into(), DomainConfig::default());

            let session_principal_str =
                "oxkfj-2xe7c-masek-oj56x-wcsp5-lgbu3-wfpc5-qru7s-jxvcm-rcre7-5qe";
            let now = time();

            // Test successful delegation setting
            assert_eq!(
                set_delegation(
                    state,
                    "example.com".to_string(),
                    user_principal,
                    session_principal_str.to_string(),
                    now
                ),
                Ok(())
            );

            // Verify delegation was stored
            let session_principal = Principal::from_text(session_principal_str).unwrap();
            assert_eq!(
                state.delegations.get(&session_principal),
                Some(&(user_principal, "example.com".to_string(), now))
            );

            // Test user not found error
            let unknown_principal = pr(999);
            assert_eq!(
                set_delegation(
                    state,
                    "example.com".to_string(),
                    unknown_principal,
                    "2vxsx-fae".to_string(),
                    now
                ),
                Err("user not found".into())
            );

            // Test domain not found error
            assert_eq!(
                set_delegation(
                    state,
                    "nonexistent.com".to_string(),
                    user_principal,
                    "2vxsx-fae".to_string(),
                    now
                ),
                Err("domain not found".into())
            );

            // Test invalid principal string
            assert_eq!(
                set_delegation(
                    state,
                    "example.com".to_string(),
                    user_principal,
                    "invalid-principal".to_string(),
                    now
                ),
                Err("couldn't parse the principal id: CRC32 check sequence doesn't match with calculated from Principal bytes.".into())
            );

            // Test adding multiple delegations for the same user and domain
            let second_session_principal_str =
                "moluq-v4y5q-vdsa2-a6ht7-wyewl-syua3-wug6l-an6g6-oxchj-tvodw-3ae";

            // Add multiple delegations for the same user and domain
            assert_eq!(
                set_delegation(
                    state,
                    "example.com".to_string(),
                    user_principal,
                    second_session_principal_str.to_string(),
                    now + 100
                ),
                Ok(())
            );

            // Verify both delegations exist (no removal)
            assert!(state.delegations.contains_key(&session_principal));
            let second_session_principal =
                Principal::from_text(second_session_principal_str).unwrap();
            assert!(state.delegations.contains_key(&second_session_principal));

            // Add delegation for different domain
            let different_domain = "other.com";
            state
                .domains
                .insert(different_domain.into(), DomainConfig::default());

            let other_domain_session_str = "opl73-raaaa-aaaag-qcunq-cai";
            assert_eq!(
                set_delegation(
                    state,
                    different_domain.to_string(),
                    user_principal,
                    other_domain_session_str.to_string(),
                    now + 200
                ),
                Ok(())
            );

            // Now add third delegation for original domain
            let third_session_principal_str =
                "wh4r4-dnigk-337yd-ljad7-qoxnm-vtyll-qq4sg-lqmo6-gjci6-7ofva-fae";
            assert_eq!(
                set_delegation(
                    state,
                    "example.com".to_string(),
                    user_principal,
                    third_session_principal_str.to_string(),
                    now + 300
                ),
                Ok(())
            );

            // Verify: all delegations exist (no removal)
            assert!(state.delegations.contains_key(&second_session_principal));
            let third_session_principal =
                Principal::from_text(third_session_principal_str).unwrap();
            assert!(state.delegations.contains_key(&third_session_principal));
            let other_domain_session = Principal::from_text(other_domain_session_str).unwrap();
            assert!(state.delegations.contains_key(&other_domain_session));

            // Test delegation cleanup - add old delegations that should be removed
            let new_now = now + 6 * WEEK;
            let old_time = new_now - (WEEK * 5); // 5 weeks old (should be removed)
            let recent_time = new_now - (WEEK * 2); // 2 weeks old (should be kept)

            let old_session_principal = pr(100);
            let recent_session_principal = pr(101);

            state.delegations.insert(
                old_session_principal,
                (user_principal, "example.com".to_string(), old_time),
            );
            state.delegations.insert(
                recent_session_principal,
                (user_principal, "example.com".to_string(), recent_time),
            );

            // Verify delegations were added
            assert_eq!(state.delegations.len(), 6);

            // Run cleanup
            state.clean_up(new_now);

            // Verify old delegation was removed but recent ones kept
            assert!(!state.delegations.contains_key(&old_session_principal));
            assert!(state.delegations.contains_key(&recent_session_principal));
            assert!(!state.delegations.contains_key(&third_session_principal));
            assert!(!state.delegations.contains_key(&other_domain_session));
            assert!(!state.delegations.contains_key(&session_principal));
            assert!(!state.delegations.contains_key(&second_session_principal));
            assert_eq!(state.delegations.len(), 1);
        });
    }
}
