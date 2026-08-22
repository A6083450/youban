import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const root = Bun.argv.at(-1);
if (!root) throw new Error("Missing probe root");
const agentDir = resolve(root, "agent");
mkdirSync(agentDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
writeFileSync(
  join(agentDir, "hermes-memory-config.json"),
  JSON.stringify({
    memoryPolicyStyle: "none",
    reviewEnabled: false,
    flushOnCompact: false,
    flushOnShutdown: false,
    correctionDetection: false,
    failureInjectionEnabled: false,
    autoConsolidate: false,
    memoryOverflowStrategy: "reject",
    standingInstructionsEnabled: false,
  }),
);

try {
  const [codingAgent, { getModel }, { default: registerHermes }] = await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-ai/compat"),
    import("pi-hermes-memory"),
  ]);
  const settingsManager = codingAgent.SettingsManager.inMemory({ packages: [] });
  const resourceLoader = new codingAgent.DefaultResourceLoader({
    cwd: root,
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
  if (!model) throw new Error("Probe model is unavailable");
  const { session, extensionsResult } = await codingAgent.createAgentSession({
    cwd: root,
    agentDir,
    model,
    tools: ["memory_add"],
    resourceLoader,
    settingsManager,
    sessionManager: codingAgent.SessionManager.inMemory(root),
  });
  if (extensionsResult.errors.length > 0) {
    throw new Error(JSON.stringify(extensionsResult.errors));
  }
  await session.bindExtensions({});

  const memoryAdd = session.getToolDefinition("memory_add");
  if (!memoryAdd) throw new Error("memory_add was not registered");
  const content = "User prefers window seats on long-distance trains.";
  const toolResult = await memoryAdd.execute(
    "hermes-probe",
    { target: "user", content },
    undefined,
    undefined,
    undefined,
  );
  const details = toolResult.details;
  if (details?.success !== true) {
    throw new Error(`memory_add failed: ${JSON.stringify(toolResult)}`);
  }

  const memoryDir = join(agentDir, "pi-hermes-memory");
  const markdownPath = join(memoryDir, "USER.md");
  const databasePath = join(memoryDir, "sessions.db");
  const markdown = readFileSync(markdownPath, "utf-8");
  const database = new Database(databasePath, { readonly: true });
  const row = database
    .query("SELECT target, content FROM memories WHERE target = ? AND content = ?")
    .get("user", content);
  database.close();
  session.dispose();

  console.log(
    JSON.stringify({
      markdown: existsSync(markdownPath) && markdown.includes(content),
      sqlite: row?.target === "user" && row.content === content,
      warning: details.warning ?? null,
    }),
  );
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
