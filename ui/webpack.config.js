const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  // Entry point of your application
  entry: './src/index.tsx',

  // Output configuration
  output: {
    path: path.resolve(__dirname, 'dist'), // Output directory
    filename: 'bundle.[contenthash].js', // Add hash for cache busting
    publicPath: '/', // Base path for assets
    clean: true, // Clean the output directory before each build
  },

  // Module resolution configuration
  resolve: {
    extensions: ['.tsx', '.ts', '.js'], // Allow importing without these extensions
    // Optional: Alias setup matching tsconfig paths
    alias: {
       '@': path.resolve(__dirname, 'src/'),
    }
  },

  // Module rules (how to handle different file types)
  module: {
    rules: [
      {
        test: /\.tsx?$/, // Match TypeScript files
        use: 'ts-loader', // Use ts-loader to transpile
        exclude: /node_modules/,
      },
      {
        test: /\.css$/, // Match CSS files
        use: ['style-loader', 'css-loader'], // Process CSS and inject into DOM
      },
       // Add loaders for images, fonts etc. if needed later
      // {
      //   test: /\.(png|svg|jpg|jpeg|gif)$/i,
      //   type: 'asset/resource',
      // },
    ],
  },

  // Plugins
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html', // Use this HTML file as a template
    }),
  ],

  // Development server configuration
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'), // Serve files from public/
    },
    compress: true, // Enable gzip compression
    port: 3002, // Port to run the dev server on
    hot: true, // Enable Hot Module Replacement
    historyApiFallback: true, // Serve index.html for any 404s (for SPA routing)
  },

   // Source maps for debugging
  devtool: 'inline-source-map', // Good for development

  // Mode (set by script flags, but can be defaulted)
  // mode: 'development',
};
