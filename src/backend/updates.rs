use crate::env::{token::account, user::UserFilter};

use super::*;
use env::{
    canisters::get_full_neuron,
    config::CONFIG,
    parse_amount,
    post::{Extension, Post, PostId},
    proposals::{Release, Reward},
    user::{Draft, User, UserId},
    State,
};
use ic_cdk::{
    api::{
        self,
        call::{arg_data_raw, reply_raw},
    },
    spawn,
};
use ic_cdk_macros::{init, post_upgrade, pre_upgrade, update};
use ic_cdk_timers::{set_timer, set_timer_interval};
use ic_ledger_types::{AccountIdentifier, Tokens};
use serde_bytes::ByteBuf;
use std::time::Duration;

#[init]
fn init() {
    mutate(|state| {
        state.load();
        state.last_weekly_chores = time();
        state.last_daily_chores = time();
        state.last_hourly_chores = time();
    });
    set_timer(Duration::from_millis(0), || {
        spawn(State::fetch_xdr_rate());
    });
    set_timer_interval(Duration::from_secs(15 * 60), || {
        spawn(State::chores(api::time()))
    });
}

#[pre_upgrade]
fn pre_upgrade() {
    mutate(env::memory::heap_to_stable)
}

#[post_upgrade]
fn post_upgrade() {
    // This should prevent accidental deployments of dev or staging releases.
    #[cfg(any(feature = "dev", feature = "staging"))]
    {
        let ids: &str = include_str!("../../canister_ids.json");
        if ids.contains(&format!("\"ic\": \"{}\"", &api::id().to_string())) {
            panic!("dev or staging feature is enabled!")
        }
    }
    stable_to_heap_core();
    mutate(|state| state.load());
    set_timer_interval(Duration::from_secs(15 * 60), || {
        spawn(State::chores(api::time()))
    });
    set_timer(
        Duration::from_millis(0),
        || spawn(State::finalize_upgrade()),
    );

    // post upgrade logic goes here
    set_timer(Duration::from_millis(0), move || {
        spawn(post_upgrade_fixtures());
        spawn(post_upgrade_fixtures2());
    });
}

async fn post_upgrade_fixtures2() {
    // create hashtag index
    mutate(|state| {
        state.posts_with_tags = (0..state.next_post_id)
            .filter_map(|post_id| Post::get(state, &post_id))
            .filter_map(|post| (!post.tags.is_empty()).then_some(post.id))
            .collect();

        for realm_id in &["WEED", "FIREARMS", "ONLYFANSHUB", "DRINKS", "BEAUTY"] {
            state
                .realms
                .get_mut(&realm_id.to_string())
                .unwrap()
                .adult_content = true;
        }
    })
}

