use crate::{
    env::{
        proposals::{Payload, Release},
        user::{Mode, UserFilter},
    },
    token::{account, Token},
};

use super::*;
use env::{
    canisters::get_full_neuron,
    config::CONFIG,
    post::{Extension, Post, PostId},
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
use icrc_ledger_types::icrc3::blocks::BlockWithId;
use serde_bytes::ByteBuf;
use std::time::Duration;
use user::Pfp;

#[init]
fn init() {
    mutate(|state| {
        state.memory.init();
        state.timers.last_weekly = time();
        state.timers.last_daily = time();
        state.timers.last_hourly = time();
        state.auction.amount = CONFIG.weekly_auction_size_tokens_max;
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

    set_timer_interval(Duration::from_secs(15 * 60), || {
        spawn(State::chores(api::time()))
    });
    set_timer(
        Duration::from_millis(0),
        || spawn(State::finalize_upgrade()),
    );

    sync_post_upgrade_fixtures();

    // post upgrade logic goes here
    set_timer(Duration::from_millis(0), move || {
        spawn(async_post_upgrade_fixtures());
    });

    ic_cdk::println!(
        "Post-upgrade spent {}B instructions",
        performance_counter(0) / 1000000000
    )
}

#[allow(clippy::all)]
fn sync_post_upgrade_fixtures() {
    assert_memory_restored();
    remove_corrupted_posts();
    restore_corrupted_features();
    reconcile_leder();
    mutate(|state| {
        state.memory.persist_allocator();
        // This code was used to verifify that the found free segments are correct.
        // state.memory.fill_free_segments();
        state.memory.restore_free_segments();
        state.memory.init();

        // Prove that all objects can be deserialized.
        assert!(state
            .memory
            .ledger
            .safe_iter()
            .all(|(_, val)| val.is_some()));
        assert!(state
            .memory
            .features
            .safe_iter()
            .all(|(_, val)| val.is_some()));
        assert!(state.memory.posts.safe_iter().all(|(_, val)| val.is_some()));
    })
}

fn reconcile_leder() {
    // This function was used to find the last valid transaction
    // #[update]
    // fn check_txs() {
    //     read(|state| {
    //         for (id, val) in state.memory.ledger.safe_iter() {
    //             match val {
    //                 None => {
    //                     ic_cdk::println!("tx {} is last one", id);
    //                     return;
    //                 }
    //                 Some(tx) => {
    //                     if *id > 0 {
    //                         let parent_tx: BlockWithId = state
    //                             .memory
    //                             .ledger
    //                             .get(&id.saturating_sub(1))
    //                             .expect("no transaction found")
    //                             .into();
    //                         if tx.parent_hash != parent_tx.block.hash() {
    //                             ic_cdk::println!("tx {} is last one with broken hash", id);
    //                             return;
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     })
    // }

    let first_corrupt_tx = 51953;

    mutate(|state| {
        let source_of_truth_balances = state.balances.clone();
        let total_supply: Token = source_of_truth_balances.values().sum();

        // First delete all transactions above the last valid one
        let mut txs = 0;
        for id in first_corrupt_tx..state.memory.ledger.len() {
            let _ = state.memory.ledger.remove_index(&(id as u32));
            txs += 1;
        }
        state
            .logger
            .debug(format!("Corrupt transactions removed: {}", txs));

        let mut txs = state.memory.ledger.len();
        ic_cdk::println!("txs found in stable = {}", txs);
        // Assert we have more txs in stable memory than in the heap, so we don't need to use the
        // heap transaction ledger.
        assert!(state.memory.ledger.len() > state.ledger.len());

        // Restore user balances from the valid transactions in stable memory
        let balances =
            match token::balances_from_ledger(&mut state.memory.ledger.iter().map(|(_, tx)| tx)) {
                Ok((balances, _)) => balances,
                Err(err) => panic!("the token ledger is inconsistent: {}", err),
            };

        // Reconcile with the in-memory balances by burning / minting the differences
        state.minting_mode = true;
        let mut total_burned = 0;
        let mut total_minted = 0;

        // First reconcile all recorded balances
        for (acc, recorded_balance) in balances {
            let source_of_truth = source_of_truth_balances
                .get(&acc)
                .copied()
                .unwrap_or_default();
            if source_of_truth == recorded_balance {
                continue;
            }
            if source_of_truth > recorded_balance {
                // Account has more balance than recorded, so we need to mint the difference
                let diff = source_of_truth - recorded_balance;
                token::mint(state, acc, diff as u64, "reconciliation");
                total_minted += diff;
            } else {
                // Account has less balance, than recorded, so we need to burn the difference
                let diff = recorded_balance - source_of_truth;
                // Since we're using the existing transfer logic, that operates on balances in the
                // heap to decide if user has funds or not, for accounts who have to get a burn
                // record, the corresponding amount has to be added to their balance first, so that
                // it can be subtracted during the burn and a ledger entry can be created.
                state
                    .balances
                    .entry(acc.clone())
                    .and_modify(|bal| *bal += diff)
                    .or_insert(diff);
                token::burn(state, acc, diff, "reconciliation");
                total_burned += diff;
            }
            txs += 1;
            // Make sure we added the expected amount of transactions
            assert_eq!(txs, state.memory.ledger.len());
        }

        // Now we reconcile all new balances that were never recorded before
        let balances =
            match token::balances_from_ledger(&mut state.memory.ledger.iter().map(|(_, tx)| tx)) {
                Ok((balances, _)) => balances,
                Err(err) => panic!("the token ledger is inconsistent: {}", err),
            };
        for (acc, source_of_truth) in &source_of_truth_balances {
            // Skip all recorded positive balances
            if balances.get(&acc).copied().unwrap_or_default() > 0 {
                continue;
            }
            // Account has some balance that is not recorded, so we need to mint it
            let diff = *source_of_truth;
            token::mint(state, acc.clone(), diff as u64, "reconciliation");
            total_minted += diff;
            txs += 1;
            // Make sure we added the expected amount of transactions
            assert_eq!(txs, state.memory.ledger.len());
        }
        state.minting_mode = false;

        // Now recompute the balances from ledger and make sure they all match the source of truth.
        let balances =
            match token::balances_from_ledger(&mut state.memory.ledger.iter().map(|(_, tx)| tx)) {
                Ok((balances, _)) => balances,
                Err(err) => panic!("the token ledger is inconsistent: {}", err),
            };

        assert_eq!(
            balances.values().filter(|bal| **bal > 0).count(),
            source_of_truth_balances
                .values()
                .filter(|bal| **bal > 0)
                .count(),
        );

        let mut matched = 0;
        for (acc, tokens) in &balances {
            let expected = source_of_truth_balances
                .get(&acc)
                .copied()
                .unwrap_or_default();
            if *tokens != expected {
                panic!(
                    "acc={:?} diverged: {} <> {} (matched={})",
                    acc.owner.to_text(),
                    expected,
                    &tokens,
                    matched
                );
            }
            matched += 1;
        }

        // Make sure we didn't change the total supply
        assert_eq!(
            source_of_truth_balances.values().sum::<Token>(),
            total_supply
        );
        assert_eq!(balances.values().sum::<Token>(), total_supply);

        // Restore the balances to the original value.
        state.balances = source_of_truth_balances;

        let msg = format!(
            "ledger reconiliation: total_burned={}, total_minted={}",
            total_burned, total_minted
        );
        ic_cdk::println!("{}", &msg);
        state.logger.debug(msg);
    })
}

fn restore_corrupted_features() {
    // This function was used to detect corrupted features
    // #[update]
    // fn check_feats() {
    //     read(|state| {
    //         for (id, feat) in state.memory.features.safe_iter() {
    //             ic_cdk::println!("feat_id={}, status={:?}", id, feat.map(|v| v.status))
    //         }
    //     })
    // }
    let ids = [1333906, 1390916];

    mutate(|state| {
        for id in ids {
            // Assert feature doesn't exist
            assert!(state.memory.features.get_safe(&id).is_none());
            state.memory.features.remove_index(&id).unwrap();
            state
                .memory
                .features
                .insert(id, Default::default())
                .unwrap();
        }
        state.logger.debug(format!(
            "features restored from memory corruption: {}",
            ids.len()
        ));
    })
}

// We need to remove all lost posts from the memory index so that they do not cause panics.
fn remove_corrupted_posts() {
    // This function was used to find all corrupted posts
    // #[update]
    // fn find_posts() -> String {
    //     read(|state| {
    //         let mut result = Vec::new();
    //         for (id, val) in state.memory.posts.safe_iter() {
    //             if val.is_none() {
    //                 result.push(id);
    //             }
    //         }
    //         format!("{:?}", result)
    //     })
    // }
    let posts = [
        235362, 1132332, 1136551, 1156334, 1165545, 1170799, 1208549, 1209052, 1212347, 1213483,
        1267657, 1274925, 1335824, 1340457, 1368341, 1385182, 1389045, 1393004, 1393806, 1393923,
        1394557, 1394617, 1394621, 1394840, 1394893, 1395123, 1395219, 1395232, 1395355, 1395422,
        1395525, 1395541, 1395543, 1395559, 1395621, 1395627, 1395694, 1395786, 1395888, 1395902,
        1395922, 1395955, 1395963, 1396020, 1396038, 1396040, 1396045, 1396067, 1396082, 1396086,
        1396087, 1396088, 1396128, 1396131, 1396135, 1396144, 1396158, 1396159, 1396160, 1396162,
        1396165, 1396167, 1396169, 1396170, 1396174, 1396175, 1396183, 1396188, 1396189, 1396190,
        1396191, 1396192, 1396194, 1396195, 1396196, 1396197, 1396199, 1396200, 1396201, 1396202,
        1396203, 1396204, 1396205, 1396206, 1396208, 1396209, 1396210, 1396211, 1396212, 1396213,
        1396215, 1396216, 1396217, 1396218, 1396219, 1396221, 1396222, 1396223, 1396224, 1396225,
        1396226, 1396227, 1396228, 1396229, 1396230, 1396231, 1396232, 1396233, 1396235, 1396236,
        1396237, 1396239, 1396240, 1396241, 1396242, 1396243, 1396244, 1396246, 1396247, 1396248,
        1396249, 1396250, 1396251, 1396252, 1396253, 1396255, 1396256, 1396257, 1396258, 1396259,
        1396260, 1396261, 1396262, 1396263, 1396264, 1396265, 1396266, 1396267, 1396268, 1396270,
        1396271, 1396273, 1396275, 1396276, 1396277, 1396280, 1396282, 1396283, 1396284, 1396285,
        1396287, 1396288, 1396289, 1396291, 1396293, 1396294, 1396295, 1396296, 1396297, 1396298,
        1396299, 1396300, 1396302, 1396303, 1396304, 1396305, 1396306, 1396307, 1396308, 1396309,
        1396310, 1396311, 1396312, 1396313, 1396314, 1396315, 1396316, 1396317, 1396318, 1396319,
        1396320, 1396321, 1396322, 1396323, 1396324, 1396325, 1396326, 1396327, 1396328, 1396329,
        1396330, 1396331, 1396332, 1396333, 1396334, 1396335, 1396336, 1396337, 1396338, 1396339,
        1396340, 1396341, 1396342, 1396343, 1396344, 1396345, 1396346, 1396347, 1396348, 1396349,
        1396350, 1396352, 1396354, 1396355, 1396356, 1396358, 1396359, 1396360, 1396361, 1396362,
        1396363, 1396364, 1396365, 1396367, 1396369, 1396370, 1396371, 1396372, 1396373, 1396374,
        1396375, 1396376, 1396377, 1396378, 1396379, 1396380, 1396381, 1396382, 1396383, 1396384,
        1396385, 1396386, 1396387, 1396388, 1396389, 1396390, 1396391, 1396392, 1396393, 1396394,
        1396395, 1396396, 1396397, 1396398, 1396399, 1396400, 1396401, 1396402, 1396403, 1396404,
        1396405, 1396406, 1396407, 1396408, 1396410, 1396411, 1396412, 1396413, 1396414, 1396415,
        1396416, 1396417, 1396418, 1396419, 1396420, 1396421, 1396422, 1396423, 1396424, 1396425,
        1396426, 1396427, 1396428, 1396429, 1396430, 1396431, 1396432, 1396436, 1396437, 1396438,
        1396439, 1396441, 1396442, 1396443, 1396444, 1396445, 1396446, 1396447, 1396448, 1396449,
        1396450, 1396451, 1396452, 1396453, 1396454, 1396455, 1396456, 1396457, 1396458, 1396459,
        1396460, 1396461, 1396462, 1396463, 1396464, 1396465, 1396466, 1396467, 1396468, 1396469,
        1396470, 1396471, 1396472, 1396473, 1396475, 1396476, 1396477, 1396478, 1396479, 1396480,
        1396481, 1396483, 1396484, 1396485, 1396486, 1396487, 1396488, 1396489, 1396490, 1396491,
        1396492, 1396493, 1396494, 1396495, 1396496, 1396497, 1396498, 1396499, 1396500, 1396502,
        1396503, 1396504, 1396505, 1396506, 1396507, 1396508, 1396509, 1396510, 1396511, 1396512,
        1396513, 1396514, 1396515, 1396516, 1396517, 1396518, 1396519, 1396520, 1396522, 1396523,
        1396524, 1396525, 1396527, 1396528, 1396529, 1396530, 1396531, 1396532, 1396533, 1396534,
        1396535, 1396536, 1396537, 1396538, 1396539, 1396540, 1396541, 1396542, 1396543, 1396544,
        1396546, 1396547, 1396548, 1396549, 1396550, 1396551, 1396553, 1396554, 1396555, 1396556,
        1396557, 1396558, 1396560, 1396562, 1396563, 1396564, 1396565, 1396566, 1396568, 1396569,
        1396571, 1396572, 1396573, 1396574, 1396576, 1396577, 1396578, 1396579, 1396580, 1396581,
        1396582, 1396583, 1396584, 1396586, 1396588, 1396589, 1396590, 1396591, 1396592, 1396593,
        1396595, 1396597, 1396598, 1396599, 1396600, 1396601, 1396602, 1396603, 1396604, 1396605,
        1396606, 1396607, 1396608, 1396609, 1396610, 1396611, 1396612, 1396613, 1396617, 1396619,
        1396620, 1396621, 1396622, 1396623, 1396624, 1396625, 1396626, 1396627, 1396628, 1396629,
        1396630, 1396631, 1396632, 1396633, 1396635, 1396636, 1396637, 1396638, 1396640, 1396641,
        1396642, 1396643, 1396644, 1396645, 1396647, 1396648, 1396651, 1396653, 1396655, 1396656,
        1396657, 1396660, 1396661, 1396662, 1396663, 1396665, 1396666, 1396667, 1396669, 1396671,
        1396672, 1396673, 1396677, 1396678, 1396679, 1396680, 1396681, 1396684, 1396686, 1396687,
        1396688, 1396690, 1396691, 1396692, 1396693, 1396694, 1396695, 1396696, 1396698, 1396699,
        1396700, 1396702, 1396703, 1396705, 1396708, 1396709, 1396710, 1396711, 1396713,
    ];

    mutate(|state| {
        for post_id in posts {
            // Assert post doesn't exist
            assert!(Post::get(state, &post_id).is_none());
            state.posts.remove(&post_id);
            let _ = state.memory.posts.remove_index(&post_id);
        }
        state.logger.debug(format!(
            "Posts removed due to memory corruption: {}",
            posts.len()
        ));
    })
}

fn assert_memory_restored() {
    let hashes = vec![
        /* 0 */ "f99fb568e8f5dae48279cc6c9ec0d43fac67a7521b5f1836c42a5f0038efe68c",
        /* 1 */ "79574e55d3aaee2252eb869ddb627df34f7a42fadf8b5a3a7b8d5488ae45bfef",
        /* 2 */ "7aa09eb068a50814b5692c5440628fad8de731d82898e0670ac2f1d49a2ea115",
        /* 3 */ "e310b55b22b4e3492d7329624ff1fae1b7fce4dae51e795ac4e971ec20165d3a",
        /* 4 */ "a37b2a851f8f7329777d29f5f18617a66b28c9f6693b41e3988bf047fbd13393",
        /* 5 */ "ec6ef1e5eab6003f2313517101ca6a2fe0b7f1fda0cc219b78d5b3db214b8a4a",
        /* 6 */ "479e71c570e2f8e7ec4e197b87613f35beeb2583d94ae692645a1fa7c99d50f9",
        /* 7 */ "c972a5e711640ecf48050065b6b516c5ff294d24429d6ab68d91579c69f342ec",
        /* 8 */ "786bdef851dd3aee27a19916aa78b7e0a77a11768cc240e8c28b1e4c1d32fdef",
        /* 9 */ "5467a41cdf53026dc10a5c9e018281238d2e31ab02426da71bd3a0c2681add0e",
        /* 10 */ "49ed985741eeb25b9c10c713048853a442d1a4736e2534d1d20e0c17fcb0cf52",
        /* 11 */ "b1c9a6f5e7580696a568703c5d8b328d81fd5ff5113d00a856b40f38bcd6f0f4",
        /* 12 */ "33900edff875a67ee27440d83375811f0add2b87ab215a59d5b9e0999cfd030d",
        /* 13 */ "3f518e0ce027248223a3d0abbc8d696932f19bf5cf1ced3c80a7ba4f7aae3359",
        /* 14 */ "17ce5dc0676b3c837e2a64f34550cf546a4d5306a659836cd00516e3cbde3b11",
        /* 15 */ "10578bc3172c57ae573de5ae864a548bd0e992506277ce5270cff8936b72c545",
        /* 16 */ "266ae051bb95411981b8d5009f487bd4622870ba301078e58bf879b6d2f6d57a",
        /* 17 */ "09e5a36bf15d34db580e0b8b75ef1f7f1396843ff05f186ce5bfca3978a8646a",
        /* 18 */ "a7b9a6bba5e4695de8438c3606ad1fb20cb6f4533c261ef870a2ef130241ff1d",
        /* 19 */ "e83351e3642c27be37d2b7f2afda8775906ded16ddc764184a565662bd8e8a2c",
        /* 20 */ "7cd48c52a32826b97f4162d850d559d826ceefe02f08077d8dbfe91903ef7e11",
        /* 21 */ "b531223fd65ff64dee37f6f0ec2c8373cc1e08437433c9ff4f8f8e13717dbd33",
        /* 22 */ "7ab6f1db6b856b2179a4bd7fba47a331bbf18dac2246a85b7681f594dd78e801",
        /* 23 */ "198c66bb148c97b3868d48f661403272d40ba41b7ab44bb760286ae5c29a99f6",
        /* 24 */ "344f20ffbb47bd2e844d51f7b543726bb35f31ddaea2dc940326eb1265bd1e26",
        /* 25 */ "544532c223022b520f3bec22a2abc861a6979cb32a11bc43dd6992642bba5c36",
        /* 26 */ "ca55a1e7bb1e1fc394dc18d6c5903c1ec419070eaa12ed37cde1fd18b9b1d0c0",
        /* 27 */ "70fd9ce54e87030ed60cca33ff8dc43af72c8ed78b5cb0396609d33a0c88b3ee",
        /* 28 */ "9e4dc0a368aa386355b921e9e54e9e63bf7106df42b38d83dad366c391243d3b",
        /* 29 */ "dd29e17c06f53642fcf5f3ec019ae94aec8d06e1ed81becd2a76c549f3600ead",
        /* 30 */ "b62d60f66cdef0d2996b30c1a04999241f8d47276b83debe55cf7d53f43492e9",
        /* 31 */ "4f1bcec97f409a0f5a055da6aad19002aab9c50d6a2282af42582765463f1c9d",
        /* 32 */ "d4ced8b559d28d9459205e5f0f37dc71bd279caec20f5f2f17c461a336cb10c3",
        /* 33 */ "b9d998492ccf35d62588bf05d509981c6e7eebf1c0ca92a51c6168d0a108fd11",
        /* 34 */ "892761a1bc6f7d058f51a5a2aeae75899774e7db0f506a0b5dcb51e97d137e8a",
        /* 35 */ "fcceac9cefd37c2f1fe2c86966278f4b77edea49f259602f938356ff3f2a4082",
        /* 36 */ "052982a6ccc381c169422ebef8810aa73abd9c08285afafd9dd45c1847845857",
        /* 37 */ "a9e704b9850c5087736cf8d1832b6c959ea0edbb564a18dadaae8ff240bf37a0",
        /* 38 */ "9863fdc6965b646f1f6cdbc3e63a13135cc6705eaca4076042b24b6443692075",
        /* 39 */ "bb6946baddbca6aed16c0ced6b2fa8719e9124a3aa3b9d59225e6bcd59ac8785",
        /* 40 */ "e113e814d53a1b67718d4f09fea031f2014e2abc532f27c2cfb7210861dfafef",
        /* 41 */ "fb919376f88ffb2babfe2cd2c2dbe2d3de8bec63ca70166b9af26d4205f58719",
        /* 42 */ "3a9f4c81073c52c8f40b7cf04ab7a15eda3240ad9255346ba47223a3d69764ac",
        /* 43 */ "6ecccca09f17672f219472bbe1025922cd4ba9515220cb11c5bf69c8e6ff2d5c",
        /* 44 */ "374d93fc8bec713944ac18088f24f45412c36b792dd444a1dfda4904c46723fb",
        /* 45 */ "e996c44e43b7c3b73f0f41eb084d3711f0e2a3245605d073b089cef5fa811ea6",
        /* 46 */ "4c7215c771378239df0318b62c86cd9a87a742a776c8042aa3cb074d47dd0bde",
        /* 47 */ "cf15cd372f8405d26e3125b5eb08be6ded0456f86e5c5a939dcb58246c9b7f9d",
        /* 48 */ "666b4314791227d36b75ef3c11f4faef0c84ff5e8fc2c949d1ffe8b3cc9bcb8d",
        /* 49 */ "d3832d40b8c251c6f9939abc665cad0d21b2a5a064118739c9f034b0afe66949",
        /* 50 */ "65dece48a9946bd343ead3ca50a7c2806b8acc12f28286e4ad21494ec1982631",
        /* 51 */ "bcc40851461243c8318f9864e7800a3d42a0fed68d1d994ee9ee1a201f5a97e7",
        /* 52 */ "fedc55ea57f7d06a0227c606cd1217200b632fa74e7b867fc34cdf0b699dff14",
        /* 53 */ "a76c666d417fb95d5c2b7c3ce1144556bf00cc2f0e43ca875eb3854fa0934e95",
        /* 54 */ "3d33f0f72d9734a6964c88d189698f0cb13db43560f1914176da083f419fcaeb",
        /* 55 */ "dbfa051793b67b44a42d65a671752fe26e0ad9af161dff784dda2c8863334fb5",
        /* 56 */ "c3da2254990db325f47c9307a5a7a7f38f84170e3a8ef2d9e9af5f61baeda577",
        /* 57 */ "b700a7a13363e023c50bbdc4160606c8ad5132fdce97d7351570fd2433277c7d",
        /* 58 */ "4d8d1a2e8cf788000d009ccd9c2be5cff4572ee226bfdc96f9dc2f12fc9cd0eb",
        /* 59 */ "a26250475a7b5f83d31862fbc051c1d2c9b1e91ab861f87573641af58865a71e",
        /* 60 */ "0019807968e85cca0a768ddebce962f7e903ad48bba7a9399b8df363481e904d",
        /* 61 */ "a51943c1593651b21298baacb1ab1cd1521da35b094d87164b7daf8afe8dfbac",
        /* 62 */ "8b291ff4670293559274539d66276fddf1715db06b356562fc3176e6c89d9613",
        /* 63 */ "b6f5058d4a76559d2fa675505f51c266f92c1dde1cf5e6ebc8fd6147272dc599",
        /* 64 */ "7f8f861baae4c35aca4b646892e5100367b5ee89cd5247bf3c0c97fe8471d219",
        /* 65 */ "5d375f75b8a6aeaf392cefd063b6d806953b51383d38533d949a5941b811a1ad",
        /* 66 */ "d833ccc7b102191d54a48194e185a62297e233957047b0be7d8ea8d7b41934ae",
        /* 67 */ "12c05733c4faf4deed2e665952b4138f90340a61d31f4aa5f338c24a24be27a7",
        /* 68 */ "77ca80058867c3cbea5492e3ab806a7aa3241eb4869c3167b505a0779ec69378",
        /* 69 */ "445b49ddca43ce891d1b6aa5dd225b6a5ac8a110e2e93b2eb8fe5e62a32ba39a",
        /* 70 */ "424fef81061698f1e5cf90a28ac91bdf3204191efe8f854030c30ca9a52b7fd1",
        /* 71 */ "a85fecbb13ce8a9116118a394a77e14b3606fa70925397e6958593c14711b1ea",
        /* 72 */ "bf4184d8d0709f12cb5279c564508057462b73b6a913d3f796f56332bd0a8d3b",
        /* 73 */ "62e99f00eb8cd5712097c420e66d2f23e98860f244f314a075fca490db863567",
        /* 74 */ "7b0e072489937ce47c83e137efc22b2c0c3713f59cd2331eb37c15db246b6981",
        /* 75 */ "04555cc5ce7985651ee212a3930f232170c9f4f56277dfd3cff3a6204f22d5ea",
        /* 76 */ "f15a6584b937b83134f8893d18edf23775754d130ccb15816012c30f6e6b8eac",
        /* 77 */ "5782f8e0f6a8ccf4c32f02eed73bbab49a60c64aa8fca32edc7533a5a7ad9d80",
        /* 78 */ "fb0b1120fb7f12351f6f7f918c1d33b78ee1875b2638dee29a2ef055352243da",
        /* 79 */ "b489f78da4240cd54f150fe40fb88a8ba1ff5dd84ffbab97bd079366a5ff8e47",
    ];

    for (page, hash) in hashes.into_iter().enumerate() {
        assert_eq!(hash, page_hash(page as u64))
    }
}

#[allow(clippy::all)]
async fn async_post_upgrade_fixtures() {}

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
    let (post_id, amount): (PostId, u64) = parse(&arg_data_raw());
    reply(mutate(|state| state.tip(caller(), post_id, amount)));
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
    let (new_name, about, principals, filter, governance, mode, show_posts_in_realms, pfp): (
        String,
        String,
        Vec<String>,
        UserFilter,
        bool,
        Mode,
        bool,
        Pfp,
    ) = parse(&arg_data_raw());
    reply(User::update(
        caller(),
        optional(new_name),
        about,
        principals,
        filter,
        governance,
        mode,
        show_posts_in_realms,
        pfp,
    ))
}

