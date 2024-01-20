import {
    HeadBar,
    Loading,
    ButtonWithLoading,
    timeAgo,
    token,
    userList,
    percentage,
    FileUploadInput,
    tokenBalance,
    NotFound,
    tokens,
    hex,
    UserLink,
} from "./common";
import * as React from "react";
import { Content } from "./content";
import { HourGlass } from "./icons";
import { PostFeed } from "./post_feed";
import { PostId, Proposal } from "./types";

const REPO_RELEASE = "https://github.com/TaggrNetwork/taggr/releases/latest";
const REPO_COMMIT = "https://github.com/TaggrNetwork/taggr/commit";

enum ProposalType {
    IcpTranfer = "ICP TRANSFER",
    AddRealmController = "ADD REALM CONTROLLER",
    Fund = "FUND",
    Reward = "REWARD",
    Release = "RELEASE",
}

export const Proposals = () => {
    const [proposalType, setProposalType] = React.useState<ProposalType | null>(
        null,
    );
    const [receiver, setReceiver] = React.useState("");
    const [fundingAmount, setFundingAmount] = React.useState(0);
    const [icpAmount, setICPAmount] = React.useState(0);
    const [userName, setUserName] = React.useState("");
    const [realmId, setRealmId] = React.useState("");
    const [binary, setBinary] = React.useState(null);
    const [commit, setCommit] = React.useState("");
    const [proposal, setProposal] = React.useState(null);
    const [description, setDescription] = React.useState("");

    return (
        <>
            <HeadBar
                title="PROPOSALS"
                shareLink="proposals"
                menu={true}
                burgerTestId="proposals-burger-button"
                content={
                    <div className="two_columns_grid">
                        {Object.values(ProposalType).map((id) => (
                            <button
                                key={id}
                                className="max_width_col"
                                onClick={() => setProposalType(id)}
                            >
                                {id}
                            </button>
                        ))}
                    </div>
                }
            />
            <div className="vertically_spaced">
                {proposalType && (
                    <div className="column_container spaced">
                        <h1>NEW PROPOSAL: {proposalType?.toString()}</h1>
                        <div className="bottom_half_spaced">DESCRIPTION</div>
                        <textarea
                            className="bottom_spaced"
                            rows={10}
                            value={description}
                            onChange={(event) =>
                                setDescription(event.target.value)
                            }
                        ></textarea>
                        {description && (
                            <Content
                                value={description}
                                preview={true}
                                classNameArg="bottom_spaced framed"
                            />
                        )}
                    </div>
                )}
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
                        <ButtonWithLoading
                            classNameArg="top_spaced active"
                            onClick={async () => {
                                if (!description || !userName || !realmId) {
                                    alert("Error: incomplete data.");
                                    return;
                                }
                                const userEntry = Object.entries(
                                    window.backendCache.users,
                                ).find(
                                    ([_, name]) =>
                                        name.toLowerCase() ==
                                        userName.toLowerCase(),
                                );
                                if (!userEntry) {
                                    alert(`No user ${userName} found!`);
                                    return;
                                }
                                let response = await window.api.call<any>(
                                    "propose_add_realm_controller",
                                    description,
                                    Number(userEntry[0]),
                                    realmId.toUpperCase(),
                                );
                                if ("Err" in response) {
                                    alert(`Error: ${response.Err}`);
                                    return;
                                }
                                setProposalType(null);
                                setProposal(response.Ok);
                            }}
                            label="SUBMIT"
                        />
                    </div>
                )}
                {proposalType == ProposalType.IcpTranfer && (
                    <div className="spaced column_container">
                        <div className="vcentered bottom_half_spaced">
                            RECEIVER
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
                        <ButtonWithLoading
                            classNameArg="top_spaced active"
                            onClick={async () => {
                                if (!description || !receiver || !icpAmount) {
                                    alert("Error: incomplete data.");
                                    return;
                                }
                                let response = await window.api.call<any>(
                                    "propose_icp_transfer",
                                    description,
                                    receiver,
                                    icpAmount.toString(),
                                );
                                if ("Err" in response) {
                                    alert(`Error: ${response.Err}`);
                                    return;
                                }
                                setProposalType(null);
                                setProposal(response.Ok);
                            }}
                            label="SUBMIT"
                        />
                    </div>
                )}
                {proposalType == ProposalType.Reward && (
                    <div className="spaced column_container">
                        <div className="vcentered bottom_half_spaced">
                            RECEIVER
                            <input
                                type="text"
                                className="left_spaced max_width_col"
                                onChange={async (ev) => {
                                    setReceiver(ev.target.value.toString());
                                }}
                            />
                        </div>
                        <ButtonWithLoading
                            classNameArg="top_spaced active"
                            onClick={async () => {
                                if (!description || !receiver) {
                                    alert("Error: incomplete data.");
                                    return;
                                }
                                let response = await window.api.call<any>(
                                    "propose_reward",
                                    description,
                                    receiver,
                                );
                                if ("Err" in response) {
                                    alert(`Error: ${response.Err}`);
                                    return;
                                }
                                setProposalType(null);
                                setProposal(response.Ok);
                            }}
                            label="SUBMIT"
                        />
                    </div>
                )}
                {proposalType == ProposalType.Fund && (
                    <div className="spaced column_container">
                        <div className="vcentered bottom_half_spaced">
                            RECEIVER
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
                        <ButtonWithLoading
                            classNameArg="top_spaced active"
                            onClick={async () => {
                                if (
                                    !description ||
                                    !receiver ||
                                    !fundingAmount
                                ) {
                                    alert("Error: incomplete data.");
                                    return;
                                }
                                let response = await window.api.call<any>(
                                    "propose_funding",
                                    description,
                                    receiver,
                                    fundingAmount,
                                );
                                if ("Err" in response) {
                                    alert(`Error: ${response.Err}`);
                                    return;
                                }
                                setProposalType(null);
                                setProposal(response.Ok);
                            }}
                            label="SUBMIT"
                        />
                    </div>
                )}
                {proposalType == ProposalType.Release && (
                    <div className="spaced column_container">
                        <div className="vcentered bottom_half_spaced">
                            COMMIT
                            <input
                                type="text"
                                className="left_spaced max_width_col"
                                onChange={async (ev) => {
                                    setCommit(ev.target.value);
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
                        <ButtonWithLoading
                            classNameArg="top_spaced active"
                            onClick={async () => {
                                if (!description || !binary) {
                                    alert("Error: incomplete data.");
                                    return;
                                }
                                const response: any =
                                    await window.api.propose_release(
                                        description,
                                        commit,
                                        binary,
                                    );
                                if ("Err" in response) {
                                    alert(`Error: ${response.Err}`);
                                    return;
                                }
                                setProposalType(null);
                                setProposal(response.Ok);
                            }}
                            label="SUBMIT"
                        />
                    </div>
                )}
            </div>
            <PostFeed
                heartbeat={proposal}
                useList={true}
                feedLoader={async (page) =>
                    await window.api.query("proposals", page)
                }
            />
        </>
    );
};

