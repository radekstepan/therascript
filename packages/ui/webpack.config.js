// Webpack configuration for building the React frontend application.

const path = require('path'); // Node.js path module for resolving file paths
const webpack = require('webpack'); // Webpack core for DefinePlugin (E2E_TESTING flag)
const HtmlWebpackPlugin = require('html-webpack-plugin'); // Plugin to generate index.html with bundled scripts

module.exports = {
  // Entry point: Where Webpack starts bundling
  entry: './src/index.tsx',

  // Output configuration: Where bundled files will be placed
  output: {
    path: path.resolve(__dirname, 'dist'), // Output directory ('packages/ui/dist')
    // Output filename pattern. [contenthash] adds a hash for cache busting.
    filename: 'bundle.[contenthash].js',
    // Base path for all assets referenced in the bundle. Important for routing.
    publicPath: '/',
    // Clean the output directory before each build to remove old files.
    clean: true,
  },

  // Module resolution configuration: How Webpack finds modules
  resolve: {
    // File extensions Webpack will automatically resolve (allows importing './App' instead of './App.tsx')
    extensions: ['.tsx', '.ts', '.js'],
    // Alias setup: Matches tsconfig.json paths for convenient imports (e.g., '@/components/Button')
    alias: {
      '@': path.resolve(__dirname, 'src/'), // '@/' maps to the 'src' directory
    },
  },

  // Module rules: How Webpack processes different file types
  module: {
    rules: [
      {
        // Rule for TypeScript files (.ts, .tsx)
        test: /\.tsx?$/,
        // Use ts-loader to transpile TypeScript to JavaScript
        use: 'ts-loader',
        // Exclude node_modules to speed up compilation
        exclude: /node_modules/,
      },
      {
        // Rule for CSS files (.css)
        test: /\.css$/,
        // Chain loaders: postcss-loader -> css-loader -> style-loader
        // style-loader: Injects CSS into the DOM via <style> tags
        // css-loader: Resolves @import and url() in CSS
        // postcss-loader: Processes CSS with PostCSS (e.g., for Tailwind CSS and Autoprefixer)
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
      // Add loaders for other asset types (images, fonts) if needed
      // Example for images:
      // {
      //   test: /\.(png|svg|jpg|jpeg|gif)$/i,
      //   type: 'asset/resource', // Copies files to output directory and exports URL
      // },
    ],
  },

  // Plugins: Extend Webpack's functionality
  plugins: [
    // HtmlWebpackPlugin: Generates an index.html file in the output directory,
    // automatically injecting the bundled JavaScript file(s).
    new HtmlWebpackPlugin({
      template: './public/index.html', // Use this file as the template
    }),
    // DefinePlugin: inlines build-time constants. E2E_TESTING gates the MSW
    // worker startup in src/index.tsx so production bundles never register
    // a Service Worker or load handlers.ts. Playwright sets this to "true"
    // via `E2E_TESTING=true yarn dev` (see playwright.config.ts).
    new webpack.DefinePlugin({
      'process.env.E2E_TESTING': JSON.stringify(
        process.env.E2E_TESTING || 'false'
      ),
    }),
    // Add other plugins here (e.g., MiniCssExtractPlugin for production CSS files)
  ],

  // Development server configuration: Settings for `webpack serve`
  devServer: {
    // Serve static files (like index.html template, favicons) from the public directory.
    static: {
      directory: path.join(__dirname, 'public'),
    },
    compress: true, // Enable gzip compression for served files
    port: 3002, // Port for the development server
    // Bind on all interfaces so Tailscale/LAN peers can reach the UI.
    // Override with UI_HOST=127.0.0.1 to keep it loopback-only.
    host: process.env.UI_HOST || '0.0.0.0',
    // Accept requests from any Host header (Tailscale MagicDNS, LAN IPs).
    // Override with WEBPACK_ALLOWED_HOSTS to restrict.
    allowedHosts: process.env.WEBPACK_ALLOWED_HOSTS || 'all',
    hot: true, // Enable Hot Module Replacement (HMR) for faster development feedback
    // Serve index.html for any 404 responses. Essential for client-side routing (SPAs).
    historyApiFallback: true,
    // Proxy API and shutdown endpoints to the backend so the browser always
    // sees same-origin requests, regardless of how the UI is reached
    // (localhost, LAN, Tailscale MagicDNS, etc.). The UI never needs to know
    // the API's host:port.
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      {
        context: ['/shutdown', '/restart'],
        target: 'http://localhost:9999',
        changeOrigin: false,
      },
    ],
  },

  // Source maps: Control how source maps are generated for debugging.
  // 'inline-source-map' is good for development (embeds maps in bundle),
  // use 'source-map' for production (separate files).
  devtool: 'inline-source-map',

  // Mode: 'development' or 'production'. Affects optimizations and plugin behavior.
  // This is typically set via command-line flags (`--mode development` or `--mode production`).
  // mode: 'development',
};
