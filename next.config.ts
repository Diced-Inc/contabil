import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: ["127.0.0.1"],
  // Canto inferior esquerdo é do bloco de usuário da sidebar.
  devIndicators: { position: "bottom-right" },
  // Upload de OFX vai por server action; um arquivo por requisição; o limite real (4,4 MB) é checado em importarOfxArquivo; a Vercel corta em 4,5 MB.
  experimental: { serverActions: { bodySizeLimit: "4.4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
