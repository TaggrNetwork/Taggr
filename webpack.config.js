const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

const isDevelopment = process.env.NODE_ENV !== "production";
const NETWORK = process.env.DFX_NETWORK || (isDevelopment ? "local" : "ic");

function getDfxPort() {
    try {
        const { execSync } = require("child_process");
        const port = execSync("dfx info webserver-port", {
            encoding: "utf8",
        }).trim();
        return port;
    } catch (error) {
        return "8080";
    }
}

function initCanisterEnv() {
    let localCanisters, prodCanisters;
    try {
        localCanisters = require(
            path.resolve(".dfx", "local", "canister_ids.json"),
        );
    } catch (error) {
        console.log("No local canister_ids.json found. Continuing production");
    }
    try {
        prodCanisters = require(path.resolve("canister_ids.json"));
    } catch (error) {
        console.log(
            "No production canister_ids.json found. Continuing with local",
        );
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
                target: `http://127.0.0.1:${getDfxPort()}`,
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
