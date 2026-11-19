import { chromium } from "playwright";

const origin = "https://www.valtorres.com";
const flags = ["vt_analytics", "vt_ga4_consent"];
const browser = await chromium.launch({ headless: false });
let failed = false;
try {
  for (const locale of ["en", "es"]) {
    for (const grants of [0, 1, 2]) {
      const context = await browser.newContext({ locale });
      await context.addCookies(flags.slice(0, grants).map(name => ({name, value: "granted", url: origin})));
      let hits = 0;
      context.on("request", request => {
        const url = new URL(request.url());
        if (/(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)$/.test(url.hostname) ||
            /\/(?:g\/collect|j\/collect|gtag\/js)(?:\/|$)/.test(url.pathname)) hits++;
      });
      const page = await context.newPage();
      for (const path of ["/" + locale, "/" + locale + "/privacy"]) {
        const response = await page.goto(origin + path, {waitUntil: "load", timeout: 45000});
        await page.locator("h1").first().waitFor({timeout: 15000});
        await page.waitForTimeout(3000);
        const cookies = (await context.cookies()).filter(c => /^(_ga($|_)|_gid$|_gat($|_))/.test(c.name)).length;
        const loaded = response?.ok() && page.url().replace(/\/$/, "") === origin + path &&
          await page.locator("html").getAttribute("lang") === locale;
        const disclosure = !path.endsWith("/privacy") || /Google Analytics 4/i.test(await page.locator("main").innerText());
        const pass = loaded && disclosure && !cookies && !hits;
        console.log(JSON.stringify({path, grants, loaded, disclosure, measurementRequests: hits, measurementCookies: cookies, pass}));
        if (!pass) failed = true;
      }
      await context.close();
    }
  }
} catch {
  console.error("Browser baseline incomplete.");
  failed = true;
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
