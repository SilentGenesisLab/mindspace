import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    '/**': ['./db/**/*.sql', './cli/**/*'],
  },
};

export default nextConfig;
