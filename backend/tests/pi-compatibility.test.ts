import { describe, expect, it } from "bun:test";

describe("Pi SDK compatibility", () => {
  it("loads the coding-agent SDK and pi-subagents extension under Bun", async () => {
    const [{ createAgentSession, DefaultResourceLoader, SessionManager }, subagents] =
      await Promise.all([
        import("@earendil-works/pi-coding-agent"),
        import("pi-subagents"),
      ]);

    expect(process.versions.bun).toBe("1.4.0");
    expect(typeof createAgentSession).toBe("function");
    expect(typeof DefaultResourceLoader).toBe("function");
    expect(typeof SessionManager).toBe("function");
    expect(typeof subagents.default).toBe("function");
  });
});
