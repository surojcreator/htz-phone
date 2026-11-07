import { HtzClient } from '../src/core/api';

(async () => {
  const email = process.env.HTZ_EMAIL || '', password = process.env.HTZ_PASS || '';
  const c = new HtzClient(email, password);
  await c.webLogin();
  console.log('logged in', email);
  for (const proj of ['44', '156']) {
    const after = 'after_page=wallet_attraction_item-com&after_id=166122';
    const page = await c.webGet(`/wallet_login/${proj}?${after}`);
    console.log(`\n== proj ${proj}: gate ${page.length}B`);
    const j = await c.webAjax('special_service', 'wallet_login_quick', {
      project_id: proj, signin_type: '3',
      after_page: 'wallet_attraction_item-com', after_id: '166122',
    }, `/wallet_login/${proj}`);
    console.log('quick:', JSON.stringify(j).slice(0, 320));
  }
})();
