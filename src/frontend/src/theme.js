import template from '../assets/style.css';

var shade = function(color, percent) {
    var num = parseInt(color.replace("#",""), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        B = (num >> 8 & 0x00FF) + amt,
        G = (num & 0x0000FF) + amt;
    return (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (B<255?B<1?0:B:255)*0x100 + (G<255?G<1?0:G:255)).toString(16).slice(1);
};

export const themes = {
    "calm": {
        "text": "#e0e0c8",
        "background": "#343541",
        "code": "White",
        "clickable": "#30d5c8",
        "accent": "Gold"
    },
    "classic": {
        "text": "#d0d0bf",
        "background": "#1c3239",
        "code": "White",
        "clickable": "#30d5c8",
        "accent": "#FFc700"
    },
    "light": {
        "text": "#23383F",
        "background": "#c3c3b4",
        "code": "Black",
        "clickable": "#008080",
        "accent": "OrangeRed"
    },
    "dark": {
        "text": "#d0d0bf",
        "background": "#1e1e23",
        "code": "White",
        "clickable": "#30d5c8",
        "accent": "Gold"
    },
    "midnight": {
        "text": "#e0e0cf",
        "background": "#111d2b",
        "code": "White",
        "clickable": "#7fffd4",
        "accent": "#FFd700"
    }
};

export const applyTheme = palette => {
    let autoTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light";
    const effPalette = palette ? palette : themes[autoTheme];
    effPalette["light_background"] = "#" + shade(effPalette.background, 3);
    effPalette["dark_background"] = "#" + shade(effPalette.background, -5);
    effPalette["visited_clickable"] = "#" + shade(effPalette.clickable, -20);
    const styleNode = document.getElementById("style");
    styleNode.innerText = Object.keys(effPalette).reduce((acc, color) =>
        acc.replaceAll(`$${color}`, effPalette[color]), template);
}