async fn post_upgrade_fixtures() {
    // restore minting
    mutate(|state| {
        let base = token::base();
        state.minting_mode = true;
        for (user_id, tokens) in &[
            (8, 16834),
            (0, 16717),
            (57, 15584),
            (305, 15024),
            (759, 13906),
            (1310, 13446),
            (2525, 13198),
            (582, 10556),
            (2011, 10300),
            (413, 10152),
            (51, 10011),
            (2734, 9723),
            (599, 9573),
            (430, 9516),
            (2143, 9379),
            (1545, 9272),
            (1221, 8747),
            (2751, 8607),
            (377, 8084),
            (1797, 7869),
            (1788, 7828),
            (176, 7741),
            (1129, 7734),
            (2105, 7286),
            (67, 7263),
            (1667, 6551),
            (1475, 6538),
            (1442, 6367),
            (1121, 6205),
            (1854, 5934),
            (1773, 5783),
            (1873, 5773),
            (1334, 5444),
            (829, 5404),
            (1133, 5397),
            (1560, 5375),
            (1529, 5324),
            (871, 5067),
            (2582, 4961),
            (3225, 4761),
            (2685, 4717),
            (210, 4702),
            (2768, 4623),
            (2002, 4558),
            (3186, 4503),
            (1651, 4264),
            (926, 4160),
            (1818, 4044),
            (2434, 3942),
            (14, 3887),
            (7, 3856),
            (590, 3780),
            (2286, 3718),
            (1968, 3685),
            (2552, 3683),
            (209, 3624),
            (1464, 3616),
            (1523, 3555),
            (2282, 3541),
            (2750, 3467),
            (332, 3465),
            (2910, 3414),
            (2161, 3397),
            (791, 3369),
            (1270, 3353),
            (2280, 3331),
            (1191, 3312),
            (3349, 3280),
            (1734, 3208),
            (1730, 3146),
            (2354, 3113),
            (1621, 3082),
            (1774, 3029),
            (2128, 3001),
            (1277, 2899),
            (3063, 2826),
            (2410, 2825),
            (455, 2819),
            (760, 2817),
            (1453, 2778),
            (1400, 2746),
            (99, 2718),
            (1397, 2571),
            (1363, 2567),
            (1710, 2549),
            (1486, 2509),
            (1353, 2485),
            (2524, 2438),
            (2245, 2436),
            (3315, 2412),
            (1376, 2402),
            (1432, 2316),
            (2429, 2235),
            (2530, 2224),
            (1031, 2220),
            (458, 2203),
            (563, 2196),
            (1588, 2178),
            (490, 2175),
            (3059, 2172),
            (1644, 2155),
            (2802, 2148),
            (757, 2146),
            (2866, 2142),
            (1645, 2064),
            (2278, 2013),
            (426, 1992),
            (2617, 1992),
            (1243, 1965),
            (1727, 1961),
            (3276, 1952),
            (2401, 1950),
            (2378, 1945),
            (381, 1937),
            (2427, 1924),
            (2014, 1887),
            (2586, 1887),
            (2279, 1726),
            (1922, 1718),
            (1479, 1700),
            (2076, 1681),
            (2640, 1677),
            (1526, 1658),
            (2325, 1640),
            (1562, 1639),
            (308, 1632),
            (528, 1622),
            (3233, 1614),
            (2376, 1580),
            (1169, 1563),
            (2504, 1558),
            (1815, 1552),
            (2760, 1552),
            (1478, 1533),
            (1917, 1521),
            (714, 1511),
            (1272, 1509),
            (3229, 1504),
            (2749, 1443),
            (2954, 1419),
            (2979, 1397),
            (2234, 1391),
            (2786, 1390),
            (1254, 1371),
            (2875, 1358),
            (185, 1352),
            (3532, 1326),
            (3409, 1307),
            (2895, 1296),
            (2055, 1282),
            (2550, 1276),
            (523, 1271),
            (1587, 1264),
            (2903, 1261),
            (2729, 1241),
            (1561, 1238),
            (2804, 1197),
            (1095, 1195),
            (1618, 1190),
            (515, 1167),
            (2110, 1160),
            (2086, 1147),
            (1276, 1128),
            (3053, 1107),
            (609, 1104),
            (1585, 1100),
            (1589, 1083),
            (3006, 1057),
            (2408, 1053),
            (3103, 1050),
            (1897, 1042),
            (3287, 1041),
            (3040, 1040),
            (124, 1031),
            (1778, 1008),
            (431, 1003),
            (1359, 967),
            (1880, 964),
            (2496, 962),
            (1650, 954),
            (1167, 953),
            (3069, 942),
            (2081, 936),
            (3000, 923),
            (1726, 915),
            (3332, 890),
            (2746, 887),
            (1620, 880),
            (2597, 841),
            (3255, 831),
            (3208, 823),
            (2446, 817),
            (2774, 813),
            (2781, 811),
            (1251, 793),
            (2957, 792),
            (2135, 789),
            (170, 783),
            (2996, 781),
            (3250, 780),
            (2071, 776),
            (1869, 768),
            (1766, 767),
            (2921, 757),
            (2259, 739),
            (2752, 729),
            (749, 728),
            (1920, 724),
            (1870, 711),
            (3192, 707),
            (763, 698),
            (3050, 693),
            (2147, 690),
            (2563, 690),
            (1193, 688),
            (39, 680),
            (1953, 662),
            (3060, 648),
            (1521, 646),
            (3483, 644),
            (2397, 643),
            (3198, 638),
            (3145, 637),
            (2460, 631),
            (2628, 629),
            (2889, 628),
            (3369, 608),
            (3162, 594),
            (18, 581),
            (1961, 579),
            (783, 577),
            (3302, 568),
            (3413, 568),
            (3416, 568),
            (3460, 568),
            (3461, 568),
            (1816, 564),
            (2295, 558),
            (1899, 557),
            (1952, 550),
            (869, 549),
            (1409, 548),
            (2423, 542),
            (3009, 542),
            (3044, 541),
            (877, 540),
            (2090, 534),
            (2969, 531),
            (2888, 525),
            (3204, 524),
            (173, 519),
            (3264, 512),
            (1467, 497),
            (3320, 497),
            (2600, 494),
            (943, 493),
            (1336, 491),
            (1457, 491),
            (1090, 490),
            (2657, 487),
            (1466, 480),
            (3324, 480),
            (2949, 479),
            (1380, 473),
            (2442, 467),
            (1837, 463),
            (2950, 461),
            (1534, 442),
            (1751, 441),
            (2874, 436),
            (2313, 426),
            (3153, 423),
            (1832, 412),
            (1492, 407),
            (3150, 404),
            (3058, 402),
            (3080, 399),
            (3429, 383),
            (3322, 382),
            (1567, 381),
            (2735, 381),
            (2302, 376),
            (2634, 375),
            (2626, 372),
            (2833, 371),
            (2675, 370),
            (2728, 345),
            (2882, 339),
            (1443, 336),
            (3279, 325),
            (2819, 320),
            (2784, 315),
            (3285, 314),
            (2449, 312),
            (3056, 311),
            (3451, 311),
            (3502, 307),
            (2095, 303),
            (2762, 303),
            (2237, 300),
            (2635, 300),
            (2092, 298),
            (3071, 296),
            (2194, 294),
            (1847, 288),
            (1912, 288),
            (2523, 288),
            (2385, 276),
            (1716, 272),
            (1851, 268),
            (813, 261),
            (3468, 261),
            (172, 254),
            (2149, 252),
            (2254, 252),
            (2428, 249),
            (2851, 247),
            (2592, 246),
            (1343, 240),
            (2951, 239),
            (2126, 233),
            (3528, 233),
            (1875, 228),
            (726, 226),
            (1356, 226),
            (1656, 226),
            (3020, 218),
            (3202, 217),
            (2029, 216),
            (3425, 214),
            (1537, 213),
            (484, 212),
            (2431, 211),
            (3215, 210),
            (2611, 209),
            (2570, 198),
            (3159, 197),
            (1595, 194),
            (1761, 191),
            (1673, 189),
            (3290, 189),
            (456, 186),
            (887, 181),
            (2966, 180),
            (1420, 178),
            (3048, 177),
            (1454, 174),
            (1731, 174),
            (1189, 173),
            (2463, 165),
            (1958, 162),
            (1956, 159),
            (2952, 159),
            (1147, 158),
            (1809, 150),
            (1850, 150),
            (2364, 150),
            (3405, 150),
            (1154, 148),
            (3463, 147),
            (2334, 146),
            (3098, 145),
            (1848, 143),
            (3065, 140),
            (3039, 139),
            (2807, 133),
            (1431, 130),
            (2742, 124),
            (519, 122),
            (1333, 113),
            (2911, 111),
            (818, 110),
            (3203, 108),
            (2490, 107),
            (253, 106),
            (3440, 105),
            (97, 104),
            (2907, 104),
            (3326, 104),
            (2439, 102),
            (3256, 101),
            (379, 100),
            (3025, 100),
            (3280, 100),
            (1149, 98),
            (1553, 97),
            (2363, 97),
            (1955, 96),
            (3113, 96),
            (1550, 94),
            (2573, 94),
            (2607, 91),
            (3365, 91),
            (3236, 89),
            (2418, 88),
            (2474, 88),
            (2661, 88),
            (428, 86),
            (1591, 86),
            (1282, 82),
            (2268, 82),
            (2452, 82),
            (140, 79),
            (311, 79),
            (1349, 78),
            (3472, 78),
            (32, 77),
            (2643, 77),
            (3470, 77),
            (2241, 75),
            (2139, 73),
            (2857, 73),
            (3074, 73),
            (3107, 73),
            (2654, 71),
            (3014, 71),
            (3511, 71),
            (1838, 70),
            (2886, 70),
            (2344, 66),
            (2839, 65),
            (1742, 63),
            (3397, 63),
            (3547, 63),
            (2091, 62),
            (2561, 62),
            (3495, 59),
            (1510, 57),
            (2689, 57),
            (3193, 57),
            (3084, 55),
            (3094, 55),
            (3396, 55),
            (3504, 52),
            (509, 51),
            (2546, 51),
            (2924, 51),
            (3471, 51),
            (2705, 50),
            (2771, 50),
            (929, 49),
            (2096, 49),
            (2403, 49),
            (1364, 46),
            (3194, 46),
            (1886, 45),
            (3267, 45),
            (2982, 44),
            (1489, 43),
            (3161, 43),
            (2642, 41),
            (3400, 40),
            (3426, 40),
            (1728, 38),
            (1494, 36),
            (1801, 36),
            (2015, 36),
            (3199, 35),
            (169, 33),
            (2904, 32),
            (3206, 32),
            (3486, 32),
            (2766, 31),
            (996, 30),
            (2644, 29),
            (3218, 29),
            (876, 28),
            (1556, 28),
            (2314, 28),
            (358, 26),
            (231, 25),
            (1350, 25),
            (3210, 25),
            (3478, 25),
            (1223, 24),
            (1462, 24),
            (2315, 24),
            (3166, 24),
            (1332, 23),
            (1704, 23),
            (2137, 22),
            (2448, 22),
            (2467, 21),
            (3097, 21),
            (1441, 20),
            (3160, 20),
            (511, 19),
            (1419, 19),
            (1779, 19),
            (2253, 19),
            (3371, 19),
            (1242, 18),
            (3004, 18),
            (3120, 18),
            (3355, 18),
            (646, 16),
            (2204, 16),
            (2324, 16),
            (2499, 16),
            (3147, 16),
            (89, 15),
            (1659, 15),
            (3163, 15),
            (3388, 15),
            (368, 14),
            (1168, 14),
            (2178, 14),
            (970, 13),
            (1658, 13),
            (2881, 12),
            (3474, 12),
            (3514, 12),
            (2346, 11),
            (2652, 11),
            (2680, 11),
            (3078, 11),
            (3200, 11),
            (3428, 11),
            (2488, 10),
            (3239, 10),
            (3381, 10),
            (190, 9),
            (1135, 9),
            (1871, 9),
            (3262, 9),
            (3403, 9),
            (3430, 9),
            (3544, 9),
            (3152, 8),
            (3363, 8),
            (1059, 7),
            (2261, 7),
            (2608, 7),
            (2646, 7),
            (3003, 7),
            (3101, 7),
            (3116, 7),
            (3211, 7),
            (3213, 7),
            (3261, 7),
            (3303, 7),
            (3395, 7),
            (3457, 7),
            (3507, 7),
            (1271, 6),
            (1388, 6),
            (1927, 6),
            (2465, 6),
            (2572, 6),
            (3182, 6),
            (3232, 6),
            (761, 5),
            (1217, 5),
            (3234, 5),
            (1339, 4),
            (1512, 4),
            (2208, 4),
            (2240, 4),
            (2406, 4),
            (2719, 4),
            (2879, 4),
            (3112, 4),
            (3164, 4),
            (3537, 4),
            (935, 3),
            (2089, 3),
            (2405, 3),
            (2494, 3),
            (2500, 3),
            (2536, 3),
            (2593, 3),
            (2912, 3),
            (3196, 3),
            (3390, 3),
            (3392, 3),
            (3485, 3),
            (3548, 3),
            (451, 2),
            (953, 2),
            (1357, 2),
            (1427, 2),
            (1482, 2),
            (2136, 2),
            (2581, 2),
            (2674, 2),
            (2894, 2),
            (3095, 2),
            (3118, 2),
            (3214, 2),
            (3243, 2),
            (3319, 2),
            (3330, 2),
            (3362, 2),
            (3513, 2),
            (972, 1),
            (1078, 1),
            (1499, 1),
            (1558, 1),
            (2224, 1),
            (2466, 1),
            (2880, 1),
            (2883, 1),
            (2902, 1),
            (2909, 1),
            (3055, 1),
            (3176, 1),
            (3317, 1),
            (3327, 1),
            (3407, 1),
            (3422, 1),
            (3505, 1),
        ] {
            if let Some(user) = state.users.get_mut(&user_id) {
                let minted_fractional = *tokens as f64 / base as f64;
                user.notify(format!(
                    "{} minted `{}` ${} tokens for you! 💎",
                    CONFIG.name, minted_fractional, CONFIG.token_symbol,
                ));
                let acc = account(user.principal);
                crate::token::mint(state, acc, *tokens);
            }
        }
        state.minting_mode = false;
    })
}

