/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Vercel build should not fail due to ESLint runtime/config issues.
    // Keep `npm run lint` for local CI checks.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Tell Next.js to bundle these packages for server-side rendering
    serverComponentsExternalPackages: ['@react-pdf/renderer'],
  },
  webpack: (config, { isServer }) => {
    // Fix for @react-pdf/renderer and fontkit module resolution
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      };
    }
    
    // Ignore node-specific modules that aren't needed in browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      canvas: false,
      encoding: false,
    };

    return config;
  },
};

export default nextConfig;
