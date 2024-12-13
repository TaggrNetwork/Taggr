const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");

const isDevelopment = process.env.NODE_ENV !== "production";
const NETWORK = process.env.DFX_NETWORK || (isDevelopment ? "local" : "ic");

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
        chunkFormat: false,
        clean: true,
    },
    module: {
        rules: [
            { test: /\.js\.map$/, loader: "ignore-loader" },
            { test: /\.d\.ts\.map$/, loader: "ignore-loader" },
            { test: /\.d\.ts$/, loader: "ignore-loader" },
            {
                test: /\.(ts|tsx|jsx)$/,
                loader: "ts-loader",
                exclude: [/node_modules/],
            },
            { test: /\.(md|css|svg)/i, use: "raw-loader" },
        ],
    },
    plugins: [
        new BundleAnalyzerPlugin({
            analyzerMode: "static",
            openAnalyzer: false,
        }),
        new HtmlWebpackPlugin({
            template: path.join(__dirname, asset_entry),
            cache: false,
            chunks: ["index"],
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
        host: "localhost",
        proxy: [
            {
                context: ["/api"],
                target: "http://127.0.0.1:8080",
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