/*
 * UPDATES
 */

#[cfg(not(feature = "dev"))]
#[update]
fn prod_release() -> bool {
    true
}

/// Fetches the full neuron info of the TaggrDAO proving the neuron decentralization
/// and voting via hot-key capabilities.
#[update]
async fn get_neuron_info() -> Result<String, String> {
    get_full_neuron(CONFIG.neuron_id).await
}

#[export_name = "canister_update vote_on_poll"]
fn vote_on_poll() {
    let (post_id, vote, anonymously): (PostId, u16, bool) = parse(&arg_data_raw());
    mutate(|state| reply(state.vote_on_poll(caller(), api::time(), post_id, vote, anonymously)));
}

#[export_name = "canister_update report"]
fn report() {
    mutate(|state| {
        let (domain, id, reason): (String, u64, String) = parse(&arg_data_raw());
        reply(state.report(caller(), domain, id, reason))
    });
}

#[export_name = "canister_update vote_on_report"]
fn vote_on_report() {
    mutate(|state| {
        let (domain, id, vote): (String, u64, bool) = parse(&arg_data_raw());
        reply(state.vote_on_report(caller(), domain, id, vote))
    });
}

#[export_name = "canister_update clear_notifications"]
fn clear_notifications() {
    mutate(|state| {
        let ids: Vec<u64> = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.clear_notifications(ids)
        }
        reply_raw(&[]);
    })
}

