# $name

$name aims to become a public good, providing decentralized and censorship-resistant services for publishing content and communication.
It operates on the public compute infrastructure powered by the [Internet Computer](https://internetcomputer.org).

## Key Points

-   $name combines features of forums and blogs.
-   [Posts](#/post/0) containing #tags will appear in feeds associated with those tags.
-   Users can follow tag [feeds](#/feed/$name), other [users](#/user/0), and monitor activity on posts.
-   $name is tokenized and is owned and governed by its token holders.
-   $name distributes rewards to active users and shares its revenue with token holders.
-   Every user starts with an invite or by minting at least `$native_cycles_per_xdr` cycles, paying `1` [XDR](https://en.wikipedia.org/wiki/Special_drawing_rights) in ICP.
-   Each interaction with users on $name consumes user's cycles.
-   Users earn or lose "karma" based on post writing, reactions, and comments.
-   Users can mint new cycles at any point by paying at least `1` XDR in ICP.
-   All payments go to [$name's Treasury](https://dashboard.internetcomputer.org/account/dee15d98a70029163c79ace6ec9cf33b21917355f1766f44f87b4cb9f4d3b393) used to distribute rewards and the revenue.
-   $name automatically tops up low cycle balances of users eligible for rewards or revenue sharing.

## Autonomy

$name is designed for full autonomy, guided by decentralization.
It autonomously creates new storage canisters when space runs out.
$name tops up canisters with low cycles using ICP from the Treasury.
The [dashboard](/#/dashboard) provides information on system status and past events.

## Tokenomics

$name has a total supply of `$total_supply`  tokens. Tokens can only be mined. Currently, all users who earn karma automatically mine  `$token_symbol` tokens.
Token minting occurs weekly by converting earned karma to `$token_symbol`  tokens at an exponentially declining ratio.
The ratio starts at  `1:1`  for the first  `10%`  of supply, then decreases to  `2:1`  for the next  `10%`, further decreasing to `4:1`, and so on.
Hence, the last `10%`  of supply will be minted at a ratio of  `512:1`.

Token utility includes governance and ownership of $name's revenue.

#### Team Tokens

`20%` of tokens are allocated to the first two users forming an informal bootstrapping team before the tokenization:

-   `18%` to @X (founder and the only software developer),
-   `2%` to @mechaquan (growth & marketing).

Tokens are minted weekly, with each user receiving an amount equal to `1%` of the current supply if and only if one of the following conditions are met:

-   Their individual share is below `14%` of minted supply.
-   `2/3` of the total supply has been minted.

Vesting tokens:

-   @mechaquan: `$vesting_tokens_m`
-   @X: `$vesting_tokens_x`

## Rewards and Revenue Distribution

-   During positive interactions, users can receive karma from other users.
-   Earned karma points are converted to rewards during the next distribution.
-   Rewards are calculated by converting `$native_cycles_per_xdr` karma points to ICP at the cycle minting rate (`1 XDR` / `$native_cycles_per_xdr`).
-   Additionally, users owning tokens and being active within the last `$revenue_share_activity_weeks` weeks receive a share of $name's revenue proportionate to their token holdings.
-   Users are excluded from both distributions if their ICP payout is less than `100` times the transaction fee. Such users carry over their accumulated karma to the next round. Note that in this case, minting is also delayed.

## Bootcamp

New users undergo a "bootcamp" period lasting `$trusted_user_min_age_weeks` weeks.
During this period, users cannot impact others' karma through engagements, downvote posts, or vote on proposals.
If after the bootcamp period a user still has less than `$trusted_user_min_karma` karma points, they remain in bootcamp until the karma threshold is reached.

## Stalwarts

Stalwarts represent the top `$stalwart_percentage%` of users with the highest karma, active during the last `$min_stalwart_activity_weeks` consecutive weeks, possessing accounts older than `$min_stalwart_account_age_weeks` weeks, and maintaining at least `$proposal_rejection_penalty` karma points.
They are considered trusted community members, authorized to carry out moderating actions and propose upgrades.

## Realms

Realms are sub-communities centered around specific topics.
Each realm can establish its own terms and conditions, breaching which can lead to:

-   Flagging of the user's post to stalwarts.
-   Removal of the post from the realm, incurring a penalty of `$realm_cleanup_penalty` cycles and karma points.

Upon joining a realm, users implicitly agree to its terms and conditions.

## Content Policy

Decentralization does not equate to lawlessness!
Content permitted on $name aligns with community-approved moderation guidelines.
Content not permitted on $name falls into one of the following categories:

-   Posts that jeopardize $name as a public service (e.g., those illegal in many jurisdictions).
-   Posts created with malicious intent, such as gaming the $name system, or posing threats to the community, sustainability, or decentralization of $name.
-   Posts that violate realm-specific rules.

This policy is intentionally broad and necessitates social consensus among stalwarts.

**Posts contravening this policy are subject to moderation.**

## Moderation

Moderation on $name is decentralized; anyone can initiate it, and stalwarts can execute it.
Whenever a post or user is reported, all stalwarts receive notifications and are expected to validate or dismiss the report.
Once `$report_confirmation_percentage%` of stalwarts concur on the report's validity, it is closed.
For majority-confirmed reports:

-   The violating user loses `$reporting_penalty_post` (post report) or `$reporting_penalty_misbehaviour` (user report) karma points, along with an equivalent amount of cycles.
-   The reporter receives half of this penalty as karma points.

If stalwarts dismiss the report, the reporter loses half the penalty as cycles and karma points.
In both cases, participating stalwarts share karma points from the penalty fee, capped at `$stalwart_moderation_reward`.

## Cost Table

Interactions with other users consume cycles. Below is a breakdown of costs.

| Function             |        Cycles 🔥 | Comments                                     |
| :------------------- | ---------------: | :------------------------------------------- |
| New post or comment  |     `$post_cost` | Excluding hashtags                           |
| Hashtags             |  `T * $tag_cost` | For `T` unique hashtags in a post or comment |
| On-chain pictures    | `B * $blob_cost` | For `B` pictures in a post or comment        |
| Poll                 |     `$poll_cost` | For adding a poll to a post or comment       |
| Reacting with ❤️     |              `2` | Burns `$reaction_fee` cycle, adds `1` karma  |
| Reacting with 🔥, 😆 |              `6` | Burns `$reaction_fee` cycle, adds `5` karma  |
| Reacting with ⭐️    |             `11` | Burns `$reaction_fee` cycle, adds `10` karma |
| Reacting with 👎     |              `3` | Burns `3` cycles and karma of post's author  |
| New realm creation   |    `$realm_cost` | Burns `$realm_cost` cycles                   |

Notes:

1. Karma donated to the same user via engagements described above declines by `$karma_donation_decline_percentage%` every time when more than `1` karma point is donated.
2. Each response to a post increases the author's karma by `$response_reward`.
3. Inactive users' karma and cycles decrease by `$inactivity_penalty` per week after `$inactivity_duration_weeks` weeks of inactivity.
4. Users with negative karma don't participate in distributions.

## Proposals

A proposal succeeds if `$proposal_approval_threshold%` of users approve it or fails if `(100 - $proposal_approval_threshold)%` of users reject it.
Only tokens of registered users active within `$voting_power_activity_weeks` weeks count as participating votes.
To prevent low-quality proposals, a proposal rejected with a rejected/adopted ratio under `$proposal_controversy_threashold%` incurs a loss of `$proposal_rejection_penalty` karma points and cycles for the proposer.

The total voting power of all registered users required to adopt or reject a proposal decreases daily by `1%` while the proposal remains open.
This is achieved by multiplying the total available voting power by a factor `d%`, where `d` is the number of days the proposal remains open.
This ensures any proposal eventually passes within `100` days.

Voting is rewarded with `$voting_reward` karma points.
When a proposal is pending, rewards and token minting are deferred until this proposal is rejected or adopted.

## Bots

$name users can become bots by adding principal IDs in account settings.
These IDs (canisters or self-authenticating) can call $name's `add_post` method in Candid format as follows:

    "add_post": (text, vec record { text; blob }, opt nat64, opt text) -> (variant { Ok: nat64; Err: text });

Arguments:

-   `text`: body text.
-   `vec record {text; blob}`: vector of attached pictures, each tuple containing a blob ID and the blob itself. Tuple requirements:
    -   ID length < `9` characters.
    -   Blob < `$max_blob_size_bytes` bytes.
    -   Pictures referenced from the post by URL `/blob/<id>`.
-   `opt nat64`: parent post ID.
-   `opt text`: realm name.

Note: #IC doesn't support messages > `2Mb`.
The result of `add_post` contains the new post's ID or an error message.

## DAO Neuron

$name DAO votes on NNS proposals with neuron [$neuron_id](http://dashboard.internetcomputer.org/neuron/$neuron_id) and doesn't follow anyone.

#### Neuron Decentralization

Neuron's controller lacks a known secret key.
The main canister votes via the hot-key mechanism.
The neuron doesn't follow anyone in neuron management.
$name canister's `get_neuron_info` method confirms this:

    dfx canister --network ic call $canister_id get_neuron_info

#### Voting

Proposals categorized as "Governance", "Network Economics", "Replica Version Management," and "SNS & Community Fund" display as posts with polls.
$name canister votes on these proposals after 3 days, weighted by voters' square root of karma.

Other proposals are automatically rejected.
$name DAO commits to:

1. Attract voters to other topics over time.
2. Find followees or vote themselves if automated rejection harms #IC.

## Code and Bug Bounty

$name's [code](https://github.com/TaggrNetwork/taggr) is open source, under GPL license.

$name's DAO has a bug bounty program with classifications and rewards in `$token_symbol`.

| SEV | DESCRIPTION                                                                                                                        | BOUNTY |
| :-: | ---------------------------------------------------------------------------------------------------------------------------------- | -----: |
|  0  | Bugs enabling unsanctioned state mutations affecting assets like cycles, karma, tokens, Treasury, or critically endangering $name. | `1000` |
|  1  | Bugs enabling unsanctioned state mutations affecting data, with moderate impact on decentralization or autonomy.                   |  `400` |
|  2  | Bugs enabling unsanctioned state mutations without substantial impact on $name.                                                    |  `100` |

Report bugs to stalwarts immediately if they fall under any of these categories.
