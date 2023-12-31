// @ts-ignore
import template from "./style.css";
import { currentRealm } from "./common";
import { Theme } from "./types";

var shade = function (color: string, percent: number) {
    var num = parseInt(color.replace("#", ""), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        B = ((num >> 8) & 0x00ff) + amt,
        G = (num & 0x0000ff) + amt;
    return (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (B < 255 ? (B < 1 ? 0 : B) : 255) * 0x100 +
        (G < 255 ? (G < 1 ? 0 : G) : 255)
    )
        .toString(16)
        .slice(1);
};

export const getTheme = (name: string) => themes[name];

const themes: { [name: string]: Theme } = {
    calm: {
        text: "#e0e0c8",
        background: "#343541",
        code: "White",
        clickable: "#30d5c8",
        accent: "Gold",
    },
    classic: {
        text: "#e0e0c8",
        background: "#1c3239",
        code: "White",
        clickable: "#30d5c8",
        accent: "#FFc700",
    },
    light: {
        text: "#23383F",
        background: "#c3c3b4",
        code: "Black",
        clickable: "#008080",
        accent: "OrangeRed",
    },
    dark: {
        text: "#d0d0b8",
        background: "#1e1e23",
        code: "White",
        clickable: "#30d5c8",
        accent: "Gold",
    },
    midnight: {
        text: "#e0e0cf",
        background: "#111d2b",
        code: "White",
        clickable: "#7fffd4",
        accent: "#FFd700",
    },
};

export const applyTheme = (palette: Theme) => {
    let autoTheme =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    const effPalette: Theme = palette ? palette : themes[autoTheme];
    effPalette.light_background = "#" + shade(effPalette.background, 3);
    effPalette.dark_background = "#" + shade(effPalette.background, -5);
    effPalette.visited_clickable = "#" + shade(effPalette.clickable, -20);
    const styleNode = document.getElementById("style");
    if (!styleNode) return;
    styleNode.innerText = Object.keys(effPalette).reduce(
        (acc, color) => acc.replaceAll(`$${color}`, effPalette[color]),
        template,
    );
    const element = document.getElementsByName("theme-color")[0];
    if (element) element.setAttribute("content", effPalette.background);
};

// If no realm is selected, set styling once.
export const setUI = (force?: boolean) => {
    if (!force && (currentRealm() || window.uiInitialized)) return;
    applyTheme(getTheme(window.user?.settings_object.theme));
    window.uiInitialized = true;
};

export const setRealmUI = (realm: string) => {
    window.realm = realm;
    window.api.query("realm", realm).then((result: any) => {
        let realmTheme = result.Ok?.theme;
        if (realmTheme) applyTheme(JSON.parse(realmTheme));
        else setUI(true);
    });
};
