import * as React from "react";
import { domain, Loading, ShareButton } from "./common";
import { PostId, UserId } from "./types";
import { UserLink } from "./user_resolve";
import { Principal } from "@dfinity/principal";
import { TransactionsView } from "./tokens";

type SearchResult = {
    id: PostId;
    user_id: UserId;
    generic_id: string;
    result: string;
    relevant: string;
};

export const Search = ({ initQuery }: { initQuery?: string }) => {
    const [hint, setHint] = React.useState(false);
    const [query, setTerm] = React.useState(
        decodeURIComponent(initQuery || ""),
    );
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [timer, setTimer] = React.useState<any>(null);
    const [searching, setSearching] = React.useState(false);
    const [principal, setPrincipal] = React.useState<Principal>();

    const search = async (query: string) => {
        setHint(false);
        if (query.length < 2) {
            setResults([]);
            return;
        }
        try {
            setPrincipal(Principal.fromText(query));
            return;
        } catch (_) {}
        setSearching(true);
        setResults((await window.api.query("search", domain(), query)) || []);
        setSearching(false);
    };

    React.useEffect(() => {
        search(query);
    }, []);

    return (
        <div className="column_container spaced">
            <div className="row_container">
                <input
                    id="search_field"
                    className="max_width_col"
                    type="search"
                    placeholder={`Search #${window.backendCache.config.name}`}
                    value={query}
                    onFocus={() => setHint(true)}
                    onChange={(event) => {
                        clearTimeout(timer as unknown as any);
                        const query = event.target.value;
                        setTerm(query);
                        setTimer(setTimeout(() => search(query), 300));
                    }}
                />
                {query && (
                    <ShareButton
                        url={`#/search/${encodeURIComponent(query)}`}
                        text={true}
                    />
                )}
            </div>
            {principal && (
                <div className="top_spaced">
                    <TransactionsView
                        prime={true}
                        icrcAccount={principal.toString()}
                    />
                </div>
            )}
            {!searching && results.length > 0 && (
                <ul>
                    {results.map((i) => (
                        <li key={i.result + i.id + i.relevant}>
                            {renderResult(i)}
                        </li>
                    ))}
                </ul>
            )}
            {hint && (
                <div className="stands_out top_spaced medium_text">
                    <p>Search query examples:</p>
                    <ul>
                        <li>
                            <code>@XZY</code>: will show all users with names
                            starting with "XZY".
                        </li>
                        <li>
                            <code>/ABC</code>: will show all realms with names
                            starting with "ABC".
                        </li>
                        <li>
                            <code>@XYZ WORD</code>: will show all posts from
                            users matching the name "XZY" and containing the
                            word "WORD".
                        </li>
                        <li>
                            <code>/ABC WORD</code>: will show all posts from the
                            realm starting with "ABC" and containing the word
                            "WORD".
                        </li>
                        <li>
                            <code>@XYZ /ABC WORD</code>: will show all posts
                            from users matching the name "XZY" from the realm
                            starting with "ABC" and containing the word "WORD".
                        </li>
                        <li>
                            <code>#TAG</code>: will show all hashtags starting
                            with "TAG".
                        </li>
                        <li>
                            <code>PRINCIPAL</code>: will show all transactions
                            and the balance of the principal.
                        </li>
                    </ul>
                </div>
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
                User <UserLink id={id} />: {relevant || "no info."}
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
                <a href={`#/post/${id}`}>{`Post ${id}`}</a> by{" "}
                <UserLink id={user_id} /> {relevant}
            </span>
        );
    return "can't render";
};
