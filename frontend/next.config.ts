import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  // This creates a minimal server.js that includes all dependencies
  output: 'standalone',

  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'app-myworkmate-frontend-prod.braveglacier-052ab41a.westeurope.azurecontainerapps.io',
          },
        ],
        destination: 'https://www.myworkmate.ai/:path*',
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
