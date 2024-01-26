import * as React from "react";
import { HeadBar, MoreButton } from "./common";
import { Content } from "./content";
import { Close } from "./icons";
import { PostView } from "./post";
import { Notification } from "./types";

export const Inbox = () => {
    const [inbox, setInbox] = React.useState<{
        [key: string]: [Notification, boolean];
    }>(window.user.notifications);
    const [closing, setClosing] = React.useState(0);
    const [showArchive, setShowArchive] = React.useState(false);
    const ids = Object.keys(inbox);
    ids.reverse();
    if (ids.length == 0) {
        location.href = "#/";
    }

    const displayEntry = (k: number, archive?: boolean) => {
        const message = inbox[k][0];
        let msg = "";
        let id = null;
        if ("Generic" in message) {
            msg = message.Generic;
        } else if ("NewPost" in message) {
            id = message.NewPost[1];
            msg = message.NewPost[0];
        } else if ("Conditional" in message) {
            const payload = message.Conditional[1];
            if ("ReportOpen" in payload) id = payload.ReportOpen;
            else if ("Proposal" in payload) id = payload.Proposal;
            msg = message.Conditional[0];
        } else if ("WatchedPostEntries" in message) {
            id = message.WatchedPostEntries[0];
            msg = `\`${
                message.WatchedPostEntries[1].length
            }\` new thread update(s) on a watched post: ${message.WatchedPostEntries[1]
                .map((id) => `[#${id}](#/thread/${id})`)
                .join(", ")}`;
        }
        return (
            <div
                key={k}
                className={"stands_out" + (closing == k ? " fadeout" : "")}
                style={{ padding: 0 }}
            >
                <div className="row_container">
                    <Content
                        value={msg}
                        classNameArg="medium_text left_spaced right_spaced max_width_col"
                    />
                    {!archive && (
                        <button
                            className="unselected right_half_spaced"
                            onClick={() => {
                                setClosing(k);
                                setTimeout(() => {
                                    window.api.call("clear_notifications", [k]);
                                    let inbox = window.user.notifications;
                                    inbox[k][1] = true;
                                    setInbox({ ...inbox });
                                }, 80);
                            }}
                        >
                            <Close classNameArg="action" />
                        </button>
                    )}
                </div>
                {id != undefined && (
                    <PostView
                        id={id}
                        classNameArg="collapsable top_framed"
                        isFeedItem={true}
                        highlighted={
                            "WatchedPostEntries" in message
                                ? message.WatchedPostEntries[1]
                                : undefined
                        }
                    />
                )}
            </div>
        );
    };

    const archived = ids.filter((id) => inbox[id][1]);

    return (
        <>
            <HeadBar
                title="INBOX"
                content={
                    <button
                        onClick={() => {
                            window.api.call(
                                "clear_notifications",
                                Object.keys(inbox).map((id) => Number(id)),
                            );
                            window.user.notifications = {};
                            location.href = "#/";
                        }}
                    >
                        CLEAR ALL
                    </button>
                }
            />
            <>
                {ids
                    .filter((id) => !inbox[id][1])
                    .map((id) => displayEntry(Number(id)))}
            </>
            {!showArchive && (
                <MoreButton callback={async () => setShowArchive(true)} />
            )}
            {showArchive && archived.length > 0 && (
                <div style={{ opacity: 0.65 }}>
                    <h2 className="spaced">Archive</h2>
                    {archived.map((id) => displayEntry(Number(id), true))}
                </div>
            )}
        </>
    );
};
