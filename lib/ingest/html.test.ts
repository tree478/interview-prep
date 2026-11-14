import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from './html';

describe('htmlToText', () => {
  it('turns escaped Greenhouse HTML into clean text', () => {
    const escaped =
      '&lt;p&gt;We&amp;#39;re hiring &lt;strong&gt;interns&lt;/strong&gt;.&lt;/p&gt;&lt;p&gt;Build things&amp;nbsp;with us&lt;/p&gt;';
    const text = htmlToText(decodeEntities(escaped));
    expect(text).toBe("We're hiring interns.\nBuild things with us");
  });

  it('puts list items on their own lines as bullets', () => {
    const html = '<h3>Requirements</h3><ul><li>Python</li><li>SQL &amp; data</li></ul><p>Apply now</p>';
    expect(htmlToText(html)).toBe('Requirements\n- Python\n- SQL & data\nApply now');
  });

  it('collapses blank lines and spaces, handles br, and caps length', () => {
    expect(htmlToText('<p>a   b</p><p></p><p></p><p></p><p>c<br>d</p>')).toBe('a b\n\nc\nd');
    expect(htmlToText('x'.repeat(30_000)).length).toBe(20_000);
    expect(htmlToText(null)).toBe('');
  });
});
