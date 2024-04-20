use super::user::UserId;
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Report {
    pub reporter: UserId,
    pub confirmed_by: Vec<UserId>,
    pub rejected_by: Vec<UserId>,
    pub closed: bool,
    pub reason: String,
    #[serde(default)]
    pub timestamp: Time,
}

pub enum ReportState {
    Open,
    Confirmed,
    Rejected,
}

impl Report {
    pub fn rejected(&self) -> bool {
        self.confirmed_by.len() < self.rejected_by.len()
    }

    pub fn pending_or_recently_confirmed(&self) -> bool {
        !self.closed
            || !self.rejected() && self.timestamp + CONFIG.user_report_validity_days * DAY >= time()
    }

    pub fn vote(
        &mut self,
        stalwarts: usize,
        stalwart: UserId,
        confirmed: bool,
    ) -> Result<ReportState, String> {
        if self.closed {
            return Err("report is already closed".into());
        }
        if stalwart == self.reporter
            || self.confirmed_by.contains(&stalwart)
            || self.rejected_by.contains(&stalwart)
        {
            return Err(
                "you can't vote on this report becasue you created it or voted already".into(),
            );
        }
        if confirmed {
            self.confirmed_by.push(stalwart);
        } else {
            self.rejected_by.push(stalwart);
        }
        let votes = self.confirmed_by.len().max(self.rejected_by.len()) as u16;
        Ok(
            if votes * 100 >= CONFIG.report_confirmation_percentage * stalwarts as u16 {
                self.closed = true;
                if self.rejected() {
                    ReportState::Rejected
                } else {
                    ReportState::Confirmed
                }
            } else {
                ReportState::Open
            },
        )
    }
}

