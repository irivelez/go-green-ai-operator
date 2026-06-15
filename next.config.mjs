/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Domain logic lives in src/ and is imported by app/ routes; nothing extra needed.
};

export default nextConfig;
