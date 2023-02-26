import * as React from "react";
import {Loading} from "./common";

export const Search = () => {
    const [term, setTerm] = React.useState("");
    const [results, setResults] = React.useState([]);
    const [timer, setTimer] = React.useState(null);
    const [searching, setSearching] = React.useState(false);

    return <div className="column_container spaced top_spaced bottom_spaced">
        <input id="search_field" className="monospace larger_text" type="search"
            placeholder={`Search #${backendCache.config.name}`} value={term}
            onChange={event => {
                clearTimeout(timer);
                const term = event.target.value;
                setTerm(term);
                setTimer(setTimeout(async () => { 
                    if (term.length < 2) {
                        setResults([]);
                        return;
                    }
                    setSearching(true);
                    setResults(await api.query("search", term));
                    setSearching(false);
                }, 300))
            }} />
        {!searching && results.length > 0 && 
            <ul>{results.map((i) => <li key={i.result + i.id + i.relevant}>{renderResult(i)}</li>)}</ul>}
        {searching && <Loading />}
    </div>;
}

const renderResult = ({result, id, relevant, user_id}) => {
    if (result == "user")
        return <span>User <a href={`#/user/${id}`}>{`@${backendCache.users[id]}`}</a>: {relevant || "no info."}</span>;
    if (result == "tag")
        return <span>Hashtag <a href={`#/feed/${relevant}`}>{`#${relevant}`}</a></span>;
    if (result == "post")
        return <span><a href={`#/post/${id}`}>{`Post ${id}`}</a> by&nbsp;
            <a href={`#/user/${user_id}`}>{`@${backendCache.users[user_id]}`}</a>:&nbsp;
            {relevant}</span>;
    return "can't render";
};
