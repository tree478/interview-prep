import * as cheerio from 'cheerio';

export const MAX_DESCRIPTION_CHARS = 20_000;

const BLOCK_SELECTOR = 'p, div, section, article, h1, h2, h3, h4, h5, h6, li, tr, table, blockquote';

/** Decode HTML entities once (e.g. Greenhouse's `&lt;p&gt;` becomes `<p>`). Tags are not interpreted. */
export function decodeEntities(s: string): string {
  return cheerio.load(`<body>${s}</body>`, null, false).root().text();
}

/**
 * HTML to plain text. Paragraph/heading/list boundaries become newlines, list items get a "- "
 * prefix, runs of spaces and blank lines are collapsed, and the result is trimmed and capped.
 */
export function htmlToText(html: string | null | undefined, maxChars = MAX_DESCRIPTION_CHARS): string {
  if (!html) return '';
  const $ = cheerio.load(html, null, false);
  $('script, style').remove();
  $('br').replaceWith('\n');
  $('li').each((_, el) => {
    $(el).prepend('- ');
  });
  $(BLOCK_SELECTOR).each((_, el) => {
    $(el).append('\n');
  });
  const text = $.root()
    .text()
    .replace(/\u0000/g, '')
    .replace(/[\u00a0\u200b]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars).trimEnd() : text;
}
