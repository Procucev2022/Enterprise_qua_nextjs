/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the build output directory to be overridden so a verification build
  // (e.g. the pre-commit quality gate) can run without colliding with a live
  // `next dev` server, which holds `.next/trace` open and causes EPERM on Windows.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NODE_BACKEND_URL
          ? `${process.env.NODE_BACKEND_URL}/api/:path*`
          : 'http://localhost:4000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
