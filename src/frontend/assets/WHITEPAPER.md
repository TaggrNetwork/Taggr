# $name

## Introduction

$name is a fully decentralized social media platform that lives on a public distributed compute network powered by the [Internet Computer](https://internetcomputer.org). Unlike traditional social media platforms controlled by corporations, $name is owned and governed entirely by its users.

The most important key points of $name are:

-   $name combines features of forums and blogs.
-   $name is tokenized and is owned and governed by its token holders.
-   $name is completely ad-free and generates revenue.
-   $name uses its revenue to reward content producers, token holders (pro-rata) and to cover storage and compute costs.

### The Economic Model

$name operates with a sustainable economic model:

1. **Getting Started**: New users start with credits (worth approximately $1.39 in value) after making a small payment in either Bitcoin or ICP cryptocurrency.

2. **Credits System**: These credits are gradually consumed when you interact with the platform – posting content, reacting to posts, creating polls, etc.

3. **Revenue Flow**: When you spend credits:

    - Some are directed to content creators as rewards
    - The remainder goes to $name's Treasury as platform revenue
    - This revenue is shared with token holders

4. **Token Utility**: Holding $token_symbol tokens provides:
    - Governance rights (you can vote on platform upgrades)
    - A share of platform revenue
    - Incentives for the developers to keep improving $name

This structure creates a virtuous cycle: users fund the platform through normal usage, content creators are rewarded, and token holders receive revenue – all without relying on advertisements or data harvesting.

## Usage Costs

Each interaction with other users on $name consumes credits.
All payments are directed to [$name's Treasury](https://dashboard.internetcomputer.org/account/dee15d98a70029163c79ace6ec9cf33b21917355f1766f44f87b4cb9f4d3b393) which holds the revenue.
Below is a breakdown of costs.

| Function                     |         credits 🔥 | Comments                                                                                                   |
| :--------------------------- | -----------------: | :--------------------------------------------------------------------------------------------------------- |
| New post or comment          |       `$post_cost` | Per kilobyte.                                                                                              |
| Hashtags                     | `T * followers(T)` | Each unique hashtag `T` is charged with the number of credits corresponding to the number of its followers |
| On-chain pictures            |   `B * $blob_cost` | For `B` pictures in a post or comment                                                                      |
| Poll                         |       `$poll_cost` | For adding a poll to a post or comment                                                                     |
| Reacting with ❤️ , 👍, 😢    |                `2` | Gives `1` reward points, burns the rest as a fee.                                                          |
| Reacting with 🔥, 😂, 🚀, 💯 |                `6` | Gives `5` rewards points, burns the rest as a fee.                                                         |
| Reacting with ⭐️, 🏴‍☠️        |               `11` | Gives `10` reward points, burns the rest as a fee.                                                         |
| Reacting with ❌             |                `3` | Burns `3` credits and rewards of post's author and burns 3 credits of the user.                            |
| New realm creation           |      `$realm_cost` | Burns `$realm_cost` credits                                                                                |

Notes:

1. Each response to a post increases post author's rewards by `$response_reward`.
2. Inactive users' credits decrease by `$inactivity_penalty` per week after `$inactivity_duration_weeks` weeks of inactivity.
3. Users with negative reward balances don't participate in reward distributions or mining.
4. To curb the inorganic behavior, $name automatically charges excess fees for all posts above `$max_posts_per_day`  per rolling 24h interval and for all comments above  `$max_comments_per_hour` per hour.
The fee is computed by multiplying `$excess_penalty` with the number of excessive items. If the excessive items contain images, the computed excess fee is additionally charged per image.

## Rewards and Revenue Distribution

-   During positive interactions, users can receive rewards from other users.
-   Rewards are converted to ICP and distributed to users every Friday if the user did not opt into mining mode.
-   Earned rewards points are converted to ICP at the ratio `$credits_per_xdr` rewards / `$usd_per_xdr` USD.
-   Additionally, users owning tokens and being active within the last `$voting_power_activity_weeks` weeks receive a share of $name's revenue pro-rata to their token holdings.
-   New rewards received by users with credit balance lower than `$credits_per_xdr` are automatically converted to credits and are used to top up the credit balance of these users.

## Stalwarts

Stalwarts represent the top `$stalwart_percentage%` of users with the highest $`$token_symbol`  balance, active during the last  `$min_stalwart_activity_weeks` consecutive weeks and possessing accounts older than `$min_stalwart_account_age_weeks` weeks.
They are considered trusted community members, authorized to carry out moderating actions.

## Realms

Realms are sub-communities centered around specific topics.
Each realm can establish its terms and conditions, breaching which can lead to:

-   Flagging of the user's post to stalwarts.
-   Moving the post from a realm by the realm controller, incurring realm-specific penalties.

Upon joining a realm, users implicitly agree to its terms and conditions.

Currently, `$realm_revenue_percentage%` of revenue generated inside the realm is shared with its controllers.

## Content and Behavior Policy

Decentralization does not equate to lawlessness!
Content and behavior permitted on $name aligns with community-approved moderation guidelines.
Content and behavior not permitted on $name falls into one of the following categories:

-   Content and behavior that jeopardize $name as a public service (e.g., those illegal in relevant jurisdictions).
-   Content or behavior detrimental to the community, sustainability, or decentralization of $name.
-   Content created with malicious intent, such as gaming the $name system.
-   Content and behavior that violate realm-specific rules.

This policy is intentionally broad and necessitates social consensus among stalwarts.

**Posts contravening this policy are subject to moderation.**

## Moderation

Moderation on $name is decentralized; anyone can initiate it, and stalwarts can execute it.
Whenever a post or user is reported, all stalwarts receive notifications and are expected to validate or dismiss the report.
Once `$report_confirmation_percentage%` of stalwarts concur on the report's validity, it is closed.
For confirmed reports:

-   The violating user loses `$reporting_penalty_post` (post report) or `$reporting_penalty_misbehaviour` (user report) rewards, along with an equivalent amount of credits.
-   The reporter receives half of this penalty as rewards.

If stalwarts dismiss the report, the reporter loses half the penalty as credits and rewards.
In both cases, participating stalwarts share rewards from the penalty fee, capped at `$stalwart_moderation_reward`.

## Governance

$name is governed via proposals.
Any user with an account age of `$min_stalwart_account_age_weeks`  weeks and a token balance with a value of at least  `$proposal_escrow_amount_usd` USD can create a proposal.
This number of user's tokens will get locked upon proposal creation and released again after the proposal is executed, cancelled or rejected *without a controversy*.
If the proposal was rejected as controversial, the locked tokens get burned.
Controversial rejections are proposal rejections with a rejected/adopted ratio under  `$proposal_controversy_threshold%`.

There are proposals for upgrading the main smart contract, minting new tokens for funding and rewards, and transferring ICP out of the treasury for off-chain activities of the DAO.

A proposal succeeds if `$proposal_approval_threshold%` of users approve it or fails if `(100 - $proposal_approval_threshold)%` of users reject it.
Only tokens of registered users active within `$voting_power_activity_weeks` weeks count as participating votes.
The total voting power of all registered users required to adopt or reject a proposal decreases daily by `1%` while the proposal remains open.
This is achieved by multiplying the total available voting power by a factor `d%`, where `d` is the number of days the proposal remains open.
This ensures any proposal eventually passes within `100` days.

## Tokenomics

The utility of the `$token_symbol` token is the $name governance and a share in $name's revenue.
$name has a maximal supply of `$maximum_supply` tokens.

### Supply Increase

New tokens can only be mined by users or minted via minting proposals.
Once the maximal supply is reached, both the weekly minting and minting proposals will be suspended.

### Supply Decrease

When a `$token_symbol` transfer transaction gets executed, the fee of `$fee` gets burned.
Once the maximal supply is reached, it can go below the maximum again after enough fees are burned via transfer transactions.
In this case, the minting will be activated again.
This will make the supply keep an equilibrium around the maximal supply.

### Distribution of mined tokens

All users who opted for token mining (can be configured in settings), receive new `$token_symbol` tokens on a weekly basis.
The amount of tokens that every user gets distributed is simply the result of collected ICP rewards during a week divided by the token market price.

### Weekly auction

To determine a fair market price, $name auctions between `$weekly_auction_size_tokens_min`  and  `$weekly_auction_size_tokens_max` tokens each week.
Each user can create a bid by specifying the amount of tokens and the price in ICP they're willing to pay per 1 token.
If there are enough bids to sell out all tokens in the weekly auction, $name mints and distributes tokens to bidders with highest bids according to the sizes of their bids.
The price derived from these bids represents the market price of one token.

### Random rewards

An additional way to distribute tokens is a weekly random reward program.
$name mints `$random_reward_amount` $token_symbol to a random active user.
Chances for getting the reward are proportional to credits spent on new content and reaction fees burned while engaging with other users.

### Founder's Tokens

`18%` of tokens are allocated to @X, the founder of $name.
His tokens are minted weekly, by an amount equal to `1%` of the circulating supply if and only if one of the following conditions are met:

-   The maximum of his current token balance and the amount of his tokens vested so far is below `14%` of minted supply.
-   `2/3` of the total supply has been minted.

Currently vesting tokens: `$vesting_tokens_of_x`.

## Autonomy

$name is designed for full autonomy.
For example, it autonomously creates new storage canisters when space runs out in existing ones.
$name tops up its canisters using ICP from the Treasury.
The [dashboard](/#/dashboard) provides the full information on system status and past events.

## The $name Network Neuron

$name DAO votes on NNS proposals with neuron [$neuron_id](http://dashboard.internetcomputer.org/neuron/$neuron_id) and doesn't follow anyone.

#### Neuron Decentralization

The neuron is only controlled by $name's canister as the assigned neuron's controller lacks a known secret key.
The $name canister votes via the hot-key mechanism.
$name canister's `get_neuron_info` method confirms this:

    dfx canister --network ic call $canister_id get_neuron_info

#### Voting

Proposals categorized as "Governance" and "SNS & Community Fund" are displayed as posts with polls.
$name canister votes on these proposals after 3 days, weighted by voters' token balances.

Other proposals are automatically rejected.
$name DAO commits to:

1. Attract voters to other topics over time.
2. Find followees or vote themselves if automated rejection harms #IC.

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

## Code and Bug Bounty

$name's DAO has a bug bounty program with classifications and rewards in `$token_symbol`.

| SEV | DESCRIPTION                                                                                                                           | BOUNTY |
| :-: | ------------------------------------------------------------------------------------------------------------------------------------- | -----: |
|  0  | Bugs enabling unsanctioned state mutations affecting assets like credits, rewards, tokens, Treasury, or critically endangering $name. | `1000` |
|  1  | Bugs enabling unsanctioned state mutations affecting data, with moderate impact on decentralization or autonomy.                      |  `400` |
|  2  | Bugs enabling unsanctioned state mutations without substantial impact on $name.                                                       |  `100` |

Report bugs to stalwarts immediately if they fall under any of these categories.
