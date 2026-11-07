import {
    HeadBar,
    Loading,
    ButtonWithLoading,
    confirmPopUp,
    promptPopUp,
    timeAgo,
    token,
    percentage,
    FileUploadInput,
    tokenBalance,
    NotFound,
    tokens,
    hex,
    parseNumber,
    REPO,
    handleError,
    showPopUp,
    onCanonicalDomain,
    UnavailableOnCustomDomains,
    TabBar,
} from "./common";
import * as React from "react";
import { HourGlass } from "./icons";
import { PostFeed } from "./post_feed";
import { Payload, PostId, Proposal, User } from "./types";
import { UserLink, UserList } from "./user_resolve";
import { Form } from "./form";
import { newPostCallback } from "./new";

const REPO_COMMIT = `${REPO}/commit`;
const REPO_COMPARE = `${REPO}/compare`;

let timer: any = null;

export enum ProposalType {
    ICPTransfer = "ICP TRANSFER",
    AddRealmController = "ADD REALM CONTROLLER",
    Funding = "FUNDING",
    Rewards = "REWARDS",
    Release = "RELEASE",
}

// Enum values are API payloads; only the labels are sentence case.
const PROPOSAL_TYPE_LABELS: { [type: string]: string } = {
    [ProposalType.ICPTransfer]: "ICP transfer",
    [ProposalType.AddRealmController]: "Add realm controller",
    [ProposalType.Funding]: "Funding",
    [ProposalType.Rewards]: "Rewards",
    [ProposalType.Release]: "Release",
    ALL: "All",
    "REALM CONTROLLER": "Realm controller",
};

export const proposalTypeLabel = (type: string) =>
    PROPOSAL_TYPE_LABELS[type] || type;

export const Proposals = () => {
    const [selectedType, setSelectedType] = React.useState("ALL");

    return (
        <>
            <HeadBar
                title="Proposals"
                shareLink="proposals"
                menu={true}
                burgerTestId="proposals-burger-button"
                content={window.user ? <ProposalForm /> : false}
            />
            <TabBar
                tabs={[
                    "ALL",
                    "RELEASE",
                    "FUNDING",
                    "REWARDS",
                    "REALM CONTROLLER",
                    "ICP TRANSFER",
                ]}
                labels={PROPOSAL_TYPE_LABELS}
                activeTab={selectedType}
                onTabChange={setSelectedType}
            />
            <PostFeed
                key={selectedType}
                emptyMessage="No proposals yet."
                useList={true}
                feedLoader={async (page) =>
                    await window.api.query("proposals", page, selectedType)
                }
            />
        </>
    );
};

const ProposalForm = ({}) => {
    const [balance, setBalance] = React.useState<number>(0);

    React.useEffect(() => {
        window.api
            .query<[number, number]>("proposal_escrow_balance_required")
            .then((resp) => {
                const [escrow_tokens, already_locked]: [number, number] =
                    resp || [0, 0];
                setBalance(escrow_tokens + already_locked);
            });
    }, []);

    const userBalance = window.user.balance;

    return (
        <>
            <h2>New proposal form</h2>
            {onCanonicalDomain() ? (
                userBalance >= balance ? (
                    <Form
                        proposalCreation={true}
                        submitCallback={newPostCallback}
                    />
                ) : (
                    <div className="banner">
                        To open a new proposal, you need to have at least{" "}
                        {token(balance)}{" "}
                        {window.backendCache.config.token_symbol} on your
                        balance.
                    </div>
                )
            ) : (
                <UnavailableOnCustomDomains />
            )}
        </>
    );
};

