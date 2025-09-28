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
    const [heartbeat, setHeartbeat] = React.useState(0);

    React.useEffect(() => {
        window.api
            .query<any>("domains")
            .then((cfgs) => setDomainConfigs(cfgs || {}));
    }, [heartbeat]);
    const user = window.user;
    const userDomains = user
        ? Object.entries(domainConfigs || {}).filter(
              ([_, cfg]) => cfg.owner == user.id,
          )
        : [];
    return (
        <div className="spaced">
            <HeadBar
                title="DOMAINS"
                shareLink="domains"
                menu={true}
                content={
                    <NewDomainForm
                        callback={() => setHeartbeat(heartbeat + 1)}
                    />
                }
            />
            <h2>Taggr domains</h2>
            <ul>
                {Object.entries(domainConfigs || {})
                    .filter(([domain]) => domain != "localhost")
                    .map(([domain, cfg]) => (
                        <li key={domain}>
                            <a href={`https://${domain}`}>{domain}</a>
                            <ul>
                                <li>
                                    Owner:{" "}
                                    {cfg.owner == null ? (
                                        "DAO"
                                    ) : (
                                        <UserLink id={cfg.owner} pfp={false} />
                                    )}
                                </li>
                                {"WhiteListedRealms" in cfg.sub_config && (
                                    <li>
                                        White-listed realms:{" "}
                                        {commaSeparated(
                                            cfg.sub_config.WhiteListedRealms.map(
                                                (id) => (
                                                    <a
                                                        href={`#/realm/${id}`}
                                                    >{`/${id}`}</a>
                                                ),
                                            ),
                                        )}
                                    </li>
                                )}
                                {"BlackListedRealms" in cfg.sub_config &&
                                    cfg.sub_config.BlackListedRealms.length >
                                        0 && (
                                        <li>
                                            Black-listed realms:{" "}
                                            {commaSeparated(
                                                cfg.sub_config.BlackListedRealms.map(
                                                    (id) => (
                                                        <a
                                                            href={`#/realm/${id}`}
                                                        >{`/${id}`}</a>
                                                    ),
                                                ),
                                            )}
                                        </li>
                                    )}
                                {"Journal" in cfg.sub_config && (
                                    <li>Redirects to the journal.</li>
                                )}
                                <li>
                                    Maximum number of downvotes for posts
                                    displayed: <code>{cfg.max_downvotes}</code>
                                </li>
                            </ul>
                        </li>
                    ))}
            </ul>
            {userDomains.length > 0 && (
                <div className="vertically_spaced">
                    <h2>Your domains</h2>
                    {
                        // @ts-ignore
                        userDomains.map(([domain, cfg]) => (
                            <DomainForm
                                key={domain}
                                domain={domain}
                                initCfg={cfg}
                                callback={() => setHeartbeat(heartbeat + 1)}
                            />
                        ))
                    }
                </div>
            )}
        </div>
    );
};

const DomainForm = ({
    domain,
    callback,
    initCfg,
}: {
    domain: string;
    callback: () => void;
    initCfg: DomainConfig;
}) => {
    const [maxDownvotes, setMaxDownvotes] = React.useState(
        initCfg.max_downvotes,
    );
    const [cfgType, setCfgType] = React.useState<string>(
        "WhiteListedRealms" in initCfg.sub_config
            ? "whitelist"
            : "BlackListedRealms" in initCfg.sub_config
              ? "blacklist"
              : "journal",
    );
    const [whitelist, setWhitelist] = React.useState<string>(
        "WhiteListedRealms" in initCfg.sub_config
            ? initCfg.sub_config.WhiteListedRealms.join("\n")
            : "",
    );
    const [blacklist, setBlacklist] = React.useState<string>(
        "BlackListedRealms" in initCfg.sub_config
            ? initCfg.sub_config.BlackListedRealms.join("\n")
            : "",
    );
    const [instructions, showInstructions] = React.useState(false);
    const extractRealmIds = (value: string) =>
        value.trim().toUpperCase().split("\n").filter(Boolean);
    return (
        <div className="stands_out top_spaced column_container">
            <h4>{domain}</h4>
            <select
                value={cfgType}
                className="bottom_spaced"
                onChange={(event) => setCfgType(event.target.value)}
            >
                <option value="journal">JOURNAL</option>
                <option value="whitelist">REALM WHITE LIST</option>
                <option value="blacklist">REALM BLACK LIST</option>
            </select>
            {cfgType == "journal" && (
                <p>This domain will only display the journal of the owner.</p>
            )}
            {cfgType == "whitelist" && (
                <>
                    <p>
                        This domain will only display posts from the realms that
                        are white-listed below.
                    </p>
                    WHITE-LIST (one per line):
                    <textarea
                        className="small_text bottom_spaced top_half_spaced"
                        value={whitelist}
                        onChange={(event) => setWhitelist(event.target.value)}
                        rows={4}
                    ></textarea>
                </>
            )}
            {cfgType == "blacklist" && (
                <>
                    <p>
                        This domain will only display all posts except from the
                        realms that are black-listed below.
                    </p>
                    BLACK-LIST (one per line):
                    <textarea
                        className="small_text bottom_spaced top_half_spaced"
                        value={blacklist}
                        onChange={(event) => setBlacklist(event.target.value)}
                        rows={4}
                    ></textarea>
                </>
            )}
            <div className="row_container spaced vcentered">
                <span>Maximum number of downvotes for posts displayed:</span>
                <input
                    className="left_spaced max_width_col"
                    type="number"
                    value={maxDownvotes}
                    onChange={(e) => setMaxDownvotes(Number(e.target.value))}
                />
            </div>
            {instructions && <DomainInstructions domain={domain} />}
            <div className="row_container">
                {!instructions && (
                    <button
                        className="max_width_col medium_text"
                        onClick={() => showInstructions(true)}
                    >
                        SHOW INSTRUCTIONS
                    </button>
                )}
                <ButtonWithLoading
                    classNameArg="max_width_col"
                    label="REMOVE"
                    onClick={async () => {
                        const response = await window.api.call<any>(
                            "set_domain_config",
                            domain,
                            {},
                            "remove",
                        );
                        if ("Err" in response) {
                            return showPopUp("error", response.Err);
                        } else {
                            showPopUp("success", "Domain removed");
                        }
                        callback();
                    }}
                />
                <ButtonWithLoading
                    classNameArg="max_width_col"
                    label="SUBMIT"
                    onClick={async () => {
                        const cfg: DomainConfig = {
                            owner: initCfg.owner,
                            max_downvotes: maxDownvotes,
                            sub_config: {} as any,
                        };
                        if (cfgType == "journal") {
                            cfg.sub_config = {
                                Journal: initCfg.owner,
                            };
                        } else if (cfgType == "whitelist") {
                            cfg.sub_config = {
                                WhiteListedRealms: extractRealmIds(whitelist),
                            };
                        } else {
                            cfg.sub_config = {
                                BlackListedRealms: extractRealmIds(blacklist),
                            };
                        }
                        const response = await window.api.call<any>(
                            "set_domain_config",
                            domain,
                            cfg,
                            "update",
                        );
                        if ("Err" in response) showPopUp("error", response.Err);
                        else showPopUp("success", "Config updated");
                        callback();
                    }}
                />
            </div>
        </div>
    );
};

