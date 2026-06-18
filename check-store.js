const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors']});
  const page = await browser.newPage();
  await page.setViewport({width:1200,height:900});
  const captured = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('IMG_8908') && response.status() === 200) {
      try {
        const buf = await response.buffer();
        if (buf.length > 10000) {
          require('fs').writeFileSync('/home/user/prospectpro-server/public/pig-captured.jpg', buf);
          console.log('Saved! Size:', buf.length);
        }
      } catch(e) {}
    }
  });
  try {
    const resp = await page.goto('https://fes1w5-yj.myshopify.com/products/trotty', {waitUntil:'networkidle0', timeout:40000});
    console.log('Status:', resp.status());
    const title = await page.title();
    console.log('Title:', title);
    await page.waitForTimeout(3000);
  } catch(e) {
    console.log('Error:', e.message);
  }
  await browser.close();
})();
