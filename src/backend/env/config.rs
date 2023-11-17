use std::collections::BTreeMap;

use crate::token::Token;

use super::{Cycles, Karma};
use candid::CandidType;
use serde::Serialize;

pub const ICP_CYCLES_PER_XDR: u64 = 1_000_000_000_000;

#[derive(CandidType, Serialize)]
pub struct Config {
    pub name: &'static str,
    pub domains: &'static [&'static str],
    pub logo: &'static str,
    pub staging: &'static str,

    pub transaction_fee: u64,
    pub cycle_transaction_fee: u64,
    pub token_decimals: u8,
    pub token_symbol: &'static str,
    pub total_supply: Token,

    pub native_cycles_per_xdr: Cycles,

    pub individual_minting_threshold_percentage: u64,
    pub minting_threshold_percentage: u64,

    pub min_treasury_balance_xdrs: u64,

    pub supply_threshold_for_transfer_percentage: u64,

    pub karma_donation_decline_percentage: u32,

    pub proposal_approval_threshold: u16,
    pub proposal_controversy_threashold: u16,
    pub proposal_rejection_penalty: Cycles,
    pub min_stalwart_karma: Karma,

    pub max_cycles_mint_kilos: u64,

    pub dao_realm: &'static str,

    pub min_cycle_balance_main: u64,

    pub max_bucket_size: u64,

    pub max_posts_per_hour: u8,
    pub max_comments_per_hour: u8,

    pub feed_page_size: usize,

    pub reporting_penalty_post: Cycles,
    pub reporting_penalty_misbehaviour: Cycles,

    pub minimal_tip: Cycles,

    pub num_hot_posts: usize,

    pub trusted_user_min_karma: Karma,
    pub trusted_user_min_age_weeks: u64,

    pub post_cost: Cycles,
    pub tag_cost: Cycles,
    pub blob_cost: Cycles,
    pub poll_cost: Cycles,
    pub realm_cost: Cycles,

    pub poll_revote_deadline_hours: u64,

    pub name_change_cost: Cycles,

    pub max_realm_name: usize,
    pub max_realm_logo_len: usize,

    pub realm_cleanup_penalty: Cycles,

    pub response_reward: Cycles,

    pub inactivity_penalty: Cycles,
    pub inactivity_duration_weeks: u64,

    pub voting_reward: Cycles,

    // top x percentage of users selected as stalwarts
    pub stalwart_percentage: usize,
    pub min_stalwart_activity_weeks: u8,
    pub min_stalwart_account_age_weeks: u8,
    pub stalwart_moderation_reward: Cycles,

    // percentage of stalwarts needed to confirm a report
    pub report_confirmation_percentage: u16,

    pub hot_post_engagement_percentage: f32,

    pub max_post_length: usize,
    pub max_tag_length: usize,
    pub max_user_info_length: usize,
    pub max_blob_size_bytes: usize,

    pub min_cycles_for_inviting: Cycles,
    pub invites_budget_cycles: Cycles,

    pub online_activity_minutes: u64,

    pub revenue_share_activity_weeks: u64,
    pub voting_power_activity_weeks: u64,

    pub reactions: &'static [(u16, i64)],

    pub min_positive_reaction_id: u16,

    pub reaction_fee: Cycles,

    pub max_funding_amount: u64,

    pub post_deletion_penalty_factor: u32,

    pub bootstrap_phase_user_number: u32,

    #[serde(with = "string")]
    pub neuron_id: u64,
}

mod string {
    use serde::Serializer;
    use std::fmt::Display;

    pub fn serialize<T, S>(value: &T, serializer: S) -> Result<S::Ok, S::Error>
    where
        T: Display,
        S: Serializer,
    {
        serializer.collect_str(value)
    }
}

