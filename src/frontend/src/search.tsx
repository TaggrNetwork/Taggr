import * as React from "react";
import { Loading, ShareButton } from "./common";
import { PostId, UserId } from "./types";

type SearchResult = {
    id: PostId;
    user_id: UserId;
    generic_id: string;
    result: string;
    relevant: string;
};

export const Search = ({ query }: { query?: string }) => {
    const [term, setTerm] = React.useState(decodeURIComponent(query || ""));
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [timer, setTimer] = React.useState<any>(null);
    const [searching, setSearching] = React.useState(false);

    const search = async () => {
        if (term.length < 2) {
            setResults([]);
            return;
        }
        setSearching(true);
        setResults((await window.api.query("search", term)) || []);
        setSearching(false);
    };

    React.useEffect(() => {
        search();
    }, []);

    return (
        <div className="column_container spaced">
            <div className="row_container">
                <input
                    id="search_field"
                    className="max_width_col"
                    type="search"
                    placeholder={`Search #${window.backendCache.config.name}`}
                    value={term}
                    onChange={(event) => {
                        clearTimeout(timer as unknown as any);
                        const term = event.target.value;
                        setTerm(term);
                        setTimer(setTimeout(search, 300));
                    }}
                />
                {term && (
                    <ShareButton
                        url={`#/search/${encodeURIComponent(term)}`}
                        text={true}
                    />
                )}
            </div>
            {!searching && results.length > 0 && (
                <ul>
                    {results.map((i) => (
                        <li key={i.result + i.id + i.relevant}>
                            {renderResult(i)}
                        </li>
                    ))}
                </ul>
            )}
            {searching && <Loading />}
        </div>
    );
};

const renderResult = ({
    result,
    id,
    relevant,
    user_id,
    generic_id,
}: SearchResult) => {
    if (result == "user")
        return (
            <span>
                User{" "}
                <a
                    href={`#/user/${id}`}
                >{`@${window.backendCache.users[id]}`}</a>
                : {relevant || "no info."}
            </span>
        );
    if (result == "tag")
        return (
            <span>
                Hashtag <a href={`#/feed/${relevant}`}>{`#${relevant}`}</a>
            </span>
        );
    if (result == "realm")
        return (
            <span>
                Realm <a href={`#/realm/${generic_id}`}>{generic_id}</a>:{" "}
                {relevant}
            </span>
        );
    if (result == "post")
        return (
            <span>
                <a href={`#/post/${id}`}>{`Post ${id}`}</a> by&nbsp;
                <a
                    href={`#/user/${user_id}`}
                >{`@${window.backendCache.users[user_id]}`}</a>
                :&nbsp;
                {relevant}
            </span>
        );
    return "can't render";
};