#[update]
fn link_cold_wallet(user_id: UserId) -> Result<(), String> {
    mutate(|state| state.link_cold_wallet(caller(), user_id))
}

#[update]
fn unlink_cold_wallet() -> Result<(), String> {
    mutate(|state| state.unlink_cold_wallet(caller()))
}

#[export_name = "canister_update withdraw_rewards"]
fn withdraw_rewards() {
    spawn(async {
        reply(State::withdraw_rewards(caller()).await);
    })
}

#[export_name = "canister_update tip"]
fn tip() {
    spawn(async {
        let (post_id, amount): (PostId, u64) = parse(&arg_data_raw());
        reply(State::tip(caller(), post_id, amount).await);
    })
}

#[export_name = "canister_update react"]
fn react() {
    let (post_id, reaction): (PostId, u16) = parse(&arg_data_raw());
    mutate(|state| reply(state.react(caller(), post_id, reaction, api::time())));
}

#[export_name = "canister_update update_last_activity"]
fn update_last_activity() {
    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.last_activity = api::time()
        }
    });
    reply_raw(&[]);
}

// migration method from the password login to many iterations login
#[export_name = "canister_update migrate"]
fn migrate() {
    let principal: String = parse(&arg_data_raw());
    reply(mutate(|state| state.migrate(caller(), principal)));
}

