import { HtzClient } from '../src/core/api';
import { parseProductPage } from '../src/core/wallet';

(async () => {
  const c = new HtzClient('', '');
  const html = await c.webGet('/webview/102507');
  const flat = html.replace(/\\"/g, '"');
  const key = '"collectedOptions":';
  let at = flat.indexOf(key);
  let n = 0;
  while (at >= 0 && n < 6) {
    console.log('occurrence', n, 'at', at, 'next', JSON.stringify(flat.slice(at + key.length, at + key.length + 40)));
    at = flat.indexOf(key, at + key.length);
    n++;
  }
  const p = parseProductPage({ kind: 'regular', id: 102507 }, html);
  console.log('variants', p.variants);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