export const ProposalView = ({
    id,
    postId,
}: {
    id: number;
    postId: PostId;
}) => {
    const users = window.backendCache.users;
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
            if ("Reward" in proposal.payload) {
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
                            COMMIT:
                            <a
                                className="left_half_spaced breakable"
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
                        <code>{hex(proposal.payload.ICPTransfer[0])}</code>
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
            {"Reward" in proposal.payload && (
                <>
                    <div className="bottom_half_spaced">
                        RECEIVER:{" "}
                        <code>{proposal.payload.Reward.receiver}</code>
                    </div>
                    {proposal.status == "Executed" && (
                        <div className="bottom_spaced">
                            TOKENS MINTED:{" "}
                            <code>
                                {tokenBalance(proposal.payload.Reward.minted)}
                            </code>
                        </div>
                    )}
                </>
            )}
            {"Fund" in proposal.payload && (
                <>
                    <div className="bottom_half_spaced">
                        RECEIVER: <code>{proposal.payload.Fund[0]}</code>
                    </div>
                    <div className="bottom_spaced">
                        AMOUNT:{" "}
                        <code>{tokenBalance(proposal.payload.Fund[1])}</code>
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
                    {users &&
                        userList(
                            proposal.bulletins
                                .filter((vote) => vote[1])
                                .map((vote) => vote[0]),
                        )}
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
                    {users &&
                        userList(
                            proposal.bulletins
                                .filter((vote) => !vote[1])
                                .map((vote) => vote[0]),
                        )}
                </div>
            </div>
            {window.user && open && !voted && (
                <>
                    <div className="row_container">
                        <ButtonWithLoading
                            onClick={() => vote(proposal, false)}
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
                        if (!confirm("Do you want to cancel your proposal?"))
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
