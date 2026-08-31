import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

function source(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("unibest frontend deployment", () => {
  it("builds and serves the unified H5 output", () => {
    for (const path of ["Dockerfile.ts", "Dockerfile"]) {
      const dockerfile = source(path);
      expect(dockerfile).toContain("frontend-unibest/package.json");
      expect(dockerfile).toContain("pnpm build:h5");
      expect(dockerfile).toContain("frontend-unibest/dist/build/h5");
      expect(dockerfile).not.toContain("COPY frontend/");
    }

    expect(source("Dockerfile.ts")).toContain("docker.m.daocloud.io/oven");
    const productionDockerfile = source("Dockerfile.ts");
    expect(productionDockerfile).toContain("WORKDIR /app/shared/contracts");
    expect(productionDockerfile).toContain(
      "cp -R /app/shared/contracts node_modules/@youban/contracts",
    );

    expect(source("Dockerfile.dev")).toContain("frontend-unibest/package.json");
    expect(source("docker-compose.dev.yaml")).toContain("./frontend-unibest:/app/frontend-unibest");
    expect(source("start-dev.sh")).toContain("pnpm dev:h5");
    expect(source(".dockerignore")).toContain("**/node_modules");
    expect(source(".dockerignore")).toContain("!frontend-unibest/env/.env");

    expect(source("backend-ts/src/index.ts")).toContain(
      'join(getRepoRoot(), "frontend-unibest", "dist", "build", "h5")',
    );
    expect(source("backend-ts/scripts/skill-admin-browser-fixture.ts")).toContain(
      'join(repoRoot, "frontend-unibest", "dist", "build", "h5")',
    );
  });
});
