const UNSAFE_MARKER = /(?:system|developer|assistant|user)\s*prompt|\bprompt\b|api[_-]?key|authorization\s*:|bearer\s+|\bsecret\b|password|credential|\btoken\b|\btool\b|tool[_ .-]?(?:call|result|payload)|function[_ .-]?call|\breasoning\b|provider[_ .-]?event|response\.[\w.-]+|\bsk-[a-z0-9_-]+|系统提示|开发者提示|工具调用|工具载荷|内部推理|密钥|密码|令牌/i;
const MULTILINE_PROTOCOL = /(?:^|\n)\s*(?:data\s*:|event\s*:|id\s*:|\{|\[|<\/?[a-z]|["'][\w.-]+["']\s*:)/im;

export function visibleThoughtSummary(input: unknown, visible: boolean): string | null {
  if (!visible || typeof input !== "string") return null;
  if (UNSAFE_MARKER.test(input) || (input.includes("\n") && MULTILINE_PROTOCOL.test(input))) return null;

  const summary = input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`>#|]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return summary ? summary.slice(0, 160) : null;
}
