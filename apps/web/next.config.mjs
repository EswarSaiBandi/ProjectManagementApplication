/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Vercel build should not fail due to ESLint runtime/config issues.
    // Keep `npm run lint` for local CI checks.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
