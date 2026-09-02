import { Marked } from 'marked'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

const chatMarkdown = new Marked(
  { async: false, breaks: true, gfm: true },
  {
    renderer: {
      html(token) {
        return escapeHtml(token.text)
      },
    },
  },
)

export function renderChatMarkdown(value: string): string {
  const rendered = chatMarkdown.parse(value)
  return typeof rendered === 'string' ? rendered : ''
}
