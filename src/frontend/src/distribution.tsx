import * as React from "react";
import { ButtonWithLoading, HeadBar } from "./common";
import { Summary } from "./types";
import { Content } from "./content";

export const Distribution = () => {
    const [reports, setReports] = React.useState<Summary[]>([]);
    const [tab, setTab] = React.useState("minting");

    const loadData = async () => {
        const reports =
            (await window.api.query<Summary[]>("distribution")) || [];
        setReports(reports);
    };

    React.useEffect(() => {
        loadData();
    }, []);

    return (
        <>
            <HeadBar
                title="DISTRIBUTION"
                shareLink="distribution"
                content={
                    window.user?.stalwart && (
                        <ButtonWithLoading
                            label="VOTE FOR DELAY"
                            onClick={async () =>
                                alert(
                                    (await window.api.call(
                                        "delay_weekly_chores",
                                    ))
                                        ? "Thanks! Your vote was accepted."
                                        : "Minting is already delayed.",
                                )
                            }
                        />
                    )
                }
            />
            <div className="text_centered vertically_spaced">
                {["mint", "dao revenue", "realm revenue"].map((id) => (
                    <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={
                            "medium_text " +
                            (tab == id ? "active" : "unselected")
                        }
                    >
                        {id.toUpperCase()}
                    </button>
                ))}
            </div>
            <div className="column_container spaced">
                {reports
                    .filter(({ title }) => title.toLowerCase().includes(tab))
                    .map((summary, i) => (
                        <div className="stands_out" key={i}>
                            <h2>{summary.title}</h2>
                            <Content post={false} value={summary.description} />
                            <Content
                                post={false}
                                value={summary.items.join("\n\n")}
                            />
                        </div>
                    ))}
            </div>
        </>
    );
};
