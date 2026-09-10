/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pokemontcg.io",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "tcgplayer-cdn.tcgplayer.com",
        pathname: "/product/**",
      },
    ],
  },
  experimental: {
    // The Target catalog data layer reads data-imports/*.json at runtime, so
    // make sure the folder is bundled into the /api/target-catalog serverless
    // function on Vercel (Next's tracer can't infer fs.readdir targets).
    outputFileTracingIncludes: {
      "/api/target-catalog": ["./data-imports/**"],
    },
  },
};

export default nextConfig;
