import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow build to continue with ESLint warnings
  eslint: {
    ignoreDuringBuilds: true, // Ignore ESLint during builds
  },
  typescript: {
    // Allow build to continue with TypeScript errors (optional)
    ignoreBuildErrors: false,
  },
  webpack: (config, { isServer, webpack }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    
    // Ignore React Native modules that MetaMask SDK tries to import
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };
    
    // Add buffer polyfill for browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: require.resolve('buffer'),
      };
      
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
        })
      );
    }
    
    return config;
  },
};

export default nextConfig;
