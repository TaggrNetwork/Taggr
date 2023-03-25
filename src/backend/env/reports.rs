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
}

impl Report {
    pub fn vote(
        &mut self,
        stalwarts: usize,
        stalwart: UserId,
        confirmed: bool,
    ) -> Result<(), String> {
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
        if votes * 100 >= CONFIG.report_confirmation_percentage * stalwarts as u16 {
            self.closed = true;
        }
        Ok(())
    }
}

pub fn finalize_report(
    state: &mut State,
    report: &Report,
    penalty: Cycles,
    user_id: UserId,
    subject: String,
) -> Result<(), String> {
    if !report.closed {
        return Ok(());
    }
    let (sponsor_id, unit) = if report.confirmed_by.len() > report.rejected_by.len() {
        // penalty for the user
        let user = state.users.get_mut(&user_id).ok_or("no user found")?;
        user.notify(format!(
            "Somebody create a report for your {}. Reason: {}",
            subject, report.reason
        ));
        user.change_karma(
            -(penalty as Karma),
            format!("moderation penalty for {}", subject),
        );
        user.stalwart = false;
        user.active_weeks = 0;
        let unit = penalty.min(user.cycles()) / 2;
        let reporter = state
            .users
            .get_mut(&report.reporter)
            .ok_or("no user found")?;
        reporter.notify(format!(
            "Your report for {} was deleted by stalwarts. Thanks for keeping {} safe and clean!",
            subject, CONFIG.name
        ));
        state
            .cycle_transfer(
                user_id,
                report.reporter,
                unit,
                0,
                Destination::Karma,
                format!("moderation rewards for {}", subject),
            )
            .map_err(|err| format!("couldn't reward reporter: {}", err))?;
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
        let unit = penalty.min(reporter.cycles());
        let log = format!("false report penalty for {}", subject);
        reporter.change_karma(-(penalty as Karma) / 2, log);
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
            .cycle_transfer(
                sponsor_id,
                moderator,
                stalwart_reward,
                0,
                Destination::Karma,
                log,
            )
            .map_err(|err| format!("couldn't reward stalwarts: {}", err))?;
        total_stalwart_rewards += stalwart_reward;
    }
    if unit > total_stalwart_rewards {
        state
            .charge(
                sponsor_id,
                unit - total_stalwart_rewards,
                format!("moderation penalty for {}", subject),
            )
            .expect("couldn't charge user");
    }
    state.denotify_users(&|u| u.stalwart);
    Ok(())
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::env::tests::*;
    use crate::post::*;

    #[actix_rt::test]
    async fn test_reporting() {
        let mut state = State::default();

        let p = pr(0);
        let u1 = create_user(&mut state, p);
        let user = state.users.get_mut(&u1).unwrap();
        user.change_karma(100, "");

        assert_eq!(user.inbox.len(), 1);
        assert_eq!(user.cycles(), 1000);
        assert_eq!(user.karma_to_reward(), 100);

        for i in 1..20 {
            let id = create_user(&mut state, pr(i as u8));
            let user = state.users.get_mut(&id).unwrap();
            user.stalwart = true;
        }

        let post_id = add(
            &mut state,
            "bad post".to_string(),
            vec![],
            p,
            0,
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let user = state.users.get(&u1).unwrap();
        assert_eq!(user.cycles(), 1000 - CONFIG.post_cost);

        let p = state.posts.get(&post_id).unwrap();
        assert!(p.report.is_none());

        let reporter = pr(7);
        // The reporter can only be a user with at least one post.
        let _ = add(
            &mut state,
            "some post".to_string(),
            vec![],
            pr(7),
            0,
            None,
            None,
            None,
        )
        .await;

        // report should work becasue theuser needs 500 cycles
        let reporter_user = state.principal_to_user_mut(reporter).unwrap();
        assert_eq!(reporter_user.cycles(), 998);
        reporter_user
            .change_cycles(998, CyclesDelta::Minus, "")
            .unwrap();
        assert_eq!(reporter_user.cycles(), 0);
        assert_eq!(
            state.report(reporter, "post".into(), post_id, String::new()),
            Err("You need at least 100 cycles for this report".into())
        );
        let p = state.posts.get(&post_id).unwrap();
        assert!(&p.report.is_none());

        let reporter_user = state.principal_to_user_mut(reporter).unwrap();
        reporter_user
            .change_cycles(500, CyclesDelta::Plus, "")
            .unwrap();
        assert_eq!(reporter_user.cycles(), 500);
        state
            .report(reporter, "post".into(), post_id, String::new())
            .unwrap();

        // make sure the reporter is correct
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert!(report.reporter == state.principal_to_user(reporter).unwrap().id);

        // Another user cannot overwrite the report
        assert_eq!(
            state.report(pr(8), "post".into(), post_id, String::new()),
            Err("this post is already reported".into())
        );
        // the reporter is stil lthe same
        assert!(report.reporter == state.principal_to_user(reporter).unwrap().id);

        // stalwart 3 confirmed the report
        state
            .vote_on_report(pr(3), "post".into(), post_id, true)
            .unwrap();
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert_eq!(report.confirmed_by.len(), 1);
        assert_eq!(report.rejected_by.len(), 0);
        // repeated confirmation is a noop
        assert!(state
            .vote_on_report(pr(3), "post".into(), post_id, true)
            .is_err());
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert_eq!(report.confirmed_by.len(), 1);
        assert!(!report.closed);

        // stalwart 6 rejected the report
        state
            .vote_on_report(pr(6), "post".into(), post_id, false)
            .unwrap();
        let p = state.posts.get(&post_id).unwrap();
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
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert_eq!(report.confirmed_by.len(), 2);
        assert_eq!(report.rejected_by.len(), 1);

        // stalwart has no karma to reward
        assert_eq!(state.principal_to_user(pr(3)).unwrap().karma_to_reward(), 0);

        state
            .vote_on_report(pr(13), "post".into(), post_id, true)
            .unwrap();
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert_eq!(report.confirmed_by.len(), 3);
        assert_eq!(report.rejected_by.len(), 1);

        // make sure the report is closed and post deleted
        assert!(report.closed);
        assert_eq!(&p.body, "");

        let user = state.users.get(&u1).unwrap();
        assert_eq!(user.inbox.len(), 2);
        assert_eq!(
            user.cycles(),
            1000 - CONFIG.reporting_penalty_post - CONFIG.post_cost
        );
        assert_eq!(user.karma(), -75);

        let reporter = state.principal_to_user(reporter).unwrap();
        assert_eq!(
            reporter.karma_to_reward(),
            CONFIG.reporting_penalty_post as Karma / 2
        );
        // stalwarts rewarded too
        assert_eq!(
            state.principal_to_user(pr(3)).unwrap().karma_to_reward(),
            CONFIG.stalwart_moderation_reward as Karma
        );
        assert_eq!(
            state.principal_to_user(pr(6)).unwrap().karma_to_reward(),
            CONFIG.stalwart_moderation_reward as Karma
        );
        assert_eq!(
            state.principal_to_user(pr(12)).unwrap().karma_to_reward(),
            CONFIG.stalwart_moderation_reward as Karma
        );

        // REJECTION TEST

        let p = pr(100);
        let u = create_user(&mut state, p);
        let user = state.users.get_mut(&u).unwrap();
        user.change_karma(100, "");
        let post_id = add(
            &mut state,
            "good post".to_string(),
            vec![],
            p,
            0,
            None,
            None,
            None,
        )
        .await
        .unwrap();

        let user = state.users.get(&u).unwrap();
        assert_eq!(user.cycles(), 1000 - CONFIG.post_cost);

        let reporter = pr(7);
        state
            .report(reporter, "post".into(), post_id, String::new())
            .unwrap();
        // set cycles to 777
        let reporter_user = state.principal_to_user_mut(reporter).unwrap();
        reporter_user
            .change_cycles(777 - reporter_user.cycles(), CyclesDelta::Plus, "")
            .unwrap();
        assert_eq!(reporter_user.cycles(), 777);
        reporter_user.apply_rewards();
        assert_eq!(reporter_user.karma(), 125);

        state
            .vote_on_report(pr(6), "post".into(), post_id, false)
            .unwrap();
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert_eq!(report.confirmed_by.len(), 0);
        assert_eq!(report.rejected_by.len(), 1);
        assert!(!report.closed);
        assert_eq!(&p.body, "good post");

        state
            .vote_on_report(pr(9), "post".into(), post_id, false)
            .unwrap();
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert_eq!(report.confirmed_by.len(), 0);
        assert_eq!(report.rejected_by.len(), 2);

        state
            .vote_on_report(pr(10), "post".into(), post_id, false)
            .unwrap();
        let p = state.posts.get(&post_id).unwrap();
        let report = &p.report.clone().unwrap();
        assert_eq!(report.confirmed_by.len(), 0);
        assert_eq!(report.rejected_by.len(), 3);
        assert!(report.closed);

        // karma and cycles stay untouched
        let user = state.users.get(&u).unwrap();
        assert_eq!(user.cycles(), 1000 - CONFIG.post_cost);
        assert_eq!(user.karma_to_reward(), 100);

        // reported got penalized
        let reporter = state.principal_to_user(reporter).unwrap();
        let unit = CONFIG.reporting_penalty_post / 2;
        assert_eq!(reporter.cycles(), 777 - 2 * unit);
        assert_eq!(reporter.karma(), 25);

        assert_eq!(
            state.principal_to_user(pr(9)).unwrap().karma_to_reward(),
            CONFIG.stalwart_moderation_reward as Karma
        );
        // he voted twice
        assert_eq!(
            state.principal_to_user(pr(6)).unwrap().karma_to_reward(),
            CONFIG.stalwart_moderation_reward as Karma * 2
        );
    }
}
