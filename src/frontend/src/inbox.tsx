import * as React from "react";
import { HeadBar } from "./common";
import { Content } from "./content";
import { Close } from "./icons";
import { PostView } from "./post";
import { Notification } from "./types";

export const Inbox = () => {
    const [inbox, setInbox] = React.useState<{ [key: string]: Notification }>(
        window.user.inbox,
    );
    const ids = Object.keys(inbox);
    if (ids.length == 0) {
        location.href = "#/";
    }
    ids.sort((a, b) => {
        if (a.startsWith("condition") && !b.startsWith("condition")) return -1;
        if (!a.startsWith("condition") && b.startsWith("condition")) return 1;
        if (a.startsWith("watched") && !b.startsWith("watched")) return 1;
        if (!a.startsWith("watched") && b.startsWith("watched")) return -1;
        return b.localeCompare(a);
    });
    return (
        <>
            <HeadBar
                title="INBOX"
                content={
                    <button
                        onClick={() => {
                            window.user.inbox = {};
                            window.api.call(
                                "clear_notifications",
                                Object.keys(inbox),
                            );
                            location.href = "#/";
                        }}
                    >
                        CLEAR ALL
                    </button>
                }
            />
            <>
                {ids.map((k) => {
                    const message = inbox[k];
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
                        id = parseInt(k.split("_")[1]);
                        msg = `\`${
                            message.WatchedPostEntries.length
                        }\` new thread updates ${message.WatchedPostEntries.map(
                            (id) => `[#${id}](#/thread/${id})`,
                        ).join(", ")} on the watched post`;
                    }
                    return (
                        <div
                            key={k}
                            className="stands_out"
                            style={{ padding: 0 }}
                        >
                            <div className="row_container">
                                <Content
                                    value={msg}
                                    classNameArg="medium_text left_spaced right_spaced max_width_col"
                                />
                                <button
                                    className="unselected right_half_spaced"
                                    onClick={() => {
                                        window.api.call("clear_notifications", [
                                            k,
                                        ]);
                                        delete inbox[k];
                                        delete window.user.inbox[k];
                                        setInbox({ ...inbox });
                                    }}
                                >
                                    <Close classNameArg="action" />
                                </button>
                            </div>
                            {id && "WatchedPostEntries" in message && (
                                <PostView
                                    id={id}
                                    classNameArg="top_framed"
                                    isFeedItem={true}
                                    highlighted={message.WatchedPostEntries}
                                />
                            )}
                        </div>
                    );
                })}
            </>
        </>
    );
};