#[export_name = "canister_update request_principal_change"]
fn request_principal_change() {
    let principal: String = parse(&arg_data_raw());
    mutate(|state| {
        let principal = Principal::from_text(principal).expect("can't parse principal");
        if principal == Principal::anonymous() || state.principals.contains_key(&principal) {
            return;
        }
        let caller = caller();
        state
            .principal_change_requests
            .retain(|_, principal| principal != &caller);
        if state.principal_change_requests.len() <= 500 {
            state.principal_change_requests.insert(principal, caller);
        }
    });
    reply_raw(&[]);
}

#[export_name = "canister_update confirm_principal_change"]
fn confirm_principal_change() {
    reply(mutate(|state| state.change_principal(caller())));
}

#[export_name = "canister_update update_user"]
fn update_user() {
    let (new_name, about, principals, filter, governance, show_posts_in_realms): (
        String,
        String,
        Vec<String>,
        UserFilter,
        bool,
        bool,
    ) = parse(&arg_data_raw());
    reply(User::update(
        caller(),
        optional(new_name),
        about,
        principals,
        filter,
        governance,
        show_posts_in_realms,
    ))
}

#[export_name = "canister_update update_user_settings"]
fn update_user_settings() {
    let settings: std::collections::BTreeMap<String, String> = parse(&arg_data_raw());
    reply(User::update_settings(caller(), settings))
}

