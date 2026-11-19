import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const origin='https://www.valtorres.com', id='G-41Y73RQ4Q8', marker='syntheticqa157';
const files=[
  ['3sxddnd4goy-4.js','2q369a6zmp28m.js','4721fcb1a34196fb2512dcdecfd2c62ca1d9008e1a19e4453d9f617f097c4c60'],
  ['0ueil6g62aluf.js','0_uxl5jxfunj2.js','55ef6aecf15a7d99a00735cc2c7ee13576ce6537d173e6f2c0301debe16e6064']
];
const assets=new Map();
for(const [,file,hash] of files){
  const reply=await fetch(origin+'/_next/static/immutable/chunks/'+file,{redirect:'error'});
  assert.equal(reply.status,200);
  const bytes=Buffer.from(await reply.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  assets.set(file,bytes);
}
const tagResponse=await fetch('https://www.googletagmanager.com/gtag/js?id='+id,{redirect:'error'});
assert.equal(tagResponse.status,200);
const tag=Buffer.from(await tagResponse.arrayBuffer());
const browser=await chromium.launch({channel:'chrome',headless:false});
try {
 for(const lang of ['en','es']){
  const context=await browser.newContext({locale:lang,serviceWorkers:'block'});
  const page=await context.newPage();
  let scriptRequests=0, swapped=0, frameLoads=0, integrityViolation=false;
  const events=[];
  await context.route('**/*', async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin===origin && req.method()==='GET'){
      if(u.pathname==='/ga4-context.html') frameLoads++;
      const asset=assets.get(u.pathname.split('/').pop());
      if(asset){swapped++;return route.fulfill({contentType:'application/javascript',body:asset});}
      if(u.pathname==='/'+lang && req.isNavigationRequest() && !req.frame().parentFrame()){
        const res=await route.fetch({url:origin+'/'+lang,maxRedirects:0});
        assert.equal(res.status(),200);
        let html=await res.text();
        for(const [off,on] of files){assert.ok(html.includes(off));html=html.replaceAll(off,on);}
        return route.fulfill({response:res,body:html});
      }
      if(u.pathname.startsWith('/api/'))return route.abort();
      return route.continue();
    }
    if(u.hostname==='www.googletagmanager.com' && u.pathname==='/gtag/js' && u.searchParams.get('id')===id){
      scriptRequests++;return route.fulfill({contentType:'application/javascript',body:tag});
    }
    if(u.pathname.endsWith('/collect')){
      for(const line of (req.postData()||'').split('\n')){
        const p=new URLSearchParams(u.search);for(const [k,v] of new URLSearchParams(line))p.set(k,v);
        const raw=[u.href,line,req.headers().referer||''].join(' ');
        if(raw.includes(marker)||raw.includes('G-CBL2BKYYE7'))integrityViolation=true;
        if(p.get('en'))events.push({pageView:p.get('en')==='page_view',target:p.get('tid')===id,safe:p.get('dl')===origin+'/'+lang});
      }
      return route.fulfill({status:204,headers:{'access-control-allow-origin':'*'}});
    }
    return route.abort();
  });
  await page.goto(origin+'/'+lang+'?q='+marker,{waitUntil:'domcontentloaded'});
  const dialog=page.getByRole('dialog').filter({has:page.locator('input[type=checkbox]')});
  await dialog.getByRole('checkbox').check();
  assert.equal(scriptRequests,0); assert.equal(events.length,0);
  await dialog.getByRole('button',{name:/accept|aceptar/i}).click();
  for(let i=0;i<15&&!events.some(e=>e.pageView&&e.target&&e.safe);i++)await page.waitForTimeout(1000);
  const cookies=await context.cookies(origin), grant=n=>cookies.some(c=>c.name===n&&c.value==='granted');
  const frame=page.frames().find(f=>f.parentFrame()&&[origin+'/'+lang,origin+'/ga4-context.html'].includes(f.url()));
  const queued=frame?await frame.evaluate(()=>({
    configured:typeof window.gtag==='function',
    pageViewQueued:Array.from(window.dataLayer||[]).some(c=>c?.[0]==='event'&&c[1]==='page_view'),
    ownArguments:Array.from(window.dataLayer||[]).filter(c=>c?.[0]==='event'&&c[1]==='page_view').every(c=>Object.getPrototypeOf(c)===Object.prototype)
  })):null;
  console.log(JSON.stringify({lang,swapped,firstPartyGranted:grant('vt_analytics'),googleGranted:grant('vt_ga4_consent'),frameLoads,sanitizedFrame:frame?.url()===origin+'/'+lang,scriptRequests,queued,events,integrityViolation}));
  assert.equal(swapped,2);assert.equal(integrityViolation,false);
  await context.close();
 }
} finally {await browser.close();}
