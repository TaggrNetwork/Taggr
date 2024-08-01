import { HeadBar, REPO } from "./common";

export const LinksPage = ({}) => {
    const { token_symbol, domains } = window.backendCache.config;
    return (
        <div className="spaced">
            <HeadBar title="LINKS" shareLink="links" />
            <h2>DAO approved domains</h2>
            <ul>
                {domains.map((domain) => (
                    <li>
                        <a href={`https://${domain}`}>{domain}</a>
                    </li>
                ))}
            </ul>
            <h2>Price Listings</h2>
            <ul>
                <li>
                    <a href="https://www.coingecko.com/en/coins/taggr">
                        CoinGecko
                    </a>
                </li>
                <li>
                    <a href="https://icpcoins.com/#/token/TAGGR">ICPCoins</a>
                </li>
            </ul>
            <h2>{token_symbol} Trading</h2>
            <ul>
                <li>
                    <a href="https://info.icpswap.com/swap/token/details/6qfxa-ryaaa-aaaai-qbhsq-cai">
                        ICPSwap exchange
                    </a>
                </li>
                <li>
                    <a href="https://beacondex.link">BEACON exchange</a>
                </li>
            </ul>
            <h2>Source Code Repositories</h2>
            <ul>
                <li>
                    <a href={REPO}>GitHub</a> (maintained by{" "}
                    <a href="#/user/0">X</a>)
                </li>
            </ul>
            <h2>Community maintained resources</h2>
            <ul>
                <li>
                    <a href="https://6qfxa-ryaaa-aaaai-qbhsq-cai.icp0.io/#/realm/000_WELCOME_TO_TAGGR">
                        Welcome to Taggr Realm
                    </a>{" "}
                    (helpful for newbies)
                </li>
                <li>
                    <a href="https://6qfxa-ryaaa-aaaai-qbhsq-cai.icp0.io/#/realm/HELP">
                        HELP Realm
                    </a>
                </li>
                <li>
                    <a href="#/feed/@mntyetti+finn">Explanatory material</a> by{" "}
                    <a href="#/user/MntYetti">MntYetti</a>
                </li>
                <li>
                    <a href="https://oc.app/community/zbg63-qqaaa-aaaar-atika-cai">
                        OpenChat Community
                    </a>
                </li>
            </ul>
        </div>
    );
};