#[export_name = "canister_update update_user_settings"]
fn update_user_settings() {
    let settings: std::collections::BTreeMap<String, String> = parse(&arg_data_raw());
    reply(User::update_settings(caller(), settings))
}

#[export_name = "canister_update create_feature"]
fn create_feature() {
    let post_id: PostId = parse(&arg_data_raw());
    reply(features::create_feature(caller(), post_id));
}

#[export_name = "canister_update toggle_feature_support"]
fn toggle_feature_support() {
    let post_id: PostId = parse(&arg_data_raw());
    reply(features::toggle_feature_support(caller(), post_id));
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

#[export_name = "canister_update delay_weekly_chores"]
fn delay_weekly_chores() {
    reply(mutate(|state| state.delay_weekly_chores(caller())))
}

#[export_name = "canister_update create_proposal"]
fn create_proposal() {
    let (post_id, payload): (PostId, Payload) = parse(&arg_data_raw());
    reply(mutate(|state| {
        proposals::create_proposal(state, caller(), post_id, payload, time())
    }))
}

#[update]
fn propose_release(
    post_id: PostId,
    commit: String,
    features: Vec<PostId>,
    binary: ByteBuf,
) -> Result<u32, String> {
    mutate(|state| {
        proposals::create_proposal(
            state,
            caller(),
            post_id,
            proposals::Payload::Release(Release {
                commit,
                binary: binary.to_vec(),
                hash: Default::default(),
                closed_features: features,
            }),
            time(),
        )
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
                .map(|user| user.toggle_following_feed(&tags))
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

#[export_name = "canister_update create_bid"]
fn create_bid() {
    spawn(async {
        let (amount, e8s_per_token): (u64, u64) = parse(&arg_data_raw());
        reply(auction::create_bid(caller(), amount, e8s_per_token).await)
    });
}

#[export_name = "canister_update cancel_bid"]
fn cancel_bid() {
    spawn(async { reply(auction::cancel_bid(caller()).await) });
}

fn caller() -> Principal {
    let caller = ic_cdk::caller();
    assert_ne!(caller, Principal::anonymous(), "authentication required");
    caller
}

#[update]
fn backup() {
    mutate(|state| {
        if !state.backup_exists {
            env::memory::heap_to_stable(state);
            state.memory.init();
            state.backup_exists = true;
        }
    })
}

fn page_hash(page: u64) -> String {
    let offset = page * BACKUP_PAGE_SIZE as u64;

    // Read existing page first. If it is restored already, quit.
    let mut current_page = Vec::with_capacity(BACKUP_PAGE_SIZE as usize);
    current_page.spare_capacity_mut();
    unsafe {
        current_page.set_len(BACKUP_PAGE_SIZE as usize);
    }
    api::stable::stable_read(offset, &mut current_page);
    use sha2::{Digest, Sha256};

    // For page 0 we need to override the first 16 bytes with the heap coordinates,
    // in order for the hash to match.
    if page == 0 {
        current_page[..16]
            .copy_from_slice(&[0, 0, 0, 0, 35, 173, 39, 139, 0, 0, 0, 0, 3, 114, 198, 63]);
    }

    let mut hasher = Sha256::new();
    hasher.update(&current_page);
    let result = hasher.finalize();
    format!("{:x}", result)
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

    candid::export_service!();
    let new_interface = __export_service();

    // check the public interface against the actual one
    let old_interface =
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("taggr.did");

    check_service_equal(
        "actual candid interface",
        candid_parser::utils::CandidSource::Text(&new_interface),
        "declared candid interface in taggr.did file",
        candid_parser::utils::CandidSource::File(old_interface.as_path()),
    );
}
