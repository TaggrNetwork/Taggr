import * as React from "react";
import { UserLink } from "./user_resolve";
import { ButtonWithLoading, showPopUp } from "./common";
import { Post } from "./types";

export const TippingPopup = ({
    parentCallback,
    post,
    callback,
}: {
    parentCallback?: () => void;
    post: Post;
    callback: () => Promise<void>;
}) => {
    const { token_symbol, token_decimals } = window.backendCache.config;
    const [tippingAmount, setTippingAmount] = React.useState("0.1");
    const [showConfirmation, setShowConfirmation] = React.useState(false);

    const finalizeTip = async (popUpCallback: () => void) => {
        try {
            const numericAmount = Number(tippingAmount);
            if (!numericAmount || isNaN(numericAmount)) return;
            const amount = Number(
                (numericAmount * Math.pow(10, token_decimals)).toFixed(0),
            );

            const response = await window.api.call<any>("tip", post.id, amount);
            if ("Err" in response) {
                throw new Error(response.Err);
            }
            await callback();
            popUpCallback();
        } catch (e: any) {
            return showPopUp("error", e?.message || e);
        }
    };

    return (
        <div className="column_container">
            <p>
                Tip <b>{post.meta.author_name}</b> with{" "}
                <code>{token_symbol}</code>
            </p>
            <input
                className="bottom_spaced"
                value={tippingAmount}
                onChange={(e) => {
                    setTippingAmount(e.target.value);
                    setShowConfirmation(false);
                }}
            />
            {showConfirmation && (
                <div className="stands_out">
                    Transfer{" "}
                    <code>
                        {Number(tippingAmount).toLocaleString()} {token_symbol}
                    </code>{" "}
                    to
                    <UserLink
                        classNameArg="left_half_spaced right_half_spaced"
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
