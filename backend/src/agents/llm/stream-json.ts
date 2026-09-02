const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export function streamExtractStringField(
  buffer: string,
  field: string,
): { value: string; closed: boolean } {
  if (!buffer || !field) return { value: "", closed: false };
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${escaped}"\\s*:\\s*"`).exec(buffer);
  if (!match) return { value: "", closed: false };

  let index = match.index + match[0].length;
  let value = "";
  while (index < buffer.length) {
    const char = buffer[index]!;
    if (char === '"') return { value, closed: true };
    if (char !== "\\") {
      value += char;
      index += 1;
      continue;
    }
    if (index + 1 >= buffer.length) return { value, closed: false };
    const escape = buffer[index + 1]!;
    if (escape === "u") {
      if (index + 6 > buffer.length) return { value, closed: false };
      const hex = buffer.slice(index + 2, index + 6);
      if (/^[a-f\d]{4}$/i.test(hex)) value += String.fromCharCode(Number.parseInt(hex, 16));
      else value += buffer.slice(index, index + 6);
      index += 6;
      continue;
    }
    value += ESCAPES[escape] ?? escape;
    index += 2;
  }
  return { value, closed: false };
}
