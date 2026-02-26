const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    return {
        entry: './src/index.js',

        output: {
            filename: 'index.js',
            path: path.resolve(__dirname, 'dist'),
            iife: true,
            clean: true,
        },

        optimization: {
            minimize: isProduction,
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        format: {
                            comments: false,
                        },
                        compress: {
                            drop_console: false,
                            drop_debugger: true,
                        },
                    },
                    extractComments: false,
                }),
            ],
        },

        devtool: isProduction ? false : 'inline-source-map',

        watchOptions: {
            ignored: /node_modules/,
            aggregateTimeout: 300,
        },

        performance: {
            hints: isProduction ? 'warning' : false,
            maxEntrypointSize: 512000,
            maxAssetSize: 512000,
        },

        resolve: {
            extensions: ['.js'],
            alias: {
                '@': path.resolve(__dirname, 'src'),
                '@core': path.resolve(__dirname, 'src/core'),
                '@config': path.resolve(__dirname, 'src/config'),
                '@worldbook': path.resolve(__dirname, 'src/worldbook'),
                '@api': path.resolve(__dirname, 'src/api'),
                '@memory': path.resolve(__dirname, 'src/memory'),
                '@hooks': path.resolve(__dirname, 'src/hooks'),
                '@ui': path.resolve(__dirname, 'src/ui'),
                '@utils': path.resolve(__dirname, 'src/utils'),
                '@table-filler': path.resolve(__dirname, 'src/table-filler'),
            }
        },
    };
};
