import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ 
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('PAGE ERROR:', msg.text(), msg.location().url);
    }
  });

  page.on('pageerror', err => {
    console.log('PAGE EXCEPTION:', err.toString());
  });

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 8000 });
    console.log('Page loaded successfully');
  } catch(e) {
    console.log('Navigation error:', e.message);
  }

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
