import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const origin='https://www.valtorres.com', id='G-41Y73RQ4Q8', marker='syntheticqa157';
const files=[
  ["0jz2a2rta438h.js","29pam56dkvtfv.js","31abc99f099bbf90d5879075efb743dd908734f65213057f31ca82f07c87bb8b"],
  ["22vvcz0uj1-dx.js","40wr7yjbib-r4.js","9a77c513b404b0ae70982b667b30ffc5f711113665fa9f98da965e86b390401e"],
  ["10b_sey0ko1uh.js","1myidv9ykpfxg.js","c587436e88c3de007291903bd830e54df309dc1168c5d33363f58a596c6e6805"],
  ["3p7s3th7er0z2.js","0pu1u872ae19q.js","d6a7c52d9fe633e409d3c116b9eed7f3ffd447cd9cb08b86101bdeef4933ee40"],
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

export async function installArchivedReplay(context) {
  await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.origin===origin && req.method()==='GET'){
      const basename=u.pathname.split('/').pop();
      const match=files.find(([off,on])=>off===basename||on===basename);
      const bytes=match ? assets.get(match[1]) : undefined;
      if(bytes)return route.fulfill({contentType:'application/javascript',body:bytes});
      if(req.isNavigationRequest() && /^\/(en|es)(?:\/|$)/.test(u.pathname)){
        const res=await route.fetch({url:origin+u.pathname,maxRedirects:0});
        if(res.status()>=300 && res.status()<400){
          console.log(JSON.stringify({navigationRedirect:res.status(),listing:u.pathname.includes('/listings')}));
          return route.fulfill({response:res});
        }
        const headers={...res.headers(),'referrer-policy':'strict-origin'};
        let html=await res.text();
        const matched=files.filter(([off])=>html.includes(off)).length;
        console.log(JSON.stringify({replayDocument:true,homepage:/^\/(en|es)$/.test(u.pathname),status:res.status(),matchedChunks:matched}));
        for(const [off,on] of files)html=html.replaceAll(off,on);
        return route.fulfill({response:res,headers,body:html});
      }
      return route.continue();
    }
    if(u.hostname==='www.googletagmanager.com' && u.pathname==='/gtag/js' && u.searchParams.get('id')===id)
      return route.fulfill({contentType:'application/javascript',body:tag});
    if(u.pathname.endsWith('/collect'))return route.fulfill({status:204,headers:{'access-control-allow-origin':'*'}});
    return route.abort();
  });
}
