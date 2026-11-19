import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = 'https://www.valtorres.com';
const id = 'G-41Y73RQ4Q8';
const marker = 'syntheticqa157';
const browser = await chromium.launch({channel:'chrome', headless:false});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const gaCookie = c => /^_(ga($|_)|gid$|gat($|_))/.test(c.name);
async function run(lang, mode) {
  const context = await browser.newContext({locale:lang});
  try {
    const both = ['dnt','gpc','private'].includes(mode);
    if (both || mode === 'first') {
      const names = both ? ['vt_analytics','vt_ga4_consent'] : ['vt_analytics'];
      await context.addCookies(names.map(name => ({name,value:'granted',url:origin})));
    }
    if (mode === 'dnt' || mode === 'gpc') {
      await context.addInitScript(signal => {
        Object.defineProperty(navigator,signal === 'dnt' ? 'doNotTrack' : 'globalPrivacyControl',
          {get:() => signal === 'dnt' ? '1' : true});
      },mode);
      await context.setExtraHTTPHeaders(mode === 'dnt' ? {DNT:'1'} : {'Sec-GPC':'1'});
    }
    const page = await context.newPage();
    const hits = [];
    const violations = [];
    context.on('request', r => {
      const u = new URL(r.url());
      if (!/(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)$/.test(u.hostname) && !/\/(?:g\/collect|j\/collect|gtag\/js)$/.test(u.pathname)) return;
      const body = r.postData() || '';
      const raw = [u.href,body,r.headers().referer || ''].join(' ');
      if (raw.toLowerCase().includes(marker) || raw.includes('G-CBL2BKYYE7')) violations.push('sensitive marker or corporate ID');
      for (const line of body.split('\n')) {
        const params = new URLSearchParams(u.search);
        for (const [k,v] of new URLSearchParams(line)) params.set(k,v);
        const event = params.get('en');
        const location = params.get('dl');
        if (params.get('tid') && params.get('tid') !== id) violations.push('wrong stream');
        if (event && (!location || ![origin+'/'+lang,origin+'/'+lang+'/privacy',origin+'/'+lang+'/listings/detail',origin+'/'+lang+'/contact'].includes(location))) violations.push('unexpected location');
        hits.push({event,id:params.get('tid'),location});
      }
    });
    async function visit(path) {
      await page.goto(origin+'/'+lang+path,{waitUntil:'domcontentloaded',timeout:45000});
      await page.locator('body').waitFor();
      await pause(2800);
    }
    async function quiet() {
      assert.equal(hits.length,0,'Google request while measurement forbidden');
      assert.equal((await context.cookies()).filter(gaCookie).length,0,'measurement cookie while forbidden');
    }
    if (mode === 'private') {
      for (const path of ['/sign-in','/account','/admin','/reply/'+marker]) {await visit(path); await quiet();}
    } else {
      await visit('?q='+marker+'&email='+marker+'%40example.test&token='+marker);
      await quiet();
      const dialog=page.getByRole('dialog').filter({has:page.locator('input[type=checkbox]')});
      if (mode==='reject') {
        await dialog.getByRole('button',{name:/reject|rechazar/i}).click();
        await visit('/privacy'); await quiet();
      }
      if (mode==='yes') {
        await dialog.getByRole('checkbox').check();
        await dialog.getByRole('button',{name:/accept|aceptar/i}).click();
        for(let i=0;i<12 && !hits.some(h=>h.event==='page_view');i++) await pause(1000);
        assert.deepEqual(violations,[]);
        const view=hits.find(h=>h.event==='page_view' && h.id===id && h.location===origin+'/'+lang);
        assert.ok(view,'no sanitized page_view from real tag');
        console.log(JSON.stringify({lang,mode,view}));
        await visit('/contact?q='+marker);
        for (const field of await page.locator('main input[type=text],main input[type=email],main input[type=tel],main textarea').all()) {
          if (await field.isVisible() && await field.isEditable()) await field.fill(marker);
        }
        await pause(2000);
        await page.getByRole('button',{name:/privacy preferences|preferencias de privacidad/i}).click();
        await dialog.getByRole('checkbox').uncheck();
        await dialog.getByRole('button',{name:/accept|aceptar/i}).click();
        await pause(800);
        assert.deepEqual(violations,[]);
        hits.length=0;
        await visit('/privacy'); await quiet();
        assert.ok((await context.cookies()).some(c=>c.name==='vt_analytics' && c.value==='granted'));
      }
    }
    assert.deepEqual(violations,[]);
    console.log(JSON.stringify({lang,mode,pass:true}));
  } finally {await context.close();}
}
try {
  for(const lang of ['en','es']) for(const mode of ['fresh','first','reject','dnt','gpc','private','yes']) await run(lang,mode);
} finally {await browser.close();}
