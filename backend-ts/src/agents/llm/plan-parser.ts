export function stripCommentsOutsideStrings(input: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < input.length) {
    const char = input[index]!;
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }
    if (char === "/" && input[index + 1] === "/") {
      index += 2;
      while (index < input.length && input[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && input[index + 1] === "*") {
      index += 2;
      while (index + 1 < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

export function removeTrailingCommas(input: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < input.length) {
    const char = input[index]!;
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }
    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(input[lookahead] ?? "")) lookahead += 1;
      if (input[lookahead] === "}" || input[lookahead] === "]") {
        index += 1;
        continue;
      }
    }
    output += char;
    index += 1;
  }
  return output;
}

function evaluateArithmetic(expression: string): number | undefined {
  const afterEquals = expression.includes("=") ? expression.slice(expression.lastIndexOf("=") + 1) : expression;
  const compact = afterEquals.replaceAll(/\s/g, "");
  if (!/^\d+(?:\.\d+)?(?:[+\-*/]\d+(?:\.\d+)?)*$/.test(compact)) return undefined;
  const tokens = compact.match(/\d+(?:\.\d+)?|[+\-*/]/g);
  if (!tokens) return undefined;
  const firstPass: Array<number | string> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "*" || token === "/") {
      const left = Number(firstPass.pop());
      const right = Number(tokens[++index]);
      if (token === "/" && right === 0) return undefined;
      firstPass.push(token === "*" ? left * right : left / right);
    } else {
      firstPass.push(/^[+\-]$/.test(token) ? token : Number(token));
    }
  }
  let result = Number(firstPass[0]);
  for (let index = 1; index < firstPass.length; index += 2) {
    const operator = firstPass[index];
    const right = Number(firstPass[index + 1]);
    result = operator === "+" ? result + right : result - right;
  }
  return Number.isFinite(result) ? result : undefined;
}

export function sanitizeJsonString(raw: string): string {
  let value = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  value = stripCommentsOutsideStrings(value);
  value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  value = removeTrailingCommas(value);
  value = value.replaceAll(/[“”‘’]/g, "'").replaceAll("：", ":").replaceAll("，", ",");
  value = value.replace(/:\s*(\d+(?:\s*[+\-*/]\s*\d+)+(?:\s*=\s*\d+(?:\.\d+)?)?)/g, (full, expression: string) => {
    const result = evaluateArithmetic(expression);
    return result === undefined ? full : `: ${result}`;
  });
  return value;
}

export function fixUnescapedQuotes(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      output += char;
      escaped = true;
      continue;
    }
    if (char !== '"') {
      output += char;
      continue;
    }
    if (!inString) {
      inString = true;
      output += char;
      continue;
    }
    const rest = input.slice(index + 1).trimStart();
    if (!rest || /^[,}\]:]/.test(rest)) {
      inString = false;
      output += char;
    } else {
      output += "'";
    }
  }
  return output;
}

export function repairTruncatedJson(input: string): string {
  let value = input.trimEnd();
  if (!value) return value;
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
  }
  if (inString) value = `${value.replace(/\\+$/, "")}"`;
  value = value.replace(/,\s*$/, "");

  const stack: string[] = [];
  inString = false;
  escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" && stack.at(-1) === "{") stack.pop();
    else if (char === "]" && stack.at(-1) === "[") stack.pop();
  }
  return value + stack.reverse().map((char) => char === "[" ? "]" : "}").join("");
}

function extractObject(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i.exec(raw);
  const source = fenced?.[1] ?? raw;
  const start = source.indexOf("{");
  if (start < 0) throw new Error("响应中未找到JSON数据");
  const end = source.lastIndexOf("}");
  return source.slice(start, end > start ? end + 1 : undefined);
}

function guidedRepair(input: string): string {
  let value = input;
  value = value.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":');
  value = value.replace(/:\s*'([^']*)'/g, (_full, content: string) => `: "${content.replaceAll('"', '\\"')}"`);
  value = value.replace(/(["}\]\d])\s+(?=[\p{L}_][\p{L}\p{N}_-]*\s*:)/gu, "$1,");
  value = value.replace(/([{,]\s*)([\p{L}_][\p{L}\p{N}_-]*)\s*:/gu, '$1"$2":');
  value = value.replace(/(["}\]\d])\s+(?="[^"\n]+"\s*:)/g, "$1,");
  return removeTrailingCommas(value);
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const extracted = sanitizeJsonString(extractObject(raw));
  const candidates = [
    extracted,
    fixUnescapedQuotes(extracted),
    repairTruncatedJson(extracted),
    guidedRepair(extracted),
    repairTruncatedJson(guidedRepair(extracted)),
  ];
  let lastError: unknown;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`行程 JSON 解析失败: ${lastError instanceof Error ? lastError.message : "未知错误"}`);
}
