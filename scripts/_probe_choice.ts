import { HtzClient } from '../src/core/api';
import { readFeed } from '../src/core/catalog';
import { readProductWebview } from '../src/core/wallet';

(async () => {
  const c = new HtzClient('', '');
  const sections = await readFeed(c, 0);
  const ids = [...new Set(sections.flatMap((s) => s.items.map((i) => i.id)))].slice(0, 30);
  console.log('sample', ids.length);

  for (const id of ids) {
    let html = '';
    try {
      html = await c.webGet(`/webview/${id}`);
    } catch {
      continue;
    }
    const hasChoice = /"choiceGroups":\[/.test(html);
    const hasAddon = /"addonGroups":\[/.test(html);
    const hasColor = /"colors":\[/.test(html);
    let variants = 0;
    try {
      variants = (await readProductWebview(c, String(id))).variants.length;
    } catch {}
    if (hasChoice || hasAddon || hasColor) {
      console.log('\nITEM', id, 'variants', variants, 'choice', hasChoice, 'addon', hasAddon, 'colors', hasColor);
      for (const key of ['"choiceGroups":', '"addonGroups":', '"colors":']) {
        const i = html.indexOf(key);
        if (i >= 0) console.log(key, html.slice(i, i + 700).replace(/\s+/g, ' '));
      }
    } else if (variants === 0) {
      console.log('\nITEM', id, 'variants 0 · no feature groups');
      const i = html.indexOf('"priceOptions"');
      if (i >= 0) console.log('  priceOptions', html.slice(i, i + 200).replace(/\s+/g, ' '));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
