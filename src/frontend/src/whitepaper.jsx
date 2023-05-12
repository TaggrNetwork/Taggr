import * as React from "react";
import {HeadBar, tokenBalance} from "./common";
import {Content} from "./content";
import template from '../../../docs/WHITEPAPER.md';


export const Whitepaper = () => {
    let value = template.match(/\$([a-zA-Z_]+)/g).reduce((acc, e) => {
        const key = e.slice(1);
        let value = backendCache.config[key];
        let { team_tokens } = backendCache.stats;
        // Remove decimals
        if (key == "total_supply")
                value = (value / Math.pow(10, backendCache.config.token_decimals)).toLocaleString();
        else if (key == "vesting_tokens_x")
                value = tokenBalance(team_tokens[0]);
        else if (key == "vesting_tokens_m")
                value = tokenBalance(team_tokens[305]);
        return acc.replace(e, value);
    }, template);
    return <>
        <HeadBar title="White Paper" shareLink="whitepaper" />
        <Content classNameArg="spaced" value={value} />
    </>;
}
