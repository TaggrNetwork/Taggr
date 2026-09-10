const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

const isDevelopment = process.env.NODE_ENV !== "production";
const NETWORK = process.env.DFX_NETWORK || (isDevelopment ? "local" : "ic");

function getGatewayPort() {
    try {
        const { execSync } = require("child_process");
        const status = JSON.parse(
            execSync("icp network status --json", {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }),
        );
        const url = new URL(status.gateway_url || status.api_url);
        return url.port || "8000";
    } catch (error) {
        return "8000";
    }
}

function initCanisterEnv() {
    // icp-cli records canister IDs per environment. Managed networks (local)
    // live in .icp/cache; connected networks (ic, staging, ...) are committed
    // under .icp/data.
    const mappingPath =
        NETWORK === "local"
            ? path.resolve(".icp", "cache", "mappings", "local.ids.json")
            : path.resolve(".icp", "data", "mappings", `${NETWORK}.ids.json`);

    let mapping;
    try {
        mapping = require(mappingPath);
    } catch (error) {
        console.log(`No canister ID mapping found at ${mappingPath}`);
        return {};
    }

    return { CANISTER_ID: mapping["taggr"] };
}
const canisterEnvVariables = initCanisterEnv();

const frontendDirectory = "frontend";
const asset_entry = path.join("src", frontendDirectory, "src", "index.html");

module.exports = {
    target: "web",
    mode: isDevelopment ? "development" : "production",
    entry: {
        index: path.join(__dirname, asset_entry).replace(/\.html$/, ".tsx"),
    },
    devtool: isDevelopment ? "source-map" : false,
    optimization: {
        minimize: !isDevelopment,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: true,
                        dead_code: true,
                        passes: 2,
                    },
                    output: {
                        comments: false,
                    },
                },
                extractComments: false,
            }),
        ],
    },
    resolve: {
        extensions: [".js", ".ts", ".jsx", ".tsx"],
        fallback: {
            buffer: require.resolve("buffer/"),
        },
    },
    output: {
        filename: "[name].js",
        path: path.join(__dirname, "dist", frontendDirectory),
        clean: true,
    },
    module: {
        rules: [
            {
                test: /\.js\.map$/,
                type: "asset/resource",
                generator: { emit: false },
            },
            {
                test: /\.d\.ts\.map$/,
                type: "asset/resource",
                generator: { emit: false },
            },
            {
                test: /\.d\.ts$/,
                type: "asset/resource",
                generator: { emit: false },
            },
            {
                test: /\.(ts|tsx|jsx)$/,
                loader: "ts-loader",
                exclude: [/node_modules/],
            },
            { test: /\.(md|css|svg)/i, use: "raw-loader" },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.join(__dirname, asset_entry),
            cache: false,
            minify: isDevelopment
                ? false
                : {
                      minifyCSS: true,
                      collapseWhitespace: true,
                      keepClosingSlash: true,
                      removeComments: true,
                      removeRedundantAttributes: true,
                      removeScriptTypeAttributes: true,
                      removeStyleLinkTypeAttributes: true,
                      useShortDoctype: true,
                  },
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: path.join(
                        __dirname,
                        "src",
                        frontendDirectory,
                        "assets",
                    ),
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
    devServer: {
        port: 9090,
        host: "0.0.0.0",
        allowedHosts: "all",
        proxy: [
            {
                context: ["/api"],
                target: `http://127.0.0.1:${getGatewayPort()}`,
                changeOrigin: true,
                pathRewrite: {
                    "^/api": "/api",
                },
            },
        ],
        hot: true,
        watchFiles: [path.resolve(__dirname, "src", frontendDirectory)],
        liveReload: true,
    },
};
