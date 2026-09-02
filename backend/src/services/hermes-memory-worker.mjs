import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const userRoot = Bun.argv.at(-1);
if (!userRoot) throw new Error("Hermes worker root is required");
const agentDir = resolve(userRoot, "agent");
mkdirSync(agentDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
writeFileSync(join(agentDir, "hermes-memory-config.json"), JSON.stringify({
  memoryPolicyStyle: "none",
  reviewEnabled: false,
  flushOnCompact: false,
  flushOnShutdown: false,
  correctionDetection: false,
  failureInjectionEnabled: false,
  autoConsolidate: false,
  memoryOverflowStrategy: "reject",
  standingInstructionsEnabled: false,
}));

let session;
let dbManager;
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const [codingAgent, { getModel }, { default: registerHermes }] = await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-ai/compat"),
    import("pi-hermes-memory"),
  ]);
  const settingsManager = codingAgent.SettingsManager.inMemory({ packages: [] });
  const resourceLoader = new codingAgent.DefaultResourceLoader({
    cwd: userRoot,
    agentDir,
    settingsManager,
    extensionFactories: [{ name: "pi-hermes-memory", factory: registerHermes }],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const model = getModel("openai", "gpt-4o-mini");
  if (!model) throw new Error("Hermes worker model is unavailable");
  const created = await codingAgent.createAgentSession({
    cwd: userRoot,
    agentDir,
    model,
    tools: ["memory_add", "memory_search", "memory_remove"],
    resourceLoader,
    settingsManager,
    sessionManager: codingAgent.SessionManager.inMemory(userRoot),
  });
  session = created.session;
  if (created.extensionsResult.errors.length > 0) throw new Error(JSON.stringify(created.extensionsResult.errors));
  await created.session.bindExtensions({});

  if (input.action === "list" || input.action === "remove") {
    const [{ DatabaseManager }, { getMemories }] = await Promise.all([
      import("pi-hermes-memory/src/store/db.ts"),
      import("pi-hermes-memory/src/store/sqlite-memory-store.ts"),
    ]);
    dbManager = new DatabaseManager(join(agentDir, "pi-hermes-memory"));
    const entries = getMemories(dbManager, { target: "user" });
    if (input.action === "list") {
      console.log(JSON.stringify({
        ok: true,
        output: "",
        items: entries.map((entry) => ({
          id: String(entry.id),
          memory: entry.content,
          created_at: entry.created,
        })),
      }));
    } else {
      const entry = entries.find((candidate) => String(candidate.id) === String(input.memoryId));
      if (!entry) {
        console.log(JSON.stringify({ ok: false, output: "", items: [] }));
      } else {
        const tool = created.session.getToolDefinition("memory_remove");
        if (!tool) throw new Error("memory_remove was not registered");
        const result = await tool.execute(
          "youban-remove",
          { target: "user", old_text: entry.content },
          undefined,
          undefined,
          undefined,
        );
        console.log(JSON.stringify({ ok: result.details?.success === true, output: "", items: [] }));
      }
    }
  } else {
    const toolName = input.action === "remember" ? "memory_add" : "memory_search";
    const tool = created.session.getToolDefinition(toolName);
    if (!tool) throw new Error(`${toolName} was not registered`);
    const args = input.action === "remember"
      ? { target: "user", content: input.text }
      : { target: "user", query: input.text, limit: 8 };
    const result = await tool.execute(`youban-${input.action}`, args, undefined, undefined, undefined);
    const details = result.details;
    console.log(JSON.stringify({
      ok: input.action === "remember" ? details?.success === true : details?.success !== false,
      output: input.action === "recall" ? String(details?.output ?? "") : "",
      items: [],
    }));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, output: "", items: [], error: error instanceof Error ? error.message : String(error) }));
} finally {
  dbManager?.close();
  session?.dispose();
}
