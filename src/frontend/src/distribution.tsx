import * as React from "react";
import { HeadBar } from "./common";
import { Summary } from "./types";
import { Content } from "./content";

export const Distribution = () => {
    const [reports, setReports] = React.useState<Summary[]>([]);

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
            <HeadBar title="DISTRIBUTION" shareLink="distribution" />
            <div className="column_container spaced">
                {reports.map((summary, i) => (
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