#[export_name = "canister_update create_user"]
fn create_user() {
    let (name, invite): (String, Option<String>) = parse(&arg_data_raw());
    spawn(async {
        reply(State::create_user(caller(), name, invite).await);
    });
}

#[export_name = "canister_update transfer_credits"]
fn transfer_credits() {
    let (recipient, amount): (UserId, Credits) = parse(&arg_data_raw());
    reply(mutate(|state| {
        let sender = state.principal_to_user(caller()).expect("no user found");
        let recipient_name = &state.users.get(&recipient).expect("no user found").name;
        state.credit_transfer(
            sender.id,
            recipient,
            amount,
            CONFIG.credit_transaction_fee,
            Destination::Credits,
            format!(
                "credit transfer from @{} to @{}",
                sender.name, recipient_name
            ),
            Some(format!(
                "You have received `{}` credits from @{}",
                amount, sender.name
            )),
        )
    }))
}

#[export_name = "canister_update widthdraw_rewards"]
fn widthdraw_rewards() {
    spawn(async { reply(State::withdraw_rewards(caller()).await) });
}

#[export_name = "canister_update mint_credits"]
fn mint_credits() {
    spawn(async {
        let kilo_credits: u64 = parse(&arg_data_raw());
        reply(State::mint_credits(caller(), kilo_credits).await)
    });
}

#[export_name = "canister_update create_invite"]
fn create_invite() {
    let credits: Credits = parse(&arg_data_raw());
    mutate(|state| reply(state.create_invite(caller(), credits)));
}

#[export_name = "canister_update propose_add_realm_controller"]
fn propose_add_realm_controller() {
    let (description, user_id, realm_id): (String, UserId, RealmId) = parse(&arg_data_raw());
    reply(mutate(|state| {
        proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::AddRealmController(realm_id, user_id),
            time(),
        )
    }))
}

#[export_name = "canister_update propose_icp_transfer"]
fn propose_icp_transfer() {
    let (description, receiver, amount): (String, String, String) = parse(&arg_data_raw());
    reply({
        match (
            AccountIdentifier::from_hex(&receiver),
            parse_amount(&amount, 8),
        ) {
            (Ok(account), Ok(amount)) => mutate(|state| {
                proposals::propose(
                    state,
                    caller(),
                    description,
                    proposals::Payload::ICPTransfer(account, Tokens::from_e8s(amount)),
                    time(),
                )
            }),
            (Err(err), _) | (_, Err(err)) => Err(err),
        }
    })
}

#[update]
fn propose_release(description: String, commit: String, binary: ByteBuf) -> Result<u32, String> {
    mutate(|state| {
        proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::Release(Release {
                commit,
                binary: binary.to_vec(),
                hash: Default::default(),
            }),
            time(),
        )
    })
}

#[export_name = "canister_update propose_reward"]
fn propose_reward() {
    let (description, receiver): (String, String) = parse(&arg_data_raw());
    mutate(|state| {
        reply(proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::Reward(Reward {
                receiver,
                votes: Default::default(),
                minted: 0,
            }),
            time(),
        ))
    })
}

#[export_name = "canister_update propose_funding"]
fn propose_funding() {
    let (description, receiver, tokens): (String, String, u64) = parse(&arg_data_raw());
    mutate(|state| {
        reply(proposals::propose(
            state,
            caller(),
            description,
            proposals::Payload::Fund(receiver, tokens * token::base()),
            time(),
        ))
    })
}

#[export_name = "canister_update vote_on_proposal"]
fn vote_on_proposal() {
    let (proposal_id, vote, data): (u32, bool, String) = parse(&arg_data_raw());
    mutate(|state| {
        reply(proposals::vote_on_proposal(
            state,
            time(),
            caller(),
            proposal_id,
            vote,
            &data,
        ))
    })
}