pub const CONFIG: &Config = &Config {
    name: "Taggr",
    domains: &[
        "taggr.link",
        "taggr.network",
        "taggr.club",
        "taggr.top",
        "taggr.blog",
        "taggr.wtf",
    ],
    logo: include_str!("../../frontend/assets/logo.min.svg"),
    staging: "e4i5g-biaaa-aaaao-ai7ja-cai.icp0.io",

    #[cfg(not(feature = "staging"))]
    token_symbol: "TAGGR",
    #[cfg(feature = "staging")]
    token_symbol: "STAGG",
    token_decimals: 2,
    transaction_fee: 25,
    cycle_transaction_fee: 1,

    native_cycles_per_xdr: 1000,

    min_treasury_balance_xdrs: 38, // ~$50

    individual_minting_threshold_percentage: 1,
    minting_threshold_percentage: 5,

    max_cycles_mint_kilos: 10,

    #[cfg(not(feature = "dev"))]
    bootstrap_phase_user_number: 25,
    #[cfg(feature = "dev")]
    bootstrap_phase_user_number: 0,

    #[cfg(not(any(feature = "dev", feature = "staging")))]
    supply_threshold_for_transfer_percentage: 20,
    #[cfg(feature = "staging")]
    supply_threshold_for_transfer_percentage: 0,
    #[cfg(feature = "dev")]
    supply_threshold_for_transfer_percentage: 10,

    karma_donation_decline_percentage: 15,

    dao_realm: "DAO",

    #[cfg(feature = "dev")]
    proposal_approval_threshold: 1,
    #[cfg(not(feature = "dev"))]
    proposal_approval_threshold: 66,
    proposal_controversy_threashold: 10,

    #[cfg(not(feature = "staging"))]
    proposal_rejection_penalty: 500,
    #[cfg(feature = "staging")]
    proposal_rejection_penalty: 50,

    #[cfg(not(feature = "staging"))]
    min_stalwart_karma: 1000,
    #[cfg(feature = "staging")]
    min_stalwart_karma: 300,

    total_supply: 100_000_000,

    min_cycle_balance_main: 2 * ICP_CYCLES_PER_XDR,

    num_hot_posts: 10000,

    #[cfg(feature = "dev")]
    report_confirmation_percentage: 1,
    #[cfg(test)]
    report_confirmation_percentage: 15,
    #[cfg(not(any(test, feature = "dev")))]
    report_confirmation_percentage: 20,

    trusted_user_min_karma: 25,

    #[cfg(not(feature = "staging"))]
    trusted_user_min_age_weeks: 4,
    #[cfg(feature = "staging")]
    trusted_user_min_age_weeks: 1,

    minimal_tip: 1,

    realm_cleanup_penalty: 10,

    max_bucket_size: 1024 * 1024 * 1024 * 48, // 48Gb

    #[cfg(feature = "dev")]
    max_posts_per_hour: 15,
    #[cfg(not(feature = "dev"))]
    max_posts_per_hour: 3,
    max_comments_per_hour: 15,

    feed_page_size: 30,

    reporting_penalty_post: 200,
    reporting_penalty_misbehaviour: 1000,

    min_cycles_for_inviting: 50,
    invites_budget_cycles: 300,

    post_cost: 2,
    tag_cost: 3,
    blob_cost: 10,
    poll_cost: 3,
    realm_cost: 1000,

    poll_revote_deadline_hours: 4,

    name_change_cost: 1000,

    max_realm_name: 12,
    max_realm_logo_len: 16 * 1024,

    post_deletion_penalty_factor: 10,

    voting_reward: 5,

    response_reward: 1,

    inactivity_penalty: 45,
    inactivity_duration_weeks: 26,
    revenue_share_activity_weeks: 2,
    voting_power_activity_weeks: 8,

    stalwart_percentage: 3,
    #[cfg(feature = "staging")]
    min_stalwart_activity_weeks: 1,
    #[cfg(not(feature = "staging"))]
    min_stalwart_activity_weeks: 6,

    #[cfg(feature = "staging")]
    min_stalwart_account_age_weeks: 1,
    #[cfg(not(feature = "staging"))]
    min_stalwart_account_age_weeks: 26,

    stalwart_moderation_reward: 20,

    hot_post_engagement_percentage: 0.01,

    max_post_length: 15000,
    max_tag_length: 30,
    max_user_info_length: 500,
    max_blob_size_bytes: 460800,

    online_activity_minutes: 10 * 60000000000_u64,

    reactions: &[(1, -3), (100, 10), (50, 5), (51, 5), (10, 1)],

    min_positive_reaction_id: 10,

    reaction_fee: 1,

    max_funding_amount: 2_000_000, // at ratio 1:1

    neuron_id: 16737374299031693047,
};

pub fn reaction_karma() -> BTreeMap<u16, Karma> {
    CONFIG
        .reactions
        .iter()
        .fold(BTreeMap::default(), |mut acc, (id, karma)| {
            acc.insert(*id, *karma);
            acc
        })
}
