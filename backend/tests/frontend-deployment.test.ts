import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

function source(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("production application layout", () => {
  it("keeps the retired applications as backups and promotes the new applications", () => {
    expect(existsSync(join(repoRoot, "backend"))).toBe(true);
    expect(existsSync(join(repoRoot, "frontend"))).toBe(true);
    expect(existsSync(join(repoRoot, "backend.bak"))).toBe(true);
    expect(existsSync(join(repoRoot, "frontend.bak"))).toBe(true);

    for (const path of ["Dockerfile.ts", "Dockerfile"]) {
      const dockerfile = source(path);
      expect(dockerfile).toContain("frontend/package.json");
      expect(dockerfile).toContain("pnpm build:h5");
      expect(dockerfile).toContain("frontend/dist/build/h5");
      expect(dockerfile).toContain("backend/package.json");
      expect(dockerfile).not.toContain("backend-ts");
      expect(dockerfile).not.toContain("frontend-unibest");
      expect(dockerfile).not.toContain("backend.bak");
      expect(dockerfile).not.toContain("frontend.bak");
    }

    expect(source("Dockerfile.ts")).toContain("docker.m.daocloud.io/oven");
    const productionDockerfile = source("Dockerfile.ts");
    expect(productionDockerfile).toContain("WORKDIR /app/shared/contracts");
    expect(productionDockerfile).toContain(
      "cp -R /app/shared/contracts node_modules/@youban/contracts",
    );

    expect(source("Dockerfile.dev")).toContain("frontend/package.json");
    expect(source("docker-compose.dev.yaml")).toContain("./frontend:/app/frontend");
    expect(source("start.sh")).toContain("backend/src/index.ts");
    expect(source("start.sh")).not.toContain("gunicorn");
    expect(source("start.bak.sh")).toContain("gunicorn");
    expect(source("start-dev.sh")).toContain("pnpm dev:h5");
    expect(source(".dockerignore")).toContain("**/node_modules");
    expect(source(".dockerignore")).toContain("!frontend/env/.env");
    expect(source(".dockerignore")).toContain("backend.bak");
    expect(source(".dockerignore")).toContain("frontend.bak");

    expect(source("backend/src/index.ts")).toContain(
      'join(getRepoRoot(), "frontend", "dist", "build", "h5")',
    );
    expect(source("backend/scripts/skill-admin-browser-fixture.ts")).toContain(
      'join(repoRoot, "frontend", "dist", "build", "h5")',
    );

    const viteConfig = source("frontend/vite.config.ts");
    expect(viteConfig).toContain("optimizeDeps:");
    expect(viteConfig).toContain("exclude: ['@youban/contracts']");
  });
});
