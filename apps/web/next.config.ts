import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@solshield/core', '@solshield/sdk'],
};

export default config;
