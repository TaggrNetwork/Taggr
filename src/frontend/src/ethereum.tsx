import * as React from "react";
import { CopyToClipboard, HeadBar, Loading } from "./common";

export const Ethereum = () => {
    const [address, setAddress] = React.useState<string | null>();

    React.useEffect(() => {
        (async () => {
            setAddress(await window.api.query<string>("eth_address"));
        })();
    }, []);

    return (
        <>
            <HeadBar title="ETHEREUM" shareLink="ethereum" />
            <div className="column_container spaced">
                <p className="stands_out">
                    The canister controls this Ethereum L1 account (EOA). It can
                    be assigned as a controller of smart contracts.
                </p>
                {address === undefined ? (
                    <Loading />
                ) : address ? (
                    <>
                        <CopyToClipboard value={address} testId="eth-address" />
                        <a
                            href={`https://etherscan.io/address/${address}`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            VIEW ON ETHERSCAN
                        </a>
                    </>
                ) : (
                    <p>The address hasn't been derived yet.</p>
                )}
            </div>
        </>
    );
};
