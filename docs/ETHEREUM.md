# Ethereum Migration

TAGGR moves to an ERC20 on Ethereum L1. Phase 1 is the token and a one-way IC → L1 bridge (no L1 → IC path). Phase 2 locks L1 tokens into a stake contract that counts as taggr voting power and can hand token control to L1. Later phases grow governance.

# Phase 1 — Token and bridge

## Decisions

| Topic                 | Decision                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- |
| L1                    | Ethereum mainnet only (chain id 1)                                                     |
| Digest scheme         | EIP-712                                                                                |
| Recipe deadline       | None — replay protection is the mint index bitmask, controller nominations use a nonce |
| Role-change signing   | Deferred to the governance phase; no user-reachable signing in phase 1                 |
| Decimals / max supply | 18 decimals, `MAX_SUPPLY = 1e24` wei (1,000,000 TAGGR)                                 |
| Bridge economics      | No protocol fee; signing cycles charged at cost in credits; minimum 1 TAGGR            |
| Controller change     | Two-step nominate/accept                                                               |
| Frontend              | In-app `/ethereum` page with an injected EIP-1193 wallet; no relayer or WalletConnect  |

## Canister EOA

Implemented: secp256k1, key `CONFIG.ecdsa_key_name` (`dfx_test_key` dev, `key_1` mainnet), derivation path `b"ethereum"` (`src/backend/env/ethereum.rs`), address cached in state and exposed via `eth_address`.

Signing endpoint (implemented):

-   `sign_with_ecdsa` through `canisters::call_canister_with_payment` (upgrade guard), attaching `ic_cdk::api::cost_sign_with_ecdsa`.
-   Signs only canister-constructed digests. No `sign(hash)` endpoint; that would be a signing oracle for the EOA.
-   Low-s (EIP-2), 65-byte `r || s || v`; `v` by recovering both ids against the cached address (`k256/ecdsa`).
-   Authenticated trigger; cycles cost charged in credits.

## Token contract

Immutable ERC20 on OpenZeppelin; no proxy, pause or fees; `burn(amount)` is self-only and reduces `totalSupply`, so explorer supply accounting stays on-chain. 18 decimals, `MAX_SUPPLY = 1e24` wei. `mint` is minter-only; `controller` sets the minter and transfers control two-step (`nominateController` / `acceptController`). `mintWithAuthorization(to, amount, index, sig)` and `nominateControllerWithAuthorization(candidate, nonce, sig)` are permissionless (anyone may relay) and verify EIP-712 signatures against the current role holder; the latter is reserved for a later handover.

Replay protection for mints is a bitmask over the canister-assigned, monotonically increasing recipe `index`; each signature is stored with its recipe, and a failed signing consumes only the index. One slot covers 256 mints. Controller nominations do not use indices: they carry `nominationNonce`, the controller generation, which moves on every nomination and on every `acceptController`, so a nomination signature is single use and never shares state with mint recipes. Events: `MinterChanged`, `ControllerNominated`, `ControllerChanged`.

## Digest

EIP-712 domain: name `TAGGR`, version `1`, chainId `1`, `verifyingContract` = token. Mint struct: `Mint(address to, uint256 amount, uint256 index)`. Nomination struct: `NominateController(address candidate, uint256 nonce)`. No deadline: the index and the nomination nonce prevent reuse, the recipient and candidate are fixed, and a minter or controller rotation invalidates pending signatures (drain recipes before rotating). 1 IC base unit = `1e16` wei.

## Bridge

`EthMintRecipe { index, user_id, eth_address, amount, burn_block, signature }` in stable state, never `#[serde(skip)]`; every field has a `serde` default so recipes and the bridge state stay readable when fields are added. `bridge_out(amount, eth_address)` is authenticated: validate the address and the minimum (1 TAGGR), refuse the caller while an emergency-proposal vote is registered or while the caller has an open proposal (which locks tokens), then check the balance, charge the signing fee, reserve the index, build the digest, await `sign_with_ecdsa`, then atomically burn (fee 0), store the recipe with its signature and return both, so a stored recipe always has a matching burn. The fee is exactly the cycle cost of one signature, so it is charged off the revenue ledger (not `State::charge`): counting it as revenue would distribute ICP the canister also pays for the signature. The fee is charged before signing and is not refunded: it pays for the signature attempt, so a failed signing or a failed burn costs an index and the fee but produces no recipe. `eth_recipes` returns the caller's recipes, `bridge_recipe(index)` is a public query. The caller must be a registered user, calling from its own principal: cold wallet principals are refused, because `link_cold_wallet` is a one-sided claim — any unregistered principal can link itself to a user that has no cold wallet yet — and resolving the caller through it would let a stranger burn at the linked user's expense and charge that user the signing fee. Lifting this requires a consented link (`docs` risk list below); balances on subaccounts are not bridgeable. The burn inherits existing escrow and emergency-vote locks (`token.rs:440`, `:496`).

Supply: `ic_total_supply + bridged_out + new_mint <= maximum_supply`, computed once by `State::total_supply` / `remaining_supply`, with `bridged_out` cumulative and persisted. Enforced at weekly mining, founder vesting, auction close and Funding/Rewards execution; `TokenStats::circulating_supply` stays IC-only and `bridged_out` is exposed next to it.

## Deployment, testing, risks

