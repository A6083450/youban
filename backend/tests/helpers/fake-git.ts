import type {
  GitInvocation,
  GitResult,
  GitRunner,
} from "../../src/agents/skill-git-importer.ts";

export interface RecordedGitInvocation {
  args: readonly string[];
  cwd?: string;
  env: Readonly<Record<string, string | undefined>>;
  envKeys: readonly string[];
  authorizationHeaderKeys: readonly string[];
  timeoutMs: number;
}

type GitHandler = (
  invocation: GitInvocation,
  invocationIndex: number,
) => GitResult | Promise<GitResult>;

function recordEnvironment(
  env: Readonly<Record<string, string>> | undefined,
): Pick<RecordedGitInvocation, "env" | "envKeys" | "authorizationHeaderKeys"> {
  const entries = Object.entries(env ?? {});
  const authorizationHeaderKeys = entries
    .filter(([, value]) => /^Authorization: Bearer /i.test(value))
    .map(([key]) => key);
  return {
    env: Object.fromEntries(entries.map(([key, value]) => [
      key,
      /^Authorization: Bearer /i.test(value) ? undefined : value,
    ])),
    envKeys: entries.map(([key]) => key),
    authorizationHeaderKeys,
  };
}

export class FakeGitRunner implements GitRunner {
  readonly invocations: RecordedGitInvocation[] = [];

  constructor(private readonly handler: GitHandler) {}

  get lastInvocation(): RecordedGitInvocation | undefined {
    return this.invocations.at(-1);
  }

  async run(invocation: GitInvocation): Promise<GitResult> {
    const environment = recordEnvironment(invocation.env);
    this.invocations.push({
      args: [...invocation.args],
      cwd: invocation.cwd,
      timeoutMs: invocation.timeoutMs,
      ...environment,
    });
    return await this.handler(invocation, this.invocations.length - 1);
  }
}
