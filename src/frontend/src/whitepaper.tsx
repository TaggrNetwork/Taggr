import { HeadBar, XDR_TO_USD, tokenBalance } from "./common";
import { Content } from "./content";
// @ts-ignore
import template from "../../../docs/WHITEPAPER.md";

export const Whitepaper = () => {
    let value = template
        .match(/\$([a-zA-Z_]+)/g)
        .reduce((acc: string, e: string) => {
            const key = e.slice(1);
            // @ts-ignore
            let value = window.backendCache.config[key];
            let { team_tokens } = window.backendCache.stats;
            // Remove decimals
            if (key == "maximum_supply")
                value = (
                    value /
                    Math.pow(10, window.backendCache.config.token_decimals)
                ).toLocaleString();
            else if (key == "xdr_in_usd") value = XDR_TO_USD;
            else if (key == "vesting_tokens_x")
                value = tokenBalance(team_tokens[0]);
            else if (key == "vesting_tokens_m")
                value = tokenBalance(team_tokens[305]);
            else if (key == "active_user_share_for_minting_promille")
                value = value / 10;
            else if (key == "fee")
                value = tokenBalance(
                    window.backendCache.config.transaction_fee,
                );
            else if (key == "canister_id")
                value = window.backendCache.stats.canister_id;
            return acc.replace(e, value);
        }, template);
    return (
        <>
            <HeadBar title="WHITE PAPER" shareLink="whitepaper" />
            <Content classNameArg="spaced prime" value={value} />
        </>
    );
};
