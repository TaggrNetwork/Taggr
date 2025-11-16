import { Principal } from "@dfinity/principal";
import * as React from "react";
import { TokenSelect } from "./token_select";
import { UserLink } from "./user_resolve";
import {
    showPopUp,
    domain,
    numberToUint8Array,
    ButtonWithLoading,
} from "./common";
import { Icrc1Canister, Post, PostTip, User } from "./types";
import { CANISTER_ID } from "./env";

export const TippingPopup = ({
    parentCallback,
    post,
    allowedTippingCanisterIds,
    canistersMetaData,
    externalTips,
    setExternalTips,
    callback,
}: {
    parentCallback?: () => void;
    post: Post;
    allowedTippingCanisterIds: string[];
    canistersMetaData: Record<string, Icrc1Canister>;
    externalTips: PostTip[];
    setExternalTips: React.Dispatch<React.SetStateAction<PostTip[]>>;
    callback: () => Promise<void>;
}) => {
    const [selectedTippingCanisterId, setSelectedTippingCanisterId] =
        React.useState(CANISTER_ID);
    const [tippingAmount, setTippingAmount] = React.useState("0.1");
    const [postAuthor, setPostAuthor] = React.useState<User | null>();
    const [showConfirmation, setShowConfirmation] = React.useState(false);

    React.useEffect(() => {
        window.api
            .query<User>("user", domain(), [post.user.toString()])
            .then(setPostAuthor);
    }, []);

    const onTokenSelectionChange = (canisterId: string) => {
        setSelectedTippingCanisterId(canisterId);

        const canister = canistersMetaData[canisterId];
        if (!canister) {
            return showPopUp(
                "error",
                `Could not find canister data for ${canisterId}`,
            );
        }
        setTippingAmount(
            (canister.fee / Math.pow(10, canister.decimals)).toFixed(
                canister.decimals,
            ),
        );
    };

    const finalizeTip = async (popUpCallback: () => void) => {
        try {
            const canisterId = selectedTippingCanisterId;
            const canister = canistersMetaData[canisterId];
            if (!canister) {
                return showPopUp(
                    "error",
                    `Could not find canister data for ${canisterId}`,
                );
            }

            const numericAmount = Number(tippingAmount);
            if (!numericAmount || isNaN(numericAmount)) return;
            const amount = Number(
                (numericAmount * Math.pow(10, canister.decimals)).toFixed(0),
            );

            if (!postAuthor)
                return showPopUp("error", "Could not load post author data.");

            const { token_symbol } = window.backendCache.config;

            // Native token tipping
            if (canister.symbol === token_symbol) {
                let response = await window.api.call<any>(
                    "tip",
                    post.id,
                    amount,
                );
                if ("Err" in response) {
                    throw new Error(response.Err);
                } else await callback();

                popUpCallback();

                return;
            }

            // ICRC-1 token tipping
            let transId = await window.api.icrc_transfer(
                Principal.fromText(canisterId),
                Principal.fromText(postAuthor.principal),
                amount,
                canister.fee,
                numberToUint8Array(post.id),
            );

            if (Number.isNaN(transId as number)) {
                throw new Error(
                    transId.toString() || "Something went wrong with transfer!",
                );
            }

            const optimisticPostTip: PostTip = {
                amount,
                canister_id: canisterId,
                index: Number(transId),
                sender_id: window.user.id,
            };
            setExternalTips([...externalTips, optimisticPostTip]);

            popUpCallback();

            let addTipResponse = await window.api.call<{
                Ok: PostTip;
                Err: string;
            }>(
                "add_external_icrc_transaction",
                canisterId,
                Number(transId),
                post.id,
            );
            if ("Err" in (addTipResponse || {}) || !addTipResponse) {
                setExternalTips(
                    externalTips.filter(
                        ({ canister_id, index }) =>
                            index !== optimisticPostTip.index ||
                            canisterId !== canister_id,
                    ),
                );
                throw new Error(
                    addTipResponse?.Err || "Could not add tip to post.",
                );
            }

            setExternalTips([
                ...externalTips.filter(
                    ({ index }) => index !== Number(transId),
                ),
                addTipResponse.Ok,
            ]);
        } catch (e: any) {
            return showPopUp("error", e?.message || e);
        }
    };

    const canister = canistersMetaData[selectedTippingCanisterId];

    return (
        <div className="column_container">
            <p>
                Tip <b>{post.meta.author_name} </b>
                with
                <TokenSelect
                    classNameArg="left_half_spaced"
                    canisters={allowedTippingCanisterIds.map((canisterId) => [
                        canisterId,
                        canistersMetaData[canisterId],
                    ])}
                    onSelectionChange={onTokenSelectionChange}
                    selectedCanisterId={selectedTippingCanisterId}
                />
            </p>
            <input
                className="bottom_spaced"
                value={tippingAmount}
                onChange={async (e) => {
                    setTippingAmount(e.target.value);
                    setShowConfirmation(false);
                }}
            />
            {showConfirmation && canister && (
                <div className="stands_out">
                    Transfer{" "}
                    <code>
                        {Number(tippingAmount).toLocaleString()}{" "}
                        {canister.symbol}
                    </code>{" "}
                    to
                    <UserLink
                        classNameArg="left_half_spaced right_half_spaced"
                        pfp={false}
                        id={post.user}
                    />
                    as a tip?
                </div>
            )}
            {!showConfirmation ? (
                <ButtonWithLoading
                    classNameArg="active"
                    label={"SEND"}
                    onClick={async () => setShowConfirmation(true)}
                />
            ) : (
                <div className="row_container">
                    <ButtonWithLoading
                        classNameArg="max_width_col right_half_spaced"
                        label={"CANCEL"}
                        onClick={async () => {
                            if (parentCallback) parentCallback();
                        }}
                    />
                    <ButtonWithLoading
                        classNameArg="active max_width_col"
                        label={"CONFIRM"}
                        onClick={() =>
                            finalizeTip(parentCallback || (() => {}))
                        }
                    />
                </div>
            )}
        </div>
    );
};
