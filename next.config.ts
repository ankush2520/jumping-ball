import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";
const repoPath = "/jumping-ball";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isGithubPages ? repoPath : "",
  assetPrefix: isGithubPages ? repoPath : undefined,
};

export default nextConfig;
