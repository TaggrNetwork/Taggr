const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");

const isDevelopment = process.env.NODE_ENV !== "production";

const NETWORK = process.env.DFX_NETWORK || (isDevelopment ? "local" : "ic");

function initCanisterEnv() {
    let localCanisters, prodCanisters;
    try {
        localCanisters = require(path.resolve( ".dfx", "local", "canister_ids.json"));
    } catch (error) {
        console.log("No local canister_ids.json found. Continuing production");
    }
    try {
        prodCanisters = require(path.resolve("canister_ids.json"));
    } catch (error) {
        console.log("No production canister_ids.json found. Continuing with local");
    }

    const canisterConfig = NETWORK === "local" ? localCanisters : prodCanisters;

    return Object.entries(canisterConfig).reduce((prev, current) => {
        const [_canisterName, canisterDetails] = current;
        prev["CANISTER_ID"] = canisterDetails[NETWORK];
        return prev;
    }, {});
}
const canisterEnvVariables = initCanisterEnv();

const frontendDirectory = "frontend";

const asset_entry = path.join("src", frontendDirectory, "src", "index.html");

module.exports = {
    target: "web",
    mode: isDevelopment ? "development" : "production",
    entry: {
        // The frontend.entrypoint points to the HTML file for this build, so we need
        // to replace the extension to `.js`.
        index: path.join(__dirname, asset_entry).replace(/\.html$/, ".jsx"),
    },
    devtool: isDevelopment ? "source-map" : false,
    optimization: {
        minimize: !isDevelopment,
    },
    resolve: {
        extensions: [".js", ".ts", ".jsx", ".tsx"],
        fallback: {
            buffer: require.resolve("buffer/")
        },
    },
    output: {
        filename: "index.js",
        path: path.join(__dirname, "dist", frontendDirectory),
        clean: true,
    },

    // Depending in the language or framework you are using for
    // front-end development, add module loaders to the default
    // webpack configuration. For example, if you are using React
    // modules and CSS as described in the "Adding a stylesheet"
    // tutorial, uncomment the following lines:
    module: {
        rules: [
            // { test: /\.css$/, use: ['style-loader','css-loader'] },
            { test: /\.(ts|tsx|jsx)$/, loader: "ts-loader" },
            { test: /\.(md|css|svg)/i, use: 'raw-loader', }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.join(__dirname, asset_entry),
            cache: false,
            minify: isDevelopment ? false : {
                minifyCSS: true,
                collapseWhitespace: true,
                keepClosingSlash: true,
                removeComments: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true,
                useShortDoctype: true
            }
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: path.join(__dirname, "src", frontendDirectory, "assets"),
                    to: path.join(__dirname, "dist", frontendDirectory),
                },
            ],
        }),
        new webpack.EnvironmentPlugin({
            NODE_ENV: "development",
            DFX_NETWORK: NETWORK,
            ...canisterEnvVariables,
        }),
        new webpack.ProvidePlugin({
            Buffer: [require.resolve("buffer/"), "Buffer"],
            process: require.resolve("process/browser"),
        }),
    ],
    // proxy /api to port 8000 during development
    devServer: {
        host: 'localhost',
        proxy: {
            "/api": {
                target: "http://127.0.0.1:55554",
                changeOrigin: true,
                pathRewrite: {
                    "^/api": "/api",
                },
            },
        },
        hot: true,
        watchFiles: [path.resolve(__dirname, "src", frontendDirectory)],
        liveReload: true,
    },
};
