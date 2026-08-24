const UNSAFE_MARKER = /(?:system|developer|assistant|user)[\s._:=/-]*prompt|prompt|api[\s._:=/-]*key|authorization|bearer|secret|password|credential|token|tool|function[\s._:=/-]*call|reasoning|provider[\s._:=/-]*event|response[\s._:=/-]+[\w.-]+|sk-[a-z0-9_-]+|系统提示|开发者提示|工具调用|工具载荷|内部推理|密钥|密码|令牌/i;
const MULTILINE_PROTOCOL = /(?:^|\n)\s*(?:data\s*:|event\s*:|id\s*:|\{|\[|<\/?[a-z]|["'][\w.-]+["']\s*:)/im;

function normalizeForInspection(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1 $2")
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1 $2")
    .replace(/[<>]/g, "")
    .replace(/[*_~`>#|]/g, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}

export function visibleThoughtSummary(input: unknown, visible: boolean): string | null {
  if (!visible || typeof input !== "string") return null;
  const normalized = normalizeForInspection(input);
  if (UNSAFE_MARKER.test(normalized) || MULTILINE_PROTOCOL.test(normalized)) return null;

  const summary = normalized
    .replace(/\s+/g, " ")
    .trim();
  return summary ? summary.slice(0, 160) : null;
}
