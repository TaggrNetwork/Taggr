// @ts-ignore
import template from "./style.css";
import { currentRealm } from "./common";
import { Realm, Theme } from "./types";

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
        code: "White",
        clickable: "#4CB381",
        accent: "Gold",
        light_factor: 5,
        dark_factor: 10,
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
        text: "#e0e0cf",
        background: "#1e1e23",
        code: "White",
        clickable: "#30d5c8",
        accent: "Gold",
    },
    light: {
        text: "#101010",
        background: "#F8F4EB",
        code: "Teal",
        clickable: "Teal",
        accent: "Orange",
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
    effPalette.dark_background =
        "#" + shade(effPalette.background, effPalette.dark_factor || -5);
    const styleNode = document.getElementById("style");
    if (!styleNode) return;
    styleNode.innerText = Object.keys(effPalette).reduce(
        (acc, color) => acc.replaceAll(`$${color}`, effPalette[color]),
        template,
    );
    const element = document.getElementsByName("theme-color")[0];
    if (element) element.setAttribute("content", effPalette.background);
    const app = document.getElementById("app");
    if (app) app.style.display = "block";
};

export const setTheme = (name: string) => applyTheme(getTheme(name));

// If no realm is selected, set styling once.
export const setUI = (force?: boolean) => {
    if (!force && (currentRealm() || window.uiInitialized)) return;
    setTheme(window.user?.settings.theme);
    window.uiInitialized = true;
};

export const setRealmUI = (realm: string) => {
    const user = window.user;
    window.realm = realm;
    if (user && user.settings.overrideRealmColors == "true") {
        setTheme(user.settings.theme);
        return;
    }
    window.api.query<Realm[]>("realms", [realm]).then((result) => {
        if (!result || result.length == 0) return;
        let realm = result[0];
        let realmTheme = realm.theme;
        if (realmTheme) applyTheme(JSON.parse(realmTheme));
        else setUI(true);
    });
};
