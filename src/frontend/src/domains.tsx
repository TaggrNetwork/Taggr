import * as React from "react";
import {
    ButtonWithLoading,
    commaSeparated,
    HeadBar,
    showPopUp,
} from "./common";
import { DomainConfig } from "./types";
import { UserLink } from "./user_resolve";

export const Domains = ({}) => {
    const [domainConfigs, setDomainConfigs] = React.useState<{
        [domain: string]: DomainConfig;
    }>();

    React.useEffect(() => {
        window.api
            .query<any>("domains")
            .then((cfgs) => setDomainConfigs(cfgs || {}));
    }, []);
    const user = window.user;
    const userDomains = user
        ? Object.entries(domainConfigs || {}).filter(
              ([_, cfg]) => cfg.owner == user.id,
          )
        : [];
    return (
        <div className="spaced">
            <HeadBar title="DOMAINS" shareLink="domains" />
            <h2>Taggr domains</h2>
            <ul>
                {Object.entries(domainConfigs || {}).map(([domain, cfg]) => (
                    <li key={domain}>
                        <a href={`#/domain/${domain}`}>{domain}</a>
                        <ul>
                            <li>
                                Owner:{" "}
                                {cfg.owner == null ? (
                                    "DAO"
                                ) : (
                                    <UserLink id={cfg.owner} pfp={false} />
                                )}
                            </li>
                            {cfg.realm_whitelist.length > 0 && (
                                <li>
                                    White-listed realms:{" "}
                                    {commaSeparated(
                                        cfg.realm_whitelist.map((id) => (
                                            <a
                                                href={`#/realm/${id}`}
                                            >{`/${id}`}</a>
                                        )),
                                    )}
                                </li>
                            )}
                            {cfg.realm_blacklist.length > 0 && (
                                <li>
                                    Black-listed realms:{" "}
                                    {commaSeparated(
                                        cfg.realm_blacklist.map((id) => (
                                            <a
                                                href={`#/realm/${id}`}
                                            >{`/${id}`}</a>
                                        )),
                                    )}
                                </li>
                            )}
                        </ul>
                    </li>
                ))}
            </ul>
            {userDomains.length > 0 && (
                <div>
                    <h3>Your domains</h3>
                    {userDomains.map(([domain, cfg]) => (
                        <DomainForm domain={domain} initCfg={cfg} />
                    ))}
                </div>
            )}
        </div>
    );
};

const DomainForm = ({
    domain,
    initCfg,
}: {
    domain: string;
    initCfg: DomainConfig;
}) => {
    const [whitelist, setWhitelist] = React.useState<string>(
        initCfg.realm_whitelist.join("\n"),
    );
    const [blacklist, setBlacklist] = React.useState<string>(
        initCfg.realm_blacklist.join("\n"),
    );
    const extractRealmIds = (value: string) =>
        value.trim().toUpperCase().split("\n").filter(Boolean);
    const blUsed = extractRealmIds(blacklist).length > 0;
    const wlUsed = extractRealmIds(whitelist).length > 0;
    return (
        <div className="stands_out top_spaced column_container">
            <h4>{domain}</h4>
            WHITE-LIST (comma-separated):
            <textarea
                disabled={blUsed}
                className={`small_text bottom_spaced ${blUsed ? "inactive" : ""}`}
                value={whitelist}
                onChange={(event) => setWhitelist(event.target.value)}
                rows={4}
            ></textarea>
            BLACK-LIST (comma-separated):
            <textarea
                className={`small_text bottom_spaced ${wlUsed ? "inactive" : ""}`}
                value={blacklist}
                onChange={(event) => setBlacklist(event.target.value)}
                rows={4}
            ></textarea>
            <ButtonWithLoading
                label="SUBMIT"
                onClick={async () => {
                    const response = await window.api.call<any>(
                        "set_domain_config",
                        domain,
                        {
                            owner: initCfg.owner,
                            realm_whitelist: extractRealmIds(whitelist),
                            realm_blacklist: extractRealmIds(blacklist),
                        },
                    );
                    if ("Err" in response) {
                        return showPopUp("error", response.Err);
                    }
                }}
            />
        </div>
    );
};
