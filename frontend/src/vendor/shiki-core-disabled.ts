interface ShikiTokenLike {
  htmlStyle?: Record<string, string | number>;
}

export function getTokenStyleObject(token: ShikiTokenLike): Record<string, string | number> {
  return token.htmlStyle ?? {};
}
