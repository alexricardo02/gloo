import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');
/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      // Camera photos can be 2–8 MB each; raise the limit so payloads reach
      // server-side validation (magic-byte check + 5 MB cap) before being
      // rejected. Client-side compression keeps actual transfers well below
      // this ceiling.
      bodySizeLimit: '10mb',
    },
  },
};

export default withNextIntl(nextConfig);

