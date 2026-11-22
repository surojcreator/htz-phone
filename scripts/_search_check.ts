import { HtzClient } from '../src/core/api';
import { searchCatalog } from '../src/core/catalog';

(async () => {
  const c = new HtzClient('', '');
  const data = await c.appSearch({ q: 'iphone', isPage: 1 });
  console.log('raw res', Array.isArray(data?.res) ? data.res.length : 'none', 'limit', data?.limit);
  const items = await searchCatalog(c, 'iphone');
  console.log('searchCatalog', items.length);
  const data2 = await c.appSearch({ q: 'iphone' });
  console.log('no isPage', Array.isArray(data2?.res) ? data2.res.length : 'none');
})();