const NewDomainForm = ({ callback }: { callback: () => void }) => {
    const [domain, setDomain] = React.useState("");
    const [domainAdded, setDomainAdded] = React.useState(false);

    return (
        <div className="column_container">
            <h2>Add your domain</h2>
            <input
                type="text"
                value={domain}
                className="bottom_spaced"
                placeholder="Domain name, e.g. hostname.com"
                onChange={(event) => setDomain(event.target.value)}
            />
            {!domainAdded && (
                <ButtonWithLoading
                    classNameArg="active"
                    onClick={async () => {
                        const response = await window.api.call<any>(
                            "set_domain_config",
                            domain,
                            {},
                            "insert",
                        );
                        if ("Err" in response) showPopUp("error", response.Err);
                        else {
                            showPopUp("success", "Domain added");
                            setDomainAdded(true);
                        }
                        callback();
                    }}
                    label={"ADD"}
                />
            )}
            {domainAdded && <DomainInstructions domain={domain} />}
        </div>
    );
};

const DomainInstructions = ({ domain }: { domain: string }) => (
    <div className="selectable bottom_spaced">
        <h2>Set up instructions</h2>
        <ol>
            <li>
                Configure the DNS settings of your domain and add the following
                records:
            </li>
            <ol>
                <li>
                    Add a <code>ANAME</code> or <code>ALIAS</code> record with
                    value <code>{`${domain}.icp1.io`}</code>. If your registrar
                    does not support these record types, ping the{" "}
                    <code>icp1.io</code> domain and add a <code>A</code> record
                    with name <code>@</code> and the IP address you observed in
                    the ping output.
                </li>
                <li>
                    Add a <code>TXT</code> record with name{" "}
                    <code>_canister-id</code> and value{" "}
                    <code>{window.backendCache.stats.canister_id}</code>.
                </li>
                <li>
                    Add a <code>CNAME</code> record with name{" "}
                    <code>_acme-challenge</code> and value{" "}
                    <code>_acme-challenge.{domain}.icp2.io</code>.
                </li>
            </ol>
            <li>
                Wait about 10 minutes until the changes propagate through the
                Internet.
            </li>
            <li>
                Execute this command in the terminal:
                <code>
                    <pre>
                        {`curl -sL -X POST \\
    -H 'Content-Type: application/json' \\
    https://icp0.io/registrations \\
    --data @- <<EOF
    {
      "name": "${domain}"
    }
EOF`}
                    </pre>
                </code>
            </li>
            <li>
                If the call was successful, you will get a JSON response that
                contains the request ID in the body, which you can use to query
                the status of your registration request:
                <code>
                    <pre>{`{"id":"REQUEST_ID"}`}</pre>
                </code>
            </li>
            <li>
                Track the progress of your registration request by issuing the
                following command and replacing REQUEST_ID with the ID you
                received in the previous step.
                <code>
                    <pre>{`curl -sL -X GET https://icp0.io/registrations/REQUEST_ID`}</pre>
                </code>
            </li>
            <li>
                For more details, consult the{" "}
                <a href="https://internetcomputer.org/docs/building-apps/frontends/custom-domains/using-custom-domains">
                    official documentation
                </a>
                .
            </li>
        </ol>
    </div>
);