export const ProposalMask = ({
    proposalType,
    saveProposal,
}: {
    proposalType: ProposalType;
    saveProposal: (payload: Payload) => void;
}) => {
    const [receiver, setReceiver] = React.useState("");
    const [fundingAmount, setFundingAmount] = React.useState(0);
    const [icpAmount, setICPAmount] = React.useState(0);
    const [userName, setUserName] = React.useState("");
    const [realmId, setRealmId] = React.useState("");
    const [binary, setBinary] = React.useState(new Uint8Array());
    const [commit, setCommit] = React.useState("");

    const validateAndSaveProposal = async () => {
        switch (proposalType) {
            case ProposalType.AddRealmController:
                const user = await window.api.query<User>("user", "", [
                    userName,
                ]);
                if (!user) {
                    showPopUp("error", `No user ${userName} found!`);
                    return;
                }
                saveProposal({
                    ["AddRealmController"]: [realmId, user.id],
                });
                break;
            case ProposalType.ICPTransfer:
                saveProposal({
                    ["ICPTransfer"]: [
                        hexToBytes(receiver),
                        {
                            e8s: parseNumber(icpAmount.toString(), 8) || 0,
                        },
                    ],
                });
                break;
            case ProposalType.Rewards:
                saveProposal({
                    ["Rewards"]: {
                        receiver,
                        minted: 0,
                    },
                });
                break;
            case ProposalType.Funding:
                saveProposal({
                    ["Funding"]: [
                        receiver,
                        parseNumber(
                            fundingAmount.toString(),
                            window.backendCache.config.token_decimals,
                        ) || 0,
                    ],
                });
                break;
            default:
                saveProposal({
                    ["Release"]: {
                        commit,
                        hash: "",
                        binary,
                    },
                });
        }
    };

    // Reset the mask when the proposal type changes: the fields of the
    // previously selected type would otherwise leak into the new payload.
    React.useEffect(() => {
        setReceiver("");
        setFundingAmount(0);
        setICPAmount(0);
        setUserName("");
        setRealmId("");
        setBinary(new Uint8Array());
        setCommit("");
    }, [proposalType]);

    React.useEffect(() => {
        if (
            receiver ||
            fundingAmount ||
            icpAmount ||
            userName ||
            realmId ||
            binary.length > 0 ||
            commit
        ) {
            clearTimeout(timer);
            timer = setTimeout(validateAndSaveProposal, 1000);
        }
    }, [receiver, fundingAmount, icpAmount, userName, realmId, binary, commit]);

    return (
        <div className="vertically_spaced">
            {proposalType == ProposalType.AddRealmController && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        New controller
                        <input
                            aria-label="New controller"
                            type="text"
                            className="left_half_spaced max_width_col"
                            value={userName}
                            onChange={async (ev) => {
                                setUserName(ev.target.value);
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        Realm
                        <input
                            aria-label="Realm"
                            type="text"
                            className="left_half_spaced max_width_col"
                            value={realmId}
                            onChange={async (ev) => {
                                setRealmId(ev.target.value);
                            }}
                        />
                    </div>
                </div>
            )}
            {proposalType == ProposalType.ICPTransfer && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        ICP address
                        <input
                            aria-label="ICP address"
                            type="text"
                            className="left_half_spaced max_width_col"
                            onChange={async (ev) => {
                                setReceiver(ev.target.value.toString());
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        ICP amount
                        <input
                            aria-label="ICP amount"
                            type="text"
                            className="left_half_spaced max_width_col"
                            onChange={async (ev) => {
                                setICPAmount(Number(ev.target.value));
                            }}
                        />
                    </div>
                </div>
            )}
            {(proposalType == ProposalType.Funding ||
                proposalType == ProposalType.Rewards) && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        Principal
                        <input
                            aria-label="Principal"
                            type="text"
                            className="left_half_spaced max_width_col"
                            onChange={async (ev) => {
                                setReceiver(ev.target.value);
                            }}
                        />
                    </div>
                    {proposalType == ProposalType.Funding && (
                        <div className="vcentered bottom_half_spaced">
                            Token amount
                            <input
                                aria-label="Token amount"
                                type="text"
                                className="left_half_spaced max_width_col"
                                onChange={async (ev) => {
                                    setFundingAmount(Number(ev.target.value));
                                }}
                            />
                        </div>
                    )}
                </div>
            )}
            {proposalType == ProposalType.Release && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        Git commit
                        <input
                            aria-label="Git commit"
                            type="text"
                            className="left_half_spaced max_width_col"
                            onChange={async (ev) => {
                                setCommit(ev.target.value);
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        BINARY{" "}
                        <FileUploadInput
                            classNameArg="left_half_spaced max_width_col"
                            callback={setBinary as unknown as any}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export const ProposalView = ({
    id,
    postId,
}: {
    id: number;
    postId: PostId;
}) => {
    const [status, setStatus] = React.useState(0);
    const [proposal, setProposal] = React.useState<Proposal>();

    const loadState = async () => {
        const result = await window.api.query<any>("proposal", id);
        if (!result || "Err" in result) {
            setStatus(-1);
            return;
        }
        setStatus(1);
        setProposal(result.Ok);
        return result.Ok;
    };

    React.useEffect(() => {
        loadState();
    }, []);

    if (status < 0) return <NotFound />;
    if (!proposal || status == 0) return <Loading />;
    // @ts-ignore
    if (proposal.payload == "Noop")
        return <div className="banner">Unsupported proposal type</div>;

    const statusEmoji = (status: string) => {
        return (
            { Open: "✨", Rejected: "🟥", Cancelled: "❌", Executed: "✅" }[
                status
            ] || <HourGlass />
        );
    };

    const vote = async (proposal: Proposal, adopted: boolean) => {
        let data;
        if (adopted) {
            if ("Release" in proposal.payload) {
                data = await promptPopUp(
                    "Please enter the build hash from the source code commit mentioned in the proposal " +
                        "(this proves that the proposer uploaded the binary that can be reproduced from this source code):",
                );
                if (!data) return;
            }
            if ("Rewards" in proposal.payload) {
                const { max_funding_amount, token_symbol } =
                    window.backendCache.config;
                const cap = token(max_funding_amount);
                data = await promptPopUp(
                    `Please enter the amount of ${token_symbol} tokens which would be an appropriate reward for the efforts described (max. ${cap} ${token_symbol}):`,
                );
                if (!data) return;
                if (
                    !(await confirmPopUp(
                        `You vote for issuing the reward of ${data} tokens.`,
                    ))
                )
                    return;
            }
        }
        const result = await window.api.call<any>(
            "vote_on_proposal",
            proposal.id,
            adopted,
            data || "",
        );
        if (handleError(result)) return;
        window.api.call("toggle_following_post", postId);
        await loadState();
    };

    const voted =
        !window.user ||
        proposal.bulletins.some((vote) => window.user.id == vote[0]);
    const adopted = proposal.bulletins.reduce(
        (acc, [_, adopted, votes]) => (adopted ? acc + votes : acc),
        0,
    );
    const rejected = proposal.bulletins.reduce(
        (acc, [_, adopted, votes]) => (!adopted ? acc + votes : acc),
        0,
    );
    const open = proposal.status == "Open";
    const commit =
        "Release" in proposal.payload ? proposal.payload.Release.commit : null;
    const hash =
        "Release" in proposal.payload ? proposal.payload.Release.hash : null;
    const dailyDrop = proposal.voting_power / 100;
    const t = window.backendCache.config.proposal_approval_threshold;
    const days = Math.ceil(
        (proposal.voting_power -
            (adopted > rejected ? adopted / t : rejected / (100 - t)) * 100) /
            dailyDrop,
    );
    const propStatus = proposal.status;
    return (
        <div
            key={proposal.timestamp.toString()}
            className="post_extension column_container"
            data-testid="extension-proposal"
        >
            <div className="bottom_half_spaced">
                ID: <code>{proposal.id}</code>
            </div>
            <div className="bottom_half_spaced">
                Type:{" "}
                <strong>
                    {
                        // @ts-ignore
                        ProposalType[Object.keys(proposal.payload)[0]]
                    }
                </strong>
            </div>
            <div className="bottom_half_spaced">
                PROPOSER: <UserLink id={proposal.proposer} />
            </div>
            <div className="bottom_half_spaced">
                Created: {timeAgo(proposal.timestamp)}
            </div>
            <div className="bottom_spaced">
                Status: {statusEmoji(propStatus)}{" "}
                <span className={open ? "accent" : undefined}>
                    {propStatus}
                </span>
            </div>
            {"Release" in proposal.payload && (
                <div className="bottom_spaced">
                    {commit && (
                        <div className="row_container bottom_half_spaced">
                            <span>Code links:</span>
                            <a
                                className="breakable left_half_spaced"
                                href={`${REPO_COMMIT}/${proposal.payload.Release.commit}`}
                            >
                                Git commit
                            </a>
                            {open && (
                                <>
                                    <span className="left_half_spaced">
                                        &middot;
                                    </span>
                                    <a
                                        className="breakable left_half_spaced"
                                        href={`${REPO_COMPARE}/${window.backendCache.stats.last_release.commit}..${commit}`}
                                    >
                                        Diff with previous release
                                    </a>
                                </>
                            )}
                        </div>
                    )}
                    {!open && (
                        <div className="row_container">
                            <span>Build hash:</span>
                            <code className="left_half_spaced breakable">
                                {hash}
                            </code>
                        </div>
                    )}
                </div>
            )}
            {"AddRealmController" in proposal.payload && (
                <>
                    <div className="bottom_half_spaced">
                        New controller:{" "}
                        <UserLink id={proposal.payload.AddRealmController[1]} />
                    </div>
                    <div className="bottom_spaced">
                        Realm:{" "}
                        <a
                            href={`#/realm/${proposal.payload.AddRealmController[0]}`}
                        >
                            {proposal.payload.AddRealmController[0]}
                        </a>
                    </div>
                </>
            )}
            {"ICPTransfer" in proposal.payload && (
                <>
                    <div className="bottom_half_spaced">
                        Receiver:{" "}
                        <code className="breakable">
                            {hex(proposal.payload.ICPTransfer[0])}
                        </code>
                    </div>
                    <div className="bottom_spaced">
                        Amount:{" "}
                        <code>
                            {tokens(
                                Number(proposal.payload.ICPTransfer[1].e8s),
                                8,
                            )}
                        </code>
                    </div>
                </>
            )}
            {"Rewards" in proposal.payload && (
                <>
                    <div className="bottom_half_spaced">
                        Receiver:{" "}
                        <a
                            className="breakable"
                            href={`#/transactions/${proposal.payload.Rewards.receiver.toString()}`}
                        >
                            {proposal.payload.Rewards.receiver.toString()}
                        </a>
                    </div>
                    {proposal.status == "Executed" && (
                        <div className="bottom_spaced">
                            Tokens minted:{" "}
                            <code>
                                {tokenBalance(proposal.payload.Rewards.minted)}
                            </code>
                        </div>
                    )}
                </>
            )}
            {"Funding" in proposal.payload && (
                <>
                    <div className="bottom_half_spaced">
                        Receiver:{" "}
                        <a
                            className="breakable"
                            href={`#/transactions/${proposal.payload.Funding[0].toString()}`}
                        >
                            {proposal.payload.Funding[0]}
                        </a>
                    </div>
                    <div className="bottom_spaced">
                        Amount:{" "}
                        <code>{tokenBalance(proposal.payload.Funding[1])}</code>
                    </div>
                </>
            )}
            <div className="bottom_spaced">
                Effective voting power:{" "}
                <code>{token(proposal.voting_power)}</code>
            </div>
            {open && !isNaN(days) && (
                <div className="bottom_spaced">
                    EXECUTION DEADLINE: <strong>{days} DAYS</strong>
                </div>
            )}
            <div className="bottom_spaced">
                <div className="bottom_half_spaced">
                    Accepted:{" "}
                    <b
                        className={`right_half_spaced ${
                            adopted > rejected && open ? "accent" : undefined
                        }`}
                    >
                        {token(adopted)}
                    </b>
                    ({percentage(adopted, proposal.voting_power)})
                </div>
                <div className="small_text">
                    <UserList
                        ids={proposal.bulletins
                            .filter((vote) => vote[1])
                            .map((vote) => vote[0])}
                    />
                </div>
            </div>
            <div className="bottom_spaced">
                <div className="bottom_half_spaced">
                    Rejected:{" "}
                    <b
                        className={`right_half_spaced ${
                            adopted < rejected && open ? "accent" : undefined
                        }`}
                    >
                        {token(rejected)}
                    </b>
                    ({percentage(rejected, proposal.voting_power)})
                </div>
                <div className="small_text">
                    <UserList
                        ids={proposal.bulletins
                            .filter((vote) => !vote[1])
                            .map((vote) => vote[0])}
                    />
                </div>
            </div>
            {window.user &&
                open &&
                (onCanonicalDomain() ? (
                    <>
                        {!voted && (
                            <>
                                <div className="row_container">
                                    <ButtonWithLoading
                                        onClick={async () =>
                                            (await confirmPopUp(
                                                "You're rejecting the proposal. Please confirm.",
                                            )) && (await vote(proposal, false))
                                        }
                                        classNameArg="max_width_col"
                                        label="Reject"
                                    />
                                    <ButtonWithLoading
                                        onClick={() => vote(proposal, true)}
                                        classNameArg="max_width_col"
                                        label="Accept"
                                    />
                                </div>
                            </>
                        )}
                        {window.user.id == proposal.proposer && (
                            <ButtonWithLoading
                                onClick={async () => {
                                    if (
                                        !(await confirmPopUp(
                                            "You're cancelling the proposal. Please confirm.",
                                        ))
                                    )
                                        return;
                                    await window.api.call(
                                        "cancel_proposal",
                                        proposal.id,
                                    );
                                    await loadState();
                                }}
                                classNameArg="top_spaced max_width_col"
                                label="Cancel"
                            />
                        )}
                    </>
                ) : (
                    <UnavailableOnCustomDomains />
                ))}
        </div>
    );
};

function hexToBytes(hex: string) {
    let bytes = [];
    for (let i = 0; i < hex.length - 1; i += 2)
        bytes.push(parseInt(hex.substr(i, 2), 16));
    return bytes;
}

export const validateProposal = async (proposal: Payload) => {
    // Release proposals contain a binary and need a special handling
    if ("Release" in proposal) {
        if (!proposal.Release.commit || proposal.Release.binary.length == 0) {
            return "commit or the binary missing";
        }
        return null;
    }

    let result = await window.api.query<any>("validate_proposal", proposal);
    if (result == null || (result && "Err" in result))
        return result ? result.Err : "invalid inputs";

    return null;
};
