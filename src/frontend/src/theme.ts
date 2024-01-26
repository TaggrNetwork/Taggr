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
    black: {
        text: "#d0d0d0",
        background: "#060606",
        selected_background: "#303030",
        code: "White",
        clickable: "#4CB381",
        accent: "Gold",
        light_factor: 6,
    },
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
    dark: {
        text: "#d0d0b8",
        background: "#1e1e23",
        code: "White",
        clickable: "#30d5c8",
        accent: "Gold",
    },
    light: {
        text: "#101010",
        background: "#EAEAEA",
        code: "black",
        clickable: "#0066EE",
        accent: "MediumSeaGreen",
    },
    midnight: {
        text: "#e0e0cf",
        background: "#111d2b",
        code: "White",
        clickable: "#7fffd4",
        accent: "#FFd700",
    },
};

const applyTheme = (palette: Theme) => {
    const effPalette: Theme = palette ? palette : themes["dark"];
    effPalette.light_background =
        "#" + shade(effPalette.background, effPalette.light_factor || 3);
    effPalette.dark_background = "#" + shade(effPalette.background, -5);
    effPalette.visited_clickable = "#" + shade(effPalette.clickable, -20);
    effPalette.selected_background =
        effPalette.selected_background || effPalette.dark_background;
    const styleNode = document.getElementById("style");
    if (!styleNode) return;
    styleNode.innerText = Object.keys(effPalette).reduce(
        (acc, color) => acc.replaceAll(`$${color}`, effPalette[color]),
        template,
    );
    const element = document.getElementsByName("theme-color")[0];
    if (element) element.setAttribute("content", effPalette.background);
};

export const setTheme = (name: string) => applyTheme(getTheme(name));

// If no realm is selected, set styling once.
export const setUI = (force?: boolean) => {
    if (!force && (currentRealm() || window.uiInitialized)) return;
    setTheme(window.user?.settings.theme);
    window.uiInitialized = true;
};

export const setRealmUI = (realm: string) => {
    window.realm = realm;
    if (window.user && window.user.settings.overrideRealmColors == "true")
        return;
    window.api.query("realm", realm).then((result: any) => {
        let realmTheme = result.Ok?.theme;
        if (realmTheme) applyTheme(JSON.parse(realmTheme));
        else setUI(true);
    });
};
