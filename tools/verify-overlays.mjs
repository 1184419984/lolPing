import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { build } from 'esbuild';

// This test app has no input hooks, room connections or access to the user's settings.
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let server;
  let win;
  try {
    const script = await build({ stdin: { contents: `
      import { ModuleStage } from './src/renderer/overlay/moduleFx';
      import { HydrationStage } from './src/renderer/overlay/hydrationFx';
      const layer = document.getElementById('features');
      const modules = new ModuleStage(layer);
      const legacy = new HydrationStage(document.getElementById('hydration'));
      globalThis.render = (mode) => {
        modules.clear(); legacy.clear();
        if (mode === 'fallback') legacy.show('记得喝水', 30);
        else modules.show({module:'hydration',generation:'a'.repeat(40),lang:'zh-CN',
          assets:{'builtin:hydration':'../textures/drink_water_akali.png'},scene:{key:'water',display:'all',
          durationS:30,width:0.8,x:0.5,y:0.5,dim:true,animation:'fullscreen',elements:[
            {type:'image',asset:'builtin:hydration',height:0.7},
            {type:'text',text:{en:'Time for some water','zh-CN':'记得喝水'},size:32,color:'#ffffff'}]}});
        return new Promise((resolve,reject) => {
          const img = document.querySelector('img');
          const done = async () => {
            try { await img.decode(); } catch (error) { reject(error); return; }
            const caption = document.querySelector('.featureText,.hydrationCaption');
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              naturalWidth:img.naturalWidth, naturalHeight:img.naturalHeight,
              image:img.getBoundingClientRect().toJSON(), caption:caption.getBoundingClientRect().toJSON(),
              width:innerWidth,height:innerHeight,pointer:getComputedStyle(layer).pointerEvents,
              fit:getComputedStyle(img).objectFit,
            })));
          };
          if (img.complete && img.naturalWidth) done();
          else { img.onload=done; img.onerror=()=>reject(Error('Reminder image failed to load')); }
        });
      };
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'iife', write: false });
    const css = await readFile('src/renderer/overlay/overlay.css');
    const image = await readFile('assets/textures/drink_water_akali.png');
    const html = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/overlay.css"><div id="features"></div><div id="hydration"></div><script src="/render.js"></script>';
    const resources = new Map([
      ['/overlay/index.html', ['text/html;charset=utf-8', html]],
      ['/overlay.css', ['text/css', css]], ['/render.js', ['text/javascript', script.outputFiles[0].contents]],
      ['/textures/drink_water_akali.png', ['image/png', image]],
    ]);
    server = createServer((req, res) => {
      const entry = resources.get(new URL(req.url, 'http://localhost').pathname);
      if (!entry) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': entry[0] }).end(entry[1]);
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    await mkdir('out/verification', { recursive: true });
    const results = [];
    for (const [width, height] of [[1920,1080],[1280,720],[375,667],[320,240]]) {
      win = new BrowserWindow({ width, height, useContentSize: true, show: false,
        webPreferences: { offscreen: true, backgroundThrottling: false } });
      await win.loadURL(`http://127.0.0.1:${server.address().port}/overlay/index.html`);
      for (const mode of ['module', 'fallback']) {
        const state = await win.webContents.executeJavaScript(`render(${JSON.stringify(mode)})`);
        assert.ok(Math.abs(state.width - width) <= 2 && Math.abs(state.height - height) <= 2);
        assert.equal(state.image.width, state.width); assert.equal(state.image.height, state.height);
        assert.equal(state.image.x, 0); assert.equal(state.image.y, 0);
        assert.ok(state.naturalWidth > 0 && state.naturalHeight > 0);
        assert.equal(state.fit, 'cover'); assert.equal(state.pointer, 'none');
        assert.ok(state.caption.x >= 0 && state.caption.right <= state.width && state.caption.bottom <= state.height);
        let capture;
        let ink = 0;
        const deadline = performance.now() + 5000;
        // A decoded image may not be in the offscreen compositor's first captured frame.
        do {
          await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(resolve))');
          capture = await win.webContents.capturePage();
          const bitmap = capture.toBitmap();
          ink = 0;
          for (let i = 0; i < bitmap.length; i += 4) {
            const spread = Math.max(bitmap[i], bitmap[i+1], bitmap[i+2]) - Math.min(bitmap[i], bitmap[i+1], bitmap[i+2]);
            if (bitmap[i+3] > 0 && spread > 40) ink++;
          }
        } while (ink <= width * height * 0.03 && performance.now() < deadline);
        assert.ok(ink > width * height * 0.03, 'Reminder art must be painted, not just a gray background and caption');
        const file = `out/verification/hydration-${mode}-${width}x${height}.png`;
        await writeFile(file, capture.toPNG());
        results.push({ mode, width, height, ink, file, state });
      }
      win.destroy(); win = null;
    }
    await writeFile('out/verification/hydration-results.json', JSON.stringify(results, null, 2));
    console.log(`Verified ${results.length} full-viewport renders. ${resolve('out/verification')}`);
    server.close(); app.exit(0);
  } catch (error) {
    console.error(error); win?.destroy(); server?.close(); app.exit(1);
  }
});
