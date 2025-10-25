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
        splitChunks: {
            chunks: "all",
            cacheGroups: {
                // Vendor chunk for node_modules
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: "vendors",
                    chunks: "all",
                    priority: 20,
                    minSize: 20000,
                },
                // React-specific chunk
                react: {
                    test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
                    name: "react",
                    chunks: "all",
                    priority: 30,
                },
                // DFINITY/IC libraries
                dfinity: {
                    test: /[\\/]node_modules[\\/]@dfinity[\\/]/,
                    name: "dfinity",
                    chunks: "all",
                    priority: 25,
                },
                // App components in single chunk
                appComponents: {
                    test: /[\\/]src[\\/]frontend[\\/]src[\\/](?!index\.tsx$).*\.tsx$/,
                    name: "app-components",
                    chunks: "all",
                    priority: 15,
                },
                // Default chunk for remaining code
                default: {
                    minChunks: 2,
                    priority: 1,
                    reuseExistingChunk: true,
                },
            },
        },
    },
    resolve: {
        extensions: [".js", ".ts", ".jsx", ".tsx"],
        fallback: {
            buffer: require.resolve("buffer/"),
        },
    },
    output: {
        filename: "[name].js",
        chunkFilename: "[name].chunk.js",
        path: path.join(__dirname, "dist", frontendDirectory),
        chunkFormat: "array-push",
        crossOriginLoading: "anonymous",
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