-   Mainnet; the token constructor sets `minter` and `controller` to the canister EOA; phase 2 hands the controller to the stake contract via the reserved signed nomination, which must be signed against the current `nominationNonce()` and relayed promptly, since any nomination moves the nonce and makes it stale. Verified source; cycles budgeted; desktop-only injected-wallet UI on `/ethereum`.
-   Foundry: mint paths, index reuse, wrong signer, cap, two-step controller, signed nomination (single use, stale after a direct nomination and after a handover), events. Rust: digest vector, signature normalisation and recovery, address parsing and fee conversion, bridge pre-checks (user, refused cold wallet, key readiness, balance, locks) and the supply cap (`total_supply`, `mint_tokens`, Funding validation). E2E: **not implemented yet**. Nothing exercises a canister signature against a deployed `TaggrToken`, so the two suites above cover the wire format only from their own side. Also unverified: the local replica's `cost_sign_with_ecdsa("dfx_test_key")` cost — if it reports zero cycles, the `fee == 0` guard in `bridge_out` refuses every dev bridge. The `dev` build points at Anvil (`chain id 31337`, token `0x5FbDB2315678afecb367f032d93F642f64180aa3`).
-   Risks: trusted peg until governance (canister can mint to the cap); the contract cannot verify IC burns, the signature is the sole proof; canister key loss breaks the peg; a backup/restore index regression makes one recipe unmintable (fails safe, no double mint); immutable, bugs are fixed by migration; `link_cold_wallet` takes no approval from the linked user, so any unregistered principal can claim a user that has no cold wallet — it inflates that user's `total_balance`/VP with the claimant's tokens, distorts `token_stats` attribution and is re-linkable after an `unlink_cold_wallet`, so linking needs a consented two-step flow (user nominates, cold principal accepts, like `request_principal_change` / `change_principal`) before cold-wallet bridging can come back.

# Phase 2 — Stake contract and L1 voting power

Goal: L1-locked TAGGR counts as taggr voting power, and token control can move to L1 without the canister.

## Decisions

| Topic              | Decision                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| Scope              | Staking and one controller-handover action; no params, no topics, no general proposals |
| Token controller   | The stake contract (at deployment, or via phase 1's reserved nomination)               |
| Token minter       | Canister EOA, unchanged                                                                |
| Handover floor     | `min(100k TAGGR, totalSupply / 2)` at execution                                        |
| Approval threshold | 66% of total locked at execution                                                       |
| Timelock           | 30 days minimum from nomination to execution                                           |
| Nominations        | One pending at a time                                                                  |
| Guardian veto      | Canister signer; pending nominations only                                              |
| Unlock period      | 7 days                                                                                 |
| Cancel unlock      | Allowed via `cancelUnlock()` until withdrawal                                          |
| VP counting        | Until withdrawal (locked and unlocking tokens count)                                   |
| L1 reads           | Daily batched `eth_call`s via the EVM RPC canister                                     |

## Stake contract

Immutable; token address, guardian, floor and threshold are constructor constants.

-   `stake(amount)` transferFrom; reverts while unlocking.
-   `startUnlock()` starts the 7-day clock; `cancelUnlock()` any time before `withdraw()` resets it; `withdraw()` returns the tokens after 7 days.
-   Views: `lockedOf(address)`, `lockedOf(address[])`, `totalLocked()`, `unlockStartedAt(address)`.
-   `proposeController(nominee)` opens the single pending nomination; `approve()` records the caller's locked balance as approval weight; `execute()` checks timelock, floor and threshold, calls `token.nominateController(nominee)` and clears the nomination; `veto(seq, sig)` is guardian-only while a nomination is pending and verifies an EIP-712 `Veto(address nominee, uint256 seq)` under the stake contract's domain; `acceptTokenController()` is permissionless and makes the contract call `token.acceptController()`.

Approval weight is each approver's locked balance, kept live in O(1): `approve()` sets it, later `stake()` increases it, `startUnlock()`/`withdraw()` revoke it. The pass condition is `approvalsWeight * 100 >= 66 * totalLocked`, measured at execution, so staking more dilutes an attacker. VP counts until withdrawal, but a handover approval dies as soon as unlocking starts.

## Handover semantics

The elected address becomes the token controller (root role), not the minter; the token's two-step accept applies, after which it can `setMinter` and nominate successors. The stake contract disables its own path once it is no longer controller. If the canister is dead, the staker path still works provided the floor is reachable; `min(100k, totalSupply/2)` keeps small economies self-governable.

## Taggr integration

-   `link_eth_address(address, sig)` verifies an EIP-712 signature binding canister/domain, principal, address and nonce (k256 recovery); one address maps to one user; `unlink_eth_address` removes it.
-   A daily timer reads `lockedOf(linked_addresses)` in 200–400 chunks via EVM RPC (`eth_call` at a finalized block, 2-of-3 provider agreement) and persists `last_l1_sync`, the block, and per-user `l1_locked`.
-   `total_balance = balance + cold_balance + l1_locked`; it counts wherever cold balance does.
-   If the last sync is older than the staleness threshold, taggr pauses proposal execution and the expiry clock and raises an alarm; emergency release is exempt.

## Risks and open details

-   Borrowed stake: taking over needs `1.94x` the honest locked stake held 30 days, and any exit revokes it; honest staking dilutes.
-   Early IC death: the `min` floor keeps control reachable; nothing bridged means nothing to govern.
-   Controller handover window: if the canister dies before phase 2 transfers the controller, control is stranded. Accepted risk; ship the phases close together.
-   Guardian can veto while the canister is alive (already trusted as minter); EVM RPC consensus, response limits and cycles; the stake contract has no admin escape hatch by design, so an immutable-code bug can trap funds or block the handover.
-   Open: veto trigger (recommended after a passed taggr proposal), nomination cancellation/replacement/expiry, staleness threshold (e.g. 48h).
