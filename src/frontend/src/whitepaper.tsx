import * as React from "react";
import { HeadBar, USD_PER_XDR, tokenBalance, tokenBase } from "./common";
import { Content } from "./content";

export const Whitepaper = () => {
    const [template, setTemplate] = React.useState<string | null>(null);

    React.useEffect(() => {
        fetch("/WHITEPAPER.md")
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }

                return response.text();
            })
            .then(setTemplate);
    }, []);

    if (!template) return null;

    const matches = template.match(/\$([a-zA-Z_]+)/g) || [];
    const value = matches.reduce((acc: string, e: string) => {
        const key = e.slice(1);
        // @ts-ignore
        let value = window.backendCache.config[key];
        // Remove decimals
        if (key == "maximum_supply")
            value = (value / tokenBase()).toLocaleString();
        else if (key == "usd_per_xdr") value = USD_PER_XDR;
        else if (key == "proposal_escrow_amount_usd")
            value =
                window.backendCache.config.proposal_escrow_amount_xdr *
                USD_PER_XDR;
        else if (
            key.startsWith("weekly_auction_size_tokens") ||
            key.startsWith("random_reward_amount")
        )
            // @ts-ignore
            value = window.backendCache.config[key] / tokenBase();
        else if (key == "vesting_tokens_of_x") {
            const [vested, total] =
                window.backendCache.stats.vesting_tokens_of_x;
            value = tokenBalance(total - vested);
        } else if (key == "active_user_share_for_minting_promille")
            value = value / 10;
        else if (key == "fee")
            value = tokenBalance(window.backendCache.config.transaction_fee);
        else if (key == "canister_id")
            value = window.backendCache.stats.canister_id;
        return acc.replace(e, value);
    }, template);
    return (
        <>
            <HeadBar title="WHITE PAPER" shareLink="whitepaper" />
            <div className="spaced prime">
                <Content value={value} />
            </div>
        </>
    );
};
