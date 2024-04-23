import {
    HeadBar,
    Loading,
    ButtonWithLoading,
    timeAgo,
    token,
    percentage,
    FileUploadInput,
    tokenBalance,
    NotFound,
    tokens,
    hex,
    parseNumber,
    commaSeparated,
} from "./common";
import * as React from "react";
import { HourGlass } from "./icons";
import { PostFeed } from "./post_feed";
import { Payload, PostId, Proposal, User } from "./types";
import { UserLink, UserList } from "./user_resolve";
import { Form } from "./form";
import { newPostCallback } from "./new";

const REPO_RELEASE = "https://github.com/TaggrNetwork/taggr/releases/latest";
const REPO_COMMIT = "https://github.com/TaggrNetwork/taggr/commit";

let timer: any = null;

export enum ProposalType {
    IcpTranfer = "ICP TRANSFER",
    AddRealmController = "ADD REALM CONTROLLER",
    Funding = "FUNDING",
    Rewards = "REWARDS",
    Release = "RELEASE",
}

export const Proposals = () => (
    <>
        <HeadBar
            title="PROPOSALS"
            shareLink="proposals"
            menu={true}
            burgerTestId="proposals-burger-button"
            content={
                window.user?.stalwart ? (
                    <>
                        <h2>New Proposal Form</h2>
                        <Form
                            proposalCreation={true}
                            submitCallback={newPostCallback}
                        />
                    </>
                ) : undefined
            }
        />
        <PostFeed
            useList={true}
            feedLoader={async (page) =>
                await window.api.query("proposals", page)
            }
        />
    </>
);

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
    const [features, setFeatures] = React.useState("");

    const validateAndSaveProposal = async () => {
        switch (proposalType) {
            case ProposalType.AddRealmController:
                const user = await window.api.query<User>("user", [userName]);
                if (!user) {
                    alert(`No user ${userName} found!`);
                    return;
                }
                saveProposal({
                    ["AddRealmController"]: [realmId, user.id],
                });
                break;
            case ProposalType.IcpTranfer:
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
                        votes: [],
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
                        closed_features: features
                            .split(",")
                            .map((token) => Number(token.trim())),
                    },
                });
        }
    };

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
                        NEW CONTROLLER
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            value={userName}
                            onChange={async (ev) => {
                                setUserName(ev.target.value);
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        REALM
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            value={realmId}
                            onChange={async (ev) => {
                                setRealmId(ev.target.value);
                            }}
                        />
                    </div>
                </div>
            )}
            {proposalType == ProposalType.IcpTranfer && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        ICP ADDRESS
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            onChange={async (ev) => {
                                setReceiver(ev.target.value.toString());
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        ICP AMOUNT
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            onChange={async (ev) => {
                                setICPAmount(Number(ev.target.value));
                            }}
                        />
                    </div>
                </div>
            )}
            {proposalType == ProposalType.Rewards && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        PRINCIPAL
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            onChange={async (ev) => {
                                setReceiver(ev.target.value.toString());
                            }}
                        />
                    </div>
                </div>
            )}
            {proposalType == ProposalType.Funding && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        PRINCIPAL
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            onChange={async (ev) => {
                                setReceiver(ev.target.value);
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        TOKEN AMOUNT
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            onChange={async (ev) => {
                                setFundingAmount(Number(ev.target.value));
                            }}
                        />
                    </div>
                </div>
            )}
            {proposalType == ProposalType.Release && (
                <div className="spaced column_container">
                    <div className="vcentered bottom_half_spaced">
                        GIT COMMIT
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            onChange={async (ev) => {
                                setCommit(ev.target.value);
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        CLOSED FEATURES
                        <input
                            type="text"
                            className="left_spaced max_width_col"
                            placeholder="comma-separated ids"
                            onChange={async (ev) => {
                                setFeatures(ev.target.value);
                            }}
                        />
                    </div>
                    <div className="vcentered bottom_half_spaced">
                        BINARY{" "}
                        <FileUploadInput
                            classNameArg="left_spaced max_width_col"
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
        if ("Err" in result) {
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
        return <div className="banner">UNSUPPORTED PROPOSAL TYPE</div>;

    const statusEmoji = (status: string) => {
        return (
            { OPEN: "✨", REJECTED: "🟥", CANCELLED: "❌", EXECUTED: "✅" }[
                status
            ] || <HourGlass />
        );
    };

    const vote = async (proposal: Proposal, adopted: boolean) => {
        let data;
        if (adopted) {
            if ("Release" in proposal.payload) {
                data = prompt(
                    "Please enter the build hash from the source code commit mentioned in the proposal " +
                        "(this proves that the proposer uploaded the binary that can be reproduced from this source code):",
                );
                if (!data) return;
            }
            if ("Rewards" in proposal.payload) {
                const { max_funding_amount, token_symbol } =
                    window.backendCache.config;
                const cap = token(
                    max_funding_amount /
                        window.backendCache.stats.minting_ratio,
                );
                data = prompt(
                    `Please enter the amount of ${token_symbol} tokens which would be an appropriate reward for the efforts described (max. ${cap} ${token_symbol}):`,
                );
                if (!data) return;
                if (
                    !confirm(
                        `You vote for issuing the reward of ${data} tokens.`,
                    )
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
        if ("Err" in result) {
            alert(`Error: ${result.Err}`);
            return;
        }
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
    const closed_features =
        "Release" in proposal.payload
            ? proposal.payload.Release.closed_features
            : [];
    const hash =
        "Release" in proposal.payload ? proposal.payload.Release.hash : null;
    const dailyDrop = proposal.voting_power / 100;
    const t = window.backendCache.config.proposal_approval_threshold;
    const days = Math.ceil(
        (proposal.voting_power -
            (adopted > rejected ? adopted / t : rejected / (100 - t)) * 100) /
            dailyDrop,
    );
    const propStatus = proposal.status.toUpperCase();
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
                TYPE:{" "}
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
                CREATED: {timeAgo(proposal.timestamp)}
            </div>
            <div className="bottom_spaced">
                STATUS: {statusEmoji(propStatus)}{" "}
                <span className={open ? "accent" : undefined}>
                    {propStatus}
                </span>
            </div>
            {"Release" in proposal.payload && (
                <div className="bottom_spaced">
                    {commit && (
                        <div className="row_container bottom_half_spaced">
                            COMMIT:&nbsp;
                            <a
                                className="breakable"
                                href={
                                    open
                                        ? REPO_RELEASE
                                        : `${REPO_COMMIT}/${proposal.payload.Release.commit}`
                                }
                            >
                                {commit}
                            </a>
                        </div>
                    )}
                    {closed_features.length && (
                        <div className="row_container bottom_half_spaced">
                            CLOSES FEATURES:&nbsp;
                            {commaSeparated(
                                closed_features.map((id) => (
                                    <a href={`#/post/${id}`}>{id}</a>
                                )),
                            )}
                        </div>
                    )}
                    {!open && (
                        <div className="row_container">
                            <span>HASH:</span>
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
                        NEW CONTROLLER:{" "}
                        <UserLink id={proposal.payload.AddRealmController[1]} />
                    </div>
                    <div className="bottom_spaced">
                        REALM:{" "}
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
                        RECEIVER:{" "}
                        <code className="breakable">
                            {hex(proposal.payload.ICPTransfer[0])}
                        </code>
                    </div>
                    <div className="bottom_spaced">
                        AMOUNT:{" "}
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
                        RECEIVER:{" "}
                        <code className="breakable">
                            {proposal.payload.Rewards.receiver.toString()}
                        </code>
                    </div>
                    {proposal.status == "Executed" && (
                        <div className="bottom_spaced">
                            TOKENS MINTED:{" "}
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
                        RECEIVER:{" "}
                        <code className="breakable">
                            {proposal.payload.Funding[0].toString()}
                        </code>
                    </div>
                    <div className="bottom_spaced">
                        AMOUNT:{" "}
                        <code>{tokenBalance(proposal.payload.Funding[1])}</code>
                    </div>
                </>
            )}
            <div className="bottom_spaced">
                EFFECTIVE VOTING POWER:{" "}
                <code>{token(proposal.voting_power)}</code>
            </div>
            {open && !isNaN(days) && (
                <div className="bottom_spaced">
                    EXECUTION DEADLINE: <strong>{days} DAYS</strong>
                </div>
            )}
            <div className="bottom_spaced">
                <div className="bottom_half_spaced">
                    ACCEPTED:{" "}
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
                    REJECTED:{" "}
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
            {window.user && open && !voted && (
                <>
                    <div className="row_container">
                        <ButtonWithLoading
                            onClick={async () =>
                                confirm(
                                    "You're rejecting the proposal. Please confirm.",
                                ) && (await vote(proposal, false))
                            }
                            classNameArg="max_width_col large_text"
                            label="REJECT"
                        />
                        <ButtonWithLoading
                            onClick={() => vote(proposal, true)}
                            classNameArg="max_width_col large_text"
                            label="ACCEPT"
                        />
                    </div>
                </>
            )}
            {window.user && window.user.id == proposal.proposer && open && (
                <ButtonWithLoading
                    onClick={async () => {
                        if (
                            !confirm(
                                "You're canceling the proposal. Please confirm.",
                            )
                        )
                            return;
                        await window.api.call("cancel_proposal", proposal.id);
                        location.reload();
                    }}
                    classNameArg="top_spaced max_width_col large_text"
                    label="CANCEL"
                />
            )}
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