#[export_name = "canister_update cancel_proposal"]
fn cancel_proposal() {
    let proposal_id: u32 = parse(&arg_data_raw());
    mutate(|state| proposals::cancel_proposal(state, caller(), proposal_id));
    reply(());
}

#[update]
/// This method adds a post atomically (from the user's point of view).
async fn add_post(
    body: String,
    blobs: Vec<(String, Blob)>,
    parent: Option<PostId>,
    realm: Option<RealmId>,
    extension: Option<Blob>,
) -> Result<PostId, String> {
    let post_id = mutate(|state| {
        let extension: Option<Extension> = extension.map(|bytes| parse(&bytes));
        Post::create(
            state,
            body,
            &blobs,
            caller(),
            api::time(),
            parent,
            realm,
            extension,
        )
    })?;
    let call_name = format!("blobs_storing_for_{}", post_id);
    canisters::open_call(&call_name);
    let result = Post::save_blobs(post_id, blobs).await;
    canisters::close_call(&call_name);
    result.map(|_| post_id)
}

#[update]
/// This method initiates an asynchronous post creation.
fn add_post_data(body: String, realm: Option<RealmId>, extension: Option<Blob>) {
    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.draft = Some(Draft {
                body,
                realm,
                extension,
                blobs: Default::default(),
            });
        };
    })
}

#[update]
/// This method adds a blob to a post being created
fn add_post_blob(id: String, blob: Blob) -> Result<(), String> {
    mutate(|state| {
        if let Some(user) = state.principal_to_user_mut(caller()) {
            let credits = user.credits();
            if let Some(draft) = user.draft.as_mut() {
                if credits < (draft.blobs.len() + 1) as u64 * CONFIG.blob_cost {
                    user.draft.take();
                    return;
                }
                draft.blobs.push((id, blob))
            }
        }
    });
    Ok(())
}

#[update]
/// This method finalizes the post creation.
async fn commit_post() -> Result<PostId, String> {
    if let Some(Some(Draft {
        body,
        realm,
        extension,
        blobs,
    })) = mutate(|state| {
        state
            .principal_to_user_mut(caller())
            .map(|user| user.draft.take())
    }) {
        add_post(body, blobs, None, realm, extension).await
    } else {
        Err("no post data found".into())
    }
}

#[update]
async fn edit_post(
    id: PostId,
    body: String,
    blobs: Vec<(String, Blob)>,
    patch: String,
    realm: Option<RealmId>,
) -> Result<(), String> {
    Post::edit(id, body, blobs, patch, realm, caller(), api::time()).await
}

#[export_name = "canister_update delete_post"]
fn delete_post() {
    mutate(|state| {
        let (post_id, versions): (PostId, Vec<String>) = parse(&arg_data_raw());
        reply(state.delete_post(caller(), post_id, versions))
    });
}

#[export_name = "canister_update toggle_bookmark"]
fn toggle_bookmark() {
    mutate(|state| {
        let post_id: PostId = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller()) {
            reply(user.toggle_bookmark(post_id));
            return;
        };
        reply(false);
    });
}

#[export_name = "canister_update toggle_following_post"]
fn toggle_following_post() {
    let post_id: PostId = parse(&arg_data_raw());
    let user_id = read(|state| state.principal_to_user(caller()).expect("no user found").id);
    reply(
        mutate(|state| Post::mutate(state, &post_id, |post| Ok(post.toggle_following(user_id))))
            .unwrap_or_default(),
    )
}

#[export_name = "canister_update toggle_following_user"]
fn toggle_following_user() {
    let followee_id: UserId = parse(&arg_data_raw());
    mutate(|state| reply(state.toggle_following_user(caller(), followee_id)))
}

#[export_name = "canister_update toggle_following_feed"]
fn toggle_following_feed() {
    mutate(|state| {
        let tags: Vec<String> = parse(&arg_data_raw());
        reply(
            state
                .principal_to_user_mut(caller())
                .map(|user| user.toggle_following_feed(tags))
                .unwrap_or_default(),
        )
    })
}

#[export_name = "canister_update edit_realm"]
fn edit_realm() {
    mutate(|state| {
        let (name, realm): (String, Realm) = parse(&arg_data_raw());
        reply(state.edit_realm(caller(), name, realm))
    })
}

