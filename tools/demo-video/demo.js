// Snima demo ReStart aplikacije: CDP screencast -> JPEG frameovi -> MP4 (ffmpeg)
const { chromium } = require('playwright');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const OUT = process.argv[2];
const W = 1600, H = 900;
const FR = path.join(__dirname, 'frames'); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5180', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // overlay: kursor, titlovi, naslovne kartice
  await page.addStyleTag({ content: `
    #rc-cursor{position:fixed;z-index:99999;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transition:transform .12s}
    #rc-cursor.down{transform:scale(.8)}
    #rc-ripple{position:fixed;z-index:99998;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid #ff5a36;pointer-events:none;opacity:0}
    #rc-ripple.go{animation:rc 0.5s ease-out}
    @keyframes rc{from{opacity:.9;transform:scale(.3)}to{opacity:0;transform:scale(1.6)}}
    #rc-cap{position:fixed;z-index:99997;left:50%;bottom:34px;transform:translateX(-50%) translateY(20px);opacity:0;transition:.4s;
      background:rgba(21,35,63,.94);color:#fff;font:600 21px 'Plus Jakarta Sans',sans-serif;padding:14px 26px;border-radius:16px;
      box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:1100px;text-align:center;line-height:1.35}
    #rc-cap.on{opacity:1;transform:translateX(-50%)}
    #rc-cap small{display:block;font-weight:500;font-size:15px;opacity:.7;margin-top:3px}
    #rc-card{position:fixed;inset:0;z-index:99996;background:#15233f;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'Plus Jakarta Sans',sans-serif;opacity:0;transition:opacity .6s;pointer-events:none;text-align:center}
    #rc-card.on{opacity:1}
    #rc-card h1{font-size:84px;margin:0;letter-spacing:-2px;font-weight:800}
    #rc-card h1 span{color:#ff5a36}
    #rc-card p{font-size:28px;opacity:.8;margin:18px 0 0;max-width:1000px;line-height:1.4}
    #rc-card .s{font-size:17px;opacity:.5;margin-top:40px}
  `});
  await page.evaluate(() => {
    const c = document.createElement('div'); c.id = 'rc-cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#15233f" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(c);
    const r = document.createElement('div'); r.id = 'rc-ripple'; document.body.append(r);
    const cap = document.createElement('div'); cap.id = 'rc-cap'; document.body.append(cap);
    const card = document.createElement('div'); card.id = 'rc-card'; document.body.append(card);
    c.style.left = '800px'; c.style.top = '450px';
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', e => { c.classList.add('down'); r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); }, true);
    document.addEventListener('mouseup', () => c.classList.remove('down'), true);
  });

  // screencast
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(FR, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  const wait = (ms) => page.waitForTimeout(ms);
  let mx = 800, my = 450;
  const moveTo = async (x, y, ms = 700) => { const steps = Math.max(8, Math.round(ms / 16)); await page.mouse.move(x, y, { steps }); mx = x; my = y; };
  const center = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const click = async (loc, ms = 700) => { const [x, y] = await center(loc); await moveTo(x, y, ms); await wait(150); await page.mouse.down(); await wait(80); await page.mouse.up(); await wait(250); };
  const cap = async (txt, sub = '') => page.evaluate(([t, s]) => { const c = document.getElementById('rc-cap'); c.classList.remove('on'); setTimeout(() => { c.innerHTML = t + (s ? `<small>${s}</small>` : ''); c.classList.add('on'); }, t ? 250 : 0); }, [txt, sub]);
  const card = async (html) => page.evaluate((h) => { const c = document.getElementById('rc-card'); if (h) { c.innerHTML = h; c.classList.add('on'); } else c.classList.remove('on'); }, html);
  // pomicanje range klizača na vrijednost
  const drag = async (sel, from, to, ms = 1400) => {
    const loc = page.locator(sel); await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox(); const min = +(await loc.getAttribute('min')), max = +(await loc.getAttribute('max'));
    const px = (v) => b.x + 10 + (v - min) / (max - min) * (b.width - 20);
    const y = b.y + b.height / 2;
    await moveTo(px(from), y, 600); await wait(150); await page.mouse.down();
    await page.mouse.move(px(to), y, { steps: Math.round(ms / 16) }); await page.mouse.up(); await wait(300);
  };
  const scrollPanel = (y) => page.evaluate((y) => document.getElementById('panel').scrollTo({ top: y, behavior: 'smooth' }), y);

  // ---------- SCENARIJ ----------
  await card(`<h1>Re<span>Start</span></h1><p>Od praznog gradskog lokala do novog posla</p><div class="s">Prototip · podaci: Grad Zagreb, ZET, DZS</div>`);
  await wait(3200);
  await card(''); await wait(700);

  await cap('Na karti je 186 prostora iz službenog registra praznih prostora Grada Zagreba', 'Datum podataka je uvijek vidljiv — evidentiran kao prazan ≠ dostupan danas');
  await moveTo(1450, 30, 1200); await wait(2600);

  await cap('Korak 1: „Želim otvoriti servis elektronike."', 'Odaberite djelatnost — postavke se prilagode');
  await click(page.locator('[data-biz="kafic"]')); await wait(900);
  await click(page.locator('[data-biz="servis"]')); await wait(1200);

  await cap('Potrebna površina: 40 – 80 m²', 'Prostori izvan raspona odmah se isključuju i postaju sivi');
  await drag('#area-max', 80, 140, 1300); await wait(500);
  await drag('#area-max', 140, 80, 1300); await wait(1000);

  await cap('Što vam je najvažnije?', 'Prioriteti mijenjaju poredak — bez skrivenog „AI rezultata"');
  await click(page.locator('[data-prio="street"][data-v="2"]')); await wait(900);
  await click(page.locator('[data-prio="density"][data-v="0"]')); await wait(1300);

  await cap('Rangirani kandidati, s razlozima', 'Udaljenost do ZET stajališta izračunata iz 2.148 stvarnih stajališta');
  await scrollPanel(560); await wait(1200);
  const items = page.locator('.item');
  for (let i = 0; i < 3; i++) { const [x, y] = await center(items.nth(i)); await moveTo(x - 60, y, 500); await wait(500); }

  await cap('Za svaki prostor: što znamo, iz kojeg izvora i što treba provjeriti');
  await click(items.nth(0).locator('.addr')); await wait(2600);
  await click(page.locator('.leaflet-popup [data-toggle]')); await wait(1300);
  await page.mouse.move(1000, 750, { steps: 20 }); await click(page.locator('.leaflet-popup-close-button'), 500); await wait(400);

  await cap('Odaberite do 3 kandidata za usporedbu');
  await click(items.nth(1).locator('.add-btn')); await wait(700);
  await click(items.nth(3).locator('.add-btn')); await wait(1000);
  await click(page.locator('#tray .btn')); await wait(2200);

  await cap('Korak 2: usporedba s objašnjenjem', '„Ovaj prostor bliži je javnom prijevozu…" — i što još nije potvrđeno');
  await wait(2500);
  await scrollPanel(380); await wait(2200);
  await scrollPanel(800); await wait(2200);

  await click(page.locator('[data-go="3"]').first()); await wait(1800);
  await cap('Korak 3: koliko posla treba da pokrijete troškove?', 'Nije prognoza koliko ćete kupaca imati — nego koliko vam ih treba');
  await wait(3000);

  await cap('Pomaknite zakupninu — broj se mijenja pred vama', 'Sve financijske brojke su vaše pretpostavke, jasno označene');
  await drag('[data-calc=rent]', 12, 20, 1600); await wait(1400);
  await drag('[data-calc=fitM2]', 150, 350, 1400); await wait(1400);

  await cap('Prijelomna točka: kada drugi prostor postaje povoljniji?');
  await scrollPanel(560); await wait(3200);
  await scrollPanel(820); await wait(2600);

  await cap('Usporedite svakog kandidata jednim klikom');
  await scrollPanel(0); await wait(800);
  await click(page.locator('[data-active="1"]')); await wait(1600);
  await click(page.locator('[data-active="2"]')); await wait(1600);
  await click(page.locator('[data-active="0"]')); await wait(1200);

  await cap('');
  await card(`<h1>Re<span>Start</span></h1><p>Prostor → lokacijski uvjeti → financijski scenarij.<br>Provjerljivi javni podaci i transparentna računica.</p><div class="s">Grad Zagreb · Prazni poslovni prostori 2024. · ZET stajališta · DZS Popis 2021.</div>`);
  await wait(3800);

  await cdp.send('Page.stopScreencast');
  await browser.close();

  // ffmpeg concat s trajanjima
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const d = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 0.5;
    lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);
  const list = path.join(__dirname, 'list.txt'); fs.writeFileSync(list, lines.join('\n'));
  execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=1600:900:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  console.log('frames', frames.length, '→', OUT);
})().catch(e => { console.error(e); process.exit(1); });
