import { HeadBar, USD_PER_XDR, tokenBalance, tokenBase } from "./common";
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
            // Remove decimals
            if (key == "maximum_supply")
                value = (value / tokenBase()).toLocaleString();
            else if (key == "usd_per_xdr") value = USD_PER_XDR;
            else if (key.startsWith("weekly_auction_size_tokens"))
                // @ts-ignore
                value = window.backendCache.config[key] / tokenBase();
            else if (key == "vesting_tokens_of_x") {
                const [vested, total] =
                    window.backendCache.stats.vesting_tokens_of_x;
                value = tokenBalance(total - vested);
            } else if (key == "active_user_share_for_minting_promille")
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