#[export_name = "canister_update realm_clean_up"]
fn realm_clean_up() {
    mutate(|state| {
        let (post_id, reason): (PostId, String) = parse(&arg_data_raw());
        reply(state.clean_up_realm(caller(), post_id, reason))
    });
}

#[export_name = "canister_update create_realm"]
fn create_realm() {
    mutate(|state| {
        let (name, realm): (String, Realm) = parse(&arg_data_raw());
        reply(state.create_realm(caller(), name, realm))
    })
}

#[export_name = "canister_update toggle_realm_membership"]
fn toggle_realm_membership() {
    mutate(|state| {
        let name: String = parse(&arg_data_raw());
        reply(state.toggle_realm_membership(caller(), name))
    })
}

#[export_name = "canister_update toggle_blacklist"]
fn toggle_blacklist() {
    mutate(|state| {
        let user_id: UserId = parse(&arg_data_raw());
        if let Some(user) = state.principal_to_user_mut(caller()) {
            user.toggle_blacklist(user_id);
        }
    });
    reply_raw(&[])
}

#[export_name = "canister_update toggle_filter"]
fn toggle_filter() {
    mutate(|state| {
        let (filter, value): (String, String) = parse(&arg_data_raw());
        reply(if let Some(user) = state.principal_to_user_mut(caller()) {
            user.toggle_filter(filter, value)
        } else {
            Err("no user found".into())
        });
    })
}

#[update]
async fn set_emergency_release(binary: ByteBuf) {
    mutate(|state| {
        if binary.is_empty()
            || !state
                .principal_to_user(caller())
                .map(|user| user.stalwart)
                .unwrap_or_default()
        {
            return;
        }
        state.emergency_binary = binary.to_vec();
        state.emergency_votes.clear();
    });
}

#[export_name = "canister_update confirm_emergency_release"]
fn confirm_emergency_release() {
    mutate(|state| {
        let principal = caller();
        if let Some(user) = state.principal_to_user(principal) {
            let user_balance = user.balance;
            let user_cold_balance = user.cold_balance;
            let user_cold_wallet = user.cold_wallet;
            let hash: String = parse(&arg_data_raw());
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&state.emergency_binary);
            if hash == format!("{:x}", hasher.finalize()) {
                state.emergency_votes.insert(principal, user_balance);
                if let Some(principal) = user_cold_wallet {
                    state.emergency_votes.insert(principal, user_cold_balance);
                }
            }
        }
        reply_raw(&[]);
    })
}

// This function is the last resort of triggering the emergency upgrade and is expected to be used.
#[update]
fn force_emergency_upgrade() -> bool {
    mutate(|state| state.execute_pending_emergency_upgrade(true))
}

fn caller() -> Principal {
    let caller = ic_cdk::caller();
    assert_ne!(caller, Principal::anonymous(), "authentication required");
    caller
}

#[test]
fn check_candid_interface_compatibility() {
    use candid_parser::utils::{service_equal, CandidSource};

    fn source_to_str(source: &CandidSource) -> String {
        match source {
            CandidSource::File(f) => std::fs::read_to_string(f).unwrap_or_else(|_| "".to_string()),
            CandidSource::Text(t) => t.to_string(),
        }
    }

    fn check_service_equal(new_name: &str, new: CandidSource, old_name: &str, old: CandidSource) {
        let new_str = source_to_str(&new);
        let old_str = source_to_str(&old);
        match service_equal(new, old) {
            Ok(_) => {}
            Err(e) => {
                eprintln!(
                    "{} is not compatible with {}!\n\n\
            {}:\n\
            {}\n\n\
            {}:\n\
            {}\n",
                    new_name, old_name, new_name, new_str, old_name, old_str
                );
                panic!("{:?}", e);
            }
        }
    }

    use crate::http::{HttpRequest, HttpResponse};
    use crate::token::{Account, Standard, TransferArgs, TransferError, Value};
    candid::export_service!();

    let new_interface = __export_service();

    // check the public interface against the actual one
    let old_interface =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("taggr.did");

    check_service_equal(
        "actual ledger candid interface",
        candid_parser::utils::CandidSource::Text(&new_interface),
        "declared candid interface in taggr.did file",
        candid_parser::utils::CandidSource::File(old_interface.as_path()),
    );
}
