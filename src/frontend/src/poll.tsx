import * as React from "react";
import { ButtonWithLoading, token, userList } from "./common";
import { Content } from "./content";
import { Poll, PostId } from "./types";

export const PollView = ({
    poll,
    post_id,
    created,
}: {
    poll: Poll;
    post_id?: PostId;
    created: number | BigInt;
}) => {
    const [vote, setVote] = React.useState<number | null>(null);
    const [data, setData] = React.useState(poll);
    const [revoteMode, setRevoteMode] = React.useState(false);

    React.useEffect(() => setData(poll), [poll]);

    const radio_group_name = post_id ? `${post_id}-poll` : "poll";
    const user_id = window.user?.id;
    const votedAnonymously =
        data.voters.includes(user_id) &&
        !Object.values(data.votes).flat().includes(user_id);
    const voted =
        !revoteMode &&
        (Object.values(data.votes).flat().includes(user_id) ||
            votedAnonymously);

    const totalVotes = Object.values(data.votes)
        .map((votes) => votes.length)
        .reduce((acc, e) => acc + e, 0);
    const createdHoursAgo = Math.floor(
        (Number(new Date()) - Number(created) / 1000000) / 1000 / 3600,
    );
    const expired = createdHoursAgo >= poll.deadline;
    const canChangeVote =
        !votedAnonymously &&
        voted &&
        poll.deadline - createdHoursAgo >
            window.backendCache.config.poll_revote_deadline_hours;
    const showVoting = !isNaN(user_id) && !voted && !expired;

    return (
        <div className="column_container post_extension" data-meta="skipClicks">
            {data.options.map((option, id) => {
                const votes = (data.votes[id] || []).length;
                const pc =
                    totalVotes > 0 ? Math.ceil((votes / totalVotes) * 100) : 0;
                return (
                    <label
                        key={id}
                        className={showVoting ? "vcentered" : undefined}
                        style={{
                            display: "flex",
                            flexDirection: showVoting ? "row" : "column",
                        }}
                    >
                        {showVoting && (
                            <input
                                type="radio"
                                value={id}
                                name={radio_group_name}
                                className="right_spaced"
                                style={{ marginTop: 0 }}
                                onChange={(e) => {
                                    if (post_id == undefined || !window.user)
                                        return;
                                    setVote(Number(e.target.value));
                                }}
                            />
                        )}
                        <Content
                            classNameArg="max_width_col clickable"
                            value={option}
                        />
                        {!showVoting && (
                            <div
                                className="column_container"
                                style={{ margin: "0.5em" }}
                            >
                                <div className="vcentered small_text">
                                    <span
                                        className="right_half_spaced"
                                        style={{
                                            width: "6em",
                                            textAlign: "right",
                                            alignSelf: "flex-start",
                                        }}
                                    >
                                        <code className="right_half_spaced">
                                            {votes}
                                        </code>
                                        <code>({pc}%)</code>
                                    </span>
                                    <div className="max_width_col">
                                        <div
                                            style={{
                                                width: `${pc}%`,
                                                height: "0.6em",
                                                marginTop: "0.1em",
                                            }}
                                            className="active"
                                        ></div>
                                        <div className="small_text top_half_spaced">
                                            {userList(data.votes[id])}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </label>
                );
            })}
            {vote != null && (!voted || revoteMode) && (
                <div className="row_container">
                    {[
                        ["SUBMIT ANONYMOUSLY", true],
                        ["SUBMIT", false],
                    ].map(([label, anonymously]: any) => (
                        <ButtonWithLoading
                            key={label}
                            classNameArg="top_spaced bottom_spaced max_width_col"
                            onClick={async () => {
                                window.api
                                    .call<any>(
                                        "vote_on_poll",
                                        post_id,
                                        vote,
                                        anonymously,
                                    )
                                    .then((response) => {
                                        if (response.Err) {
                                            alert(`Error: ${response.Err}!`);
                                            return;
                                        }
                                    });
                                const list = poll.votes[vote] || [];
                                list.push(
                                    anonymously
                                        ? Number.MAX_SAFE_INTEGER
                                        : user_id,
                                );
                                poll.votes[vote] = list;
                                poll.voters.push(user_id);
                                setRevoteMode(false);
                                setData({ ...poll });
                            }}
                            label={label}
                        />
                    ))}
                </div>
            )}
            {!expired && (
                <span className="top_spaced small_text text_centered">
                    <span className="inactive">
                        EXPIRES IN {printDelta(data.deadline - createdHoursAgo)}
                    </span>
                    {canChangeVote && (
                        <>
                            &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    Object.entries(poll.votes).forEach(
                                        ([option, voters]) => {
                                            poll.votes[Number(option)] =
                                                voters.filter(
                                                    (id) => id != user_id,
                                                );
                                        },
                                    );
                                    setData({ ...poll });
                                    setRevoteMode(true);
                                }}
                            >
                                CHANGE VOTE
                            </a>
                        </>
                    )}
                </span>
            )}
            {expired && (
                <>
                    <h4 className="top_framed" style={{ paddingTop: "1em" }}>
                        RESULTS BY VOTING POWER
                    </h4>
                    {Object.entries(data.weighted_by_tokens).map(
                        ([index, vp]: [string, number]) => (
                            <Content
                                post={false}
                                value={
                                    data.options[Number(index)] +
                                    `: \`${token(vp)}\``
                                }
                            />
                        ),
                    )}
                </>
            )}
        </div>
    );
};

const printDelta = (delta: number) => {
    const days = Math.floor(delta / 24);
    if (days > 0) return `${days} DAY${days == 1 ? "" : "S"}`;
    return `${Math.max(1, delta)}H`;
};