pub fn finalize_report(
    state: &mut State,
    report: &Report,
    domain: &str,
    penalty: Credits,
    user_id: UserId,
    subject: String,
) -> Result<(), String> {
    let mut confirmed_user_report = false;
    let (sponsor_id, unit) = if report.confirmed_by.len() > report.rejected_by.len() {
        // penalty for the user
        let user = state.users.get_mut(&user_id).ok_or("no user found")?;
        user.change_rewards(
            -(penalty as i64),
            format!("moderation penalty for {}", subject),
        );
        user.stalwart = false;
        user.active_weeks = 0;
        let unit = penalty.min(user.credits()) / 2;
        let reporter = state
            .users
            .get_mut(&report.reporter)
            .ok_or("no user found")?;
        reporter.notify(format!(
            "Your report for {} was confirmed by stalwarts. Thanks for keeping {} safe and clean!",
            subject, CONFIG.name
        ));
        state
            .credit_transfer(
                user_id,
                report.reporter,
                unit,
                0,
                Destination::Rewards,
                format!("moderation rewards for {}", subject),
                None,
            )
            .map_err(|err| format!("couldn't reward reporter: {}", err))?;
        confirmed_user_report = domain == "misbehaviour";
        state.logger.info(format!(
            "Report of {} was confirmed by `{}%` of stalwarts: {}",
            subject, CONFIG.report_confirmation_percentage, &report.reason
        ));
        (user_id, unit)
    } else {
        // penalty for reporter
        let reporter = state
            .users
            .get_mut(&report.reporter)
            .ok_or("no user found")?;
        reporter.notify(format!(
            "Your report of {} was rejected by stalwarts",
            subject
        ));
        let unit = penalty.min(reporter.credits());
        let log = format!("false report penalty for {}", subject);
        reporter.change_rewards(-(penalty as i64), log);
        let reporter_id = reporter.id;
        (reporter_id, unit)
    };
    let stalwarts = report
        .confirmed_by
        .iter()
        .chain(report.rejected_by.iter())
        .cloned()
        .collect::<Vec<_>>();
    let stalwart_reward = (unit / stalwarts.len() as u64).min(CONFIG.stalwart_moderation_reward);
    let mut total_stalwart_rewards = 0;
    let log = &format!("stalwarts moderation rewards for {}", subject);
    for stalwart_id in stalwarts.iter() {
        let moderator = state.users.get(stalwart_id).expect("no user found").id;
        state
            .credit_transfer(
                sponsor_id,
                moderator,
                stalwart_reward,
                0,
                Destination::Rewards,
                log,
                None,
            )
            .map_err(|err| format!("couldn't reward stalwarts: {}", err))?;
        total_stalwart_rewards += stalwart_reward;
    }
    if unit > total_stalwart_rewards {
        state
            .charge(
                sponsor_id,
                unit.saturating_sub(total_stalwart_rewards),
                format!("moderation penalty for {}", subject),
            )
            .expect("couldn't charge user");
    }
    state.denotify_users(&|u| u.stalwart);
    let user = state.users.get(&user_id).ok_or("no user found")?;
    if confirmed_user_report && user.credits() > 0 {
        state.charge(user_id, user.credits(), "penalty for misbehaviour")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::{env::tests::*, mutate};

    #[test]
    fn test_reporting() {
        mutate(|state| {
            let p = pr(0);
            let u1 = create_user(state, p);
            let user = state.users.get_mut(&u1).unwrap();
            user.change_rewards(100, "");

            assert_eq!(user.notifications.len(), 1);
            assert_eq!(user.credits(), 1000);
            assert_eq!(user.rewards(), 100);

            for i in 1..20 {
                let id = create_user(state, pr(i));
                let user = state.users.get_mut(&id).unwrap();
                user.stalwart = true;
            }

            let reporter = pr(7);
            let user = state.principal_to_user_mut(reporter).unwrap();
            user.change_credits(1000, CreditsDelta::Plus, "").unwrap();

            let post_id =
                Post::create(state, "bad post".to_string(), &[], p, 0, None, None, None).unwrap();

            let user = state.users.get(&u1).unwrap();
            assert_eq!(user.credits(), 1000 - CONFIG.post_cost);

            let p = Post::get(state, &post_id).unwrap();
            assert!(p.report.is_none());

            assert_eq!(user.credits(), 1000 - CONFIG.post_cost);
            // The reporter can only be a user with at least one post.
            let _ = Post::create(
                state,
                "some post".to_string(),
                &[],
                pr(7),
                0,
                None,
                None,
                None,
            );

            assert_eq!(
                state.report(reporter, "post".into(), post_id, String::new()),
                Err("no reports with low token balance".into())
            );

            state.minting_mode = true;
            token::mint(state, account(reporter), CONFIG.transaction_fee * 1000);
            state.minting_mode = false;
            let reporter_user = state.principal_to_user_mut(reporter).unwrap();
            assert_eq!(reporter_user.balance, CONFIG.transaction_fee * 1000);

            // report should work becasue the user needs 500 credits
            let reporter_user = state.principal_to_user_mut(reporter).unwrap();
            assert_eq!(reporter_user.credits(), 1998);
            reporter_user
                .change_credits(1998, CreditsDelta::Minus, "")
                .unwrap();
            assert_eq!(reporter_user.credits(), 0);
            assert_eq!(
                state.report(reporter, "post".into(), post_id, String::new()),
                Err("at least 100 credits needed for this report".into())
            );
            let p = Post::get(state, &post_id).unwrap();
            assert!(&p.report.is_none());

            let reporter_user = state.principal_to_user_mut(reporter).unwrap();
            reporter_user
                .change_credits(1000, CreditsDelta::Plus, "")
                .unwrap();
            assert_eq!(reporter_user.credits(), 1000);
            state
                .report(reporter, "post".into(), post_id, String::new())
                .unwrap();

            let post_author = state.principal_to_user_mut(pr(0)).unwrap();
            assert!(post_author.post_reports.contains_key(&post_id));

            // make sure the reporter is correct
            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert!(report.reporter == state.principal_to_user(reporter).unwrap().id);

            // Another user cannot overwrite the report
            state.minting_mode = true;
            token::mint(state, account(pr(8)), CONFIG.transaction_fee * 1000);
            state.minting_mode = false;
            assert_eq!(
                state.report(pr(8), "post".into(), post_id, String::new()),
                Err("this post is already reported".into())
            );
            // the reporter is still the same
            assert!(report.reporter == state.principal_to_user(reporter).unwrap().id);

            // stalwart 3 confirmed the report
            state
                .vote_on_report(pr(3), "post".into(), post_id, true)
                .unwrap();
            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 1);
            assert_eq!(report.rejected_by.len(), 0);
            // repeated confirmation is a noop
            assert!(state
                .vote_on_report(pr(3), "post".into(), post_id, true)
                .is_err());
            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 1);
            assert!(!report.closed);

            // stalwart 6 rejected the report
            state
                .vote_on_report(pr(6), "post".into(), post_id, false)
                .unwrap();
            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 1);
            assert_eq!(report.rejected_by.len(), 1);
            assert!(!report.closed);

            // make sure post still exists
            assert_eq!(&p.body, "bad post");

            // stalwarts 12 & 13 confirmed too
            state
                .vote_on_report(pr(12), "post".into(), post_id, true)
                .unwrap();
            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 2);
            assert_eq!(report.rejected_by.len(), 1);

            // stalwart has no karma to reward
            assert_eq!(state.principal_to_user(pr(3)).unwrap().rewards(), 0);

            state
                .vote_on_report(pr(13), "post".into(), post_id, true)
                .unwrap();
            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 3);
            assert_eq!(report.rejected_by.len(), 1);

            // make sure the report is closed and post deleted
            assert!(report.closed);
            assert_eq!(&p.body, "");
            let post_author = state.principal_to_user_mut(pr(0)).unwrap();
            // The report is still pending
            assert!(post_author.post_reports.contains_key(&post_id));

            let user = state.users.get(&u1).unwrap();
            assert_eq!(
                user.credits(),
                1000 - CONFIG.reporting_penalty_post - CONFIG.post_cost
            );
            assert_eq!(user.rewards(), -100);

            let reporter = state.principal_to_user(reporter).unwrap();
            assert_eq!(
                reporter.rewards() as Credits,
                CONFIG.reporting_penalty_post / 2
            );
            // stalwarts rewarded too
            assert_eq!(
                state.principal_to_user(pr(3)).unwrap().rewards() as Credits,
                CONFIG.stalwart_moderation_reward
            );
            assert_eq!(
                state.principal_to_user(pr(6)).unwrap().rewards() as Credits,
                CONFIG.stalwart_moderation_reward
            );
            assert_eq!(
                state.principal_to_user(pr(12)).unwrap().rewards() as Credits,
                CONFIG.stalwart_moderation_reward
            );
        });

        // REJECTION TEST

        mutate(|state| {
            let p = pr(100);
            let u = create_user(state, p);
            let user = state.users.get_mut(&u).unwrap();
            user.change_rewards(100, "");

            let post_id =
                Post::create(state, "good post".to_string(), &[], p, 0, None, None, None).unwrap();

            let user = state.users.get(&u).unwrap();
            assert_eq!(user.credits(), 1000 - CONFIG.post_cost);

            let reporter = pr(7);
            state
                .report(reporter, "post".into(), post_id, String::new())
                .unwrap();
            // set credits to 1777
            let reporter_user = state.principal_to_user_mut(reporter).unwrap();
            reporter_user
                .change_credits(1777 - reporter_user.credits(), CreditsDelta::Plus, "")
                .unwrap();
            assert_eq!(reporter_user.credits(), 1777);
            assert_eq!(reporter_user.rewards(), 100);

            state
                .vote_on_report(pr(6), "post".into(), post_id, false)
                .unwrap();
            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 0);
            assert_eq!(report.rejected_by.len(), 1);
            assert!(!report.closed);
            assert_eq!(&p.body, "good post");

            state
                .vote_on_report(pr(9), "post".into(), post_id, false)
                .unwrap();

            let post_author = state.principal_to_user_mut(pr(100)).unwrap();
            assert!(post_author.post_reports.contains_key(&post_id));

            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 0);
            assert_eq!(report.rejected_by.len(), 2);

            state
                .vote_on_report(pr(10), "post".into(), post_id, false)
                .unwrap();

            let p = Post::get(state, &post_id).unwrap();
            let report = &p.report.clone().unwrap();
            assert_eq!(report.confirmed_by.len(), 0);
            assert_eq!(report.rejected_by.len(), 3);
            assert!(report.closed);

            // report removed from the post
            let post_author = state.principal_to_user_mut(pr(100)).unwrap();
            assert!(!post_author.post_reports.contains_key(&post_id));

            // karma and credits stay untouched
            let user = state.users.get(&u).unwrap();
            assert_eq!(user.credits(), 1000 - CONFIG.post_cost);
            assert_eq!(user.rewards(), 100);

            // reported got penalized
            let reporter = state.principal_to_user(reporter).unwrap();
            let unit = CONFIG.reporting_penalty_post / 2;
            assert_eq!(reporter.credits(), 1777 - 2 * unit);

            assert_eq!(
                state.principal_to_user(pr(9)).unwrap().rewards() as Credits,
                CONFIG.stalwart_moderation_reward
            );
            // he voted twice
            assert_eq!(
                state.principal_to_user(pr(6)).unwrap().rewards() as Credits,
                CONFIG.stalwart_moderation_reward * 2
            );
        })
    }
}
