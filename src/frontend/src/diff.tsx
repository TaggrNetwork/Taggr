import * as React from "react";
import { HeadBar, Loading, RAD_ID } from "./common";

const SEED_API = `https://seed.radicle.garden/api/v1/repos/${RAD_ID}/diff`;

type LineType = "addition" | "deletion" | "context";

type DiffLine = { line: string; type: LineType };

type Hunk = { header: string; lines: DiffLine[] };

type FileDiff = {
    status: string;
    path: string;
    diff?: { type: string; hunks?: Hunk[] };
};

type DiffResponse = {
    diff: {
        files: FileDiff[];
        stats: {
            filesChanged: number;
            insertions: number;
            deletions: number;
        };
    };
};

const lineColor = (type: LineType): string | undefined => {
    if (type === "addition") return "rgba(0, 200, 0, 0.18)";
    if (type === "deletion") return "rgba(220, 50, 50, 0.18)";
    return undefined;
};

const linePrefix = (type: LineType) => {
    if (type === "addition") return "+";
    if (type === "deletion") return "-";
    return " ";
};

const short = (h: string) => h.slice(0, 8);

export const Diff = ({ from, to }: { from: string; to: string }) => {
    const [data, setData] = React.useState<DiffResponse | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        fetch(`${SEED_API}/${from}/${to}`)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((j) => {
                if (!cancelled) setData(j);
            })
            .catch((e) => {
                if (!cancelled) setError(String(e));
            });
        return () => {
            cancelled = true;
        };
    }, [from, to]);

    return (
        <>
            <HeadBar title={`DIFF ${short(from)}..${short(to)}`} />
            <div className="spaced">
                {error && <div className="banner">{error}</div>}
                {!data && !error && <Loading />}
                {data && (
                    <>
                        <div className="bottom_spaced">
                            {data.diff.stats.filesChanged} files,{" "}
                            <span style={{ color: "rgb(0, 180, 0)" }}>
                                +{data.diff.stats.insertions}
                            </span>{" "}
                            <span style={{ color: "rgb(220, 50, 50)" }}>
                                -{data.diff.stats.deletions}
                            </span>
                        </div>
                        {data.diff.files.map((f) => (
                            <FileBlock key={f.path} file={f} />
                        ))}
                    </>
                )}
            </div>
        </>
    );
};

const FileBlock = ({ file }: { file: FileDiff }) => (
    <div className="bottom_spaced stands_out">
        <div className="bottom_half_spaced">
            <code>
                <strong>{file.status.toUpperCase()}</strong> {file.path}
            </code>
        </div>
        {file.diff?.type !== "plain" ? (
            <div className="small_text">[binary or non-text diff]</div>
        ) : (
            (file.diff.hunks || []).map((h, i) => (
                <div
                    key={i}
                    className="monospace small_text selectable"
                    style={{
                        whiteSpace: "pre",
                        overflowX: "auto",
                        marginBottom: "0.5em",
                    }}
                >
                    <div style={{ opacity: 0.6, padding: "0.5em 0" }}>
                        {h.header.trimEnd()}
                    </div>
                    {h.lines.map((l, j) => (
                        <div key={j} style={{ background: lineColor(l.type) }}>
                            {linePrefix(l.type)}
                            {l.line.replace(/\n$/, "")}
                        </div>
                    ))}
                </div>
            ))
        )}
    </div>
);
