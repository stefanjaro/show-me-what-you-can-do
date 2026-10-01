'use strict';
/* CONTINUUM CA-7 - browser interaction tests.
 *
 * Drives the real page in headless Chromium: drags cords, turns knobs,
 * builds blocks, shares a link and reloads it. Skips itself cleanly when
 * playwright-core is not installed.
 *
 *   node test/ui.js [baseUrl]
 */
var cp = require('child_process');
var path = require('path');
var http = require('http');

var root = path.join(__dirname, '..');
var PORT = 8791;

function fail(msg) { console.log('  FAIL  ' + msg); failures++; }
function ok(cond, msg) { if (cond) pass++; else fail(msg); }
var pass = 0, failures = 0;

function reachable(url) {
  return new Promise(function (res) {
    var req = http.get(url, function (r) { r.resume(); res(r.statusCode === 200); });
    req.on('error', function () { res(false); });
    req.setTimeout(1500, function () { req.destroy(); res(false); });
  });
}

function main() {
  var chromium;
  try { chromium = require('playwright-core'); }
  catch (e) {
    console.log('  skip: playwright-core is not installed (npm i playwright-core)');
    return Promise.resolve(0);
  }
  var exe = process.env.PLAYWRIGHT_CHROMIUM ||
    (process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/' +
      'chrome-headless-shell-linux64/chrome-headless-shell');

  var server = null;
  var base = process.argv[2];
  var owned = false;

  return Promise.resolve()
    .then(function () {
      if (base) return true;
      return reachable('http://127.0.0.1:' + PORT + '/index.html').then(function (up) {
        if (up) { base = 'http://127.0.0.1:' + PORT; return true; }
        server = cp.spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
          { cwd: root, stdio: 'ignore' });
        owned = true;
        return new Promise(function (res) { setTimeout(res, 900); });
      });
    })
    .then(function () {
      base = base || ('http://127.0.0.1:' + PORT);
      return chromium.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    })
    .then(function (b) { return b; })
    .catch(function (e) {
      console.log('  skip: ' + e.message.split('\n')[0]);
      return null;
    })
    .then(function (browser) {
      if (!browser) return 0;
      return run(browser, base).then(function () { return browser.close(); });
    })
    .then(function () {
      if (owned && server) { try { server.kill(); } catch (e) { /* */ } }
      return failures;
    });
}

function run(browser, base) {
  var errors = [];
  return browser.newPage({ viewport: { width: 1400, height: 1000 } })
    .then(function (p) {
      var page = p;
      page.on('pageerror', function (e) { errors.push(e.message); });
      page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
      return page.goto(base + '/index.html', { waitUntil: 'load' })
        .then(function () {
          return page.$('#coachGo');
        })
        .then(function (go) { if (go) return go.click(); })
        .then(function () { return page.waitForTimeout(700); })

        /* --- the machine is running --------------------------------- */
        .then(function () {
          return page.evaluate(function () { return CA7App.sim.t; });
        })
        .then(function (t0) {
          return page.waitForTimeout(600).then(function () {
            return page.evaluate(function () { return CA7App.sim.t; });
          }).then(function (t1) {
            ok(t1 > t0 + 0.4, 'solver advances in real time (' + t0.toFixed(2) + ' -> ' + t1.toFixed(2) + ')');
          });
        })

        /* --- drag a cord -------------------------------------------- */
        .then(function () {
          return page.evaluate(function () {
            var outs = document.querySelectorAll('#mods .jack--out');
            var ins = document.querySelectorAll('#mods .jack--in');
            var free = null;
            for (var i = 0; i < ins.length; i++) {
              var key = ins[i].dataset.jack;
              var wired = CA7App.circuit.wires.some(function (w) { return w[1] === key; });
              if (!wired) { free = ins[i]; break; }
            }
            if (!outs.length || !free) return null;
            function c(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
            return { from: c(outs[0]), to: c(free), before: CA7App.circuit.wires.length, fromKey: outs[0].dataset.jack, toKey: free.dataset.jack };
          });
        })
        .then(function (d) {
          if (!d) { fail('found no free jack to patch'); return; }
          return page.mouse.move(d.from.x, d.from.y)
            .then(function () { return page.mouse.down(); })
            .then(function () { return page.mouse.move(d.to.x, d.to.y, { steps: 12 }); })
            .then(function () { return page.mouse.up(); })
            .then(function () { return page.waitForTimeout(250); })
            .then(function () {
              var after = null;
              return page.evaluate(function () { return CA7App.circuit.wires.length; }).then(function (n) { after = n; return n; })
                .then(function () {
                  ok(after === d.before + 1, 'dragging a cord plugs an input (' + d.before + ' -> ' + after + ')');
                });
            })
            /* --- and pull it out again ------------------------------ */
            .then(function () {
              return page.evaluate(function (key) {
                var el = document.querySelector('[data-jack="' + key + '"]');
                var r = el.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }, d.toKey);
            })
            .then(function (pt) {
              return page.mouse.move(pt.x, pt.y)
                .then(function () { return page.mouse.down(); })
                .then(function () { return page.mouse.move(pt.x + 160, pt.y + 120, { steps: 10 }); })
                .then(function () { return page.mouse.up(); })
                .then(function () { return page.waitForTimeout(250); })
                .then(function () {
                  return page.evaluate(function () { return CA7App.circuit.wires.length; });
                })
                .then(function (n) {
                  ok(n === d.before, 'pulling a cord out unplugs it (' + n + ' cords left)');
                });
            });
        })

        /* --- turn a knob -------------------------------------------- */
        .then(function () {
          return page.evaluate(function () {
            var k = document.querySelector('[data-knob]');
            var r = k.getBoundingClientRect();
            return { key: k.dataset.knob, x: r.left + r.width / 2, y: r.top + r.height / 2, u: parseFloat(k.dataset.u) };
          });
        })
        .then(function (k) {
          if (!k) { fail('no knob on the panel'); return; }
          return page.mouse.move(k.x, k.y)
            .then(function () { return page.mouse.down(); })
            .then(function () { return page.mouse.move(k.x, k.y - 60, { steps: 8 }); })
            .then(function () { return page.mouse.up(); })
            .then(function () {
              return page.evaluate(function (key) {
                var el = document.querySelector('[data-knob="' + key + '"]');
                return { u: parseFloat(el.dataset.u), k: key };
              }, k.key);
            })
            .then(function (after) {
              ok(Math.abs(after.u - k.u) > 0.05, 'knob drag changes the setting (' +
                k.u.toFixed(2) + ' -> ' + after.u.toFixed(2) + ')');
            });
        })

        /* --- build and delete a block ------------------------------- */
        .then(function () {
          return page.evaluate(function () {
            return { before: CA7App.circuit.modules.filter(function (m) { return !CA7.TYPES[m.t].rack; }).length };
          });
        })
        .then(function (s) {
          return page.click('[data-add="mult"]')
            .then(function () { return page.waitForTimeout(200); })
            .then(function () {
              return page.evaluate(function () {
                return CA7App.circuit.modules.filter(function (m) { return !CA7.TYPES[m.t].rack; }).length;
              });
            })
            .then(function (n) {
              ok(n === s.before + 1, 'toolbox drops a new block (' + s.before + ' -> ' + n + ')');
              return page.click('.mod--mult .mod__del');
            })
            .then(function () { return page.waitForTimeout(200); })
            .then(function () {
              return page.evaluate(function () {
                return CA7App.circuit.modules.filter(function (m) { return !CA7.TYPES[m.t].rack; }).length;
              });
            })
            .then(function (n) {
              ok(n === s.before, 'the block deletes itself and its cords (' + n + ' left)');
            });
        })

        /* --- transport ---------------------------------------------- */
        .then(function () {
          return page.click('#btnRun')
            .then(function () { return page.waitForTimeout(150); })
            .then(function () { return page.evaluate(function () { return CA7App.running; }); })
            .then(function (r) { ok(r === false, 'HOLD stops the solver'); })
            .then(function () { return page.click('#btnRun'); })
            .then(function () { return page.waitForTimeout(200); })
            .then(function () { return page.evaluate(function () { return CA7App.running; }); })
            .then(function (r) { ok(r === true, 'RUN starts it again'); });
        })
        .then(function () {
          return page.click('#btnReset')
            .then(function () { return page.waitForTimeout(150); })
            .then(function () { return page.evaluate(function () { return CA7App.sim.t; }); })
            .then(function (t) { ok(t < 0.4, 'IC RESET rewinds the clock (' + t.toFixed(3) + ' s)'); });
        })

        /* --- speed knob ----------------------------------------------- */
        .then(function () {
          return page.evaluate(function () {
            var k = document.getElementById('speedKnob');
            var r = k.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: CA7App.sim.speed };
          });
        })
        .then(function (k) {
          return page.mouse.move(k.x, k.y)
            .then(function () { return page.mouse.down(); })
            .then(function () { return page.mouse.move(k.x, k.y - 110, { steps: 8 }); })
            .then(function () { return page.mouse.up(); })
            .then(function () { return page.waitForTimeout(200); })
            .then(function () {
              return page.evaluate(function () { return CA7App.sim.speed; });
            })
            .then(function (s2) {
              ok(s2 > k.s + 0.2, 'the speed knob changes the simulation rate (' +
                k.s.toFixed(2) + ' -> ' + s2.toFixed(2) + ')');
            });
        })

        /* --- share link --------------------------------------------- */
        .then(function () {
          return page.evaluate(function () {
            CA7App.circuit.modules[0].k.ic = 3.25;
            return CA7.encode(CA7App.circuit);
          })
            .then(function (enc) {
              return page.evaluate(function (e) { location.hash = e; return location.hash; }, enc)
                .then(function () { return page.reload({ waitUntil: 'load' }); })
                .then(function () { return page.waitForTimeout(600); })
                .then(function () {
                  return page.evaluate(function () {
                    return { ic: CA7App.circuit.modules[0].k.ic, n: CA7App.circuit.modules.length };
                  });
                })
                .then(function (restored) {
                  ok(restored.ic === 3.25, 'a shared link rebuilds the machine (' + restored.ic + ')');
                  ok(restored.n >= 4, 'all blocks come back (' + restored.n + ')');
                });
            });
        })

        /* --- presets ------------------------------------------------- */
        .then(function () {
          return page.evaluate(function () {
            var c = document.querySelector('[data-preset="lorenz"]');
            if (c) c.click();
            return !!c;
          }).then(function (found) {
            ok(found, 'preset chips are clickable');
            return page.waitForTimeout(400);
          }).then(function () {
            return page.evaluate(function () { return CA7App.presetId; });
          }).then(function (id) {
            ok(id === 'lorenz', 'switching presets loads the new circuit (' + id + ')');
          });
        })

        /* --- keyboard ------------------------------------------------ */
        .then(function () {
          return page.evaluate(function () { document.activeElement.blur(); });
        })
        .then(function () { return page.keyboard.press('Space'); })
        .then(function () { return page.waitForTimeout(120); })
        .then(function () { return page.evaluate(function () { return CA7App.running; }); })
        .then(function (r) { ok(r === false, 'space bar holds the machine'); })
        .then(function () { return page.keyboard.press('Space'); })

        /* --- narrow viewport ----------------------------------------- */
        .then(function () {
          return page.setViewportSize({ width: 390, height: 800 });
        })
        .then(function () { return page.waitForTimeout(400); })
        .then(function () {
          return page.evaluate(function () {
            return {
              docW: document.documentElement.scrollWidth,
              winW: window.innerWidth,
              scale: CA7.Rig.scale
            };
          });
        })
        .then(function (v) {
          ok(v.docW <= v.winW + 2, 'no page-level sideways scroll on a phone (' + v.docW + ' vs ' + v.winW + ')');
          ok(v.scale > 0.3, 'the instrument scales down rather than breaking (' + v.scale.toFixed(2) + ')');
        })

        /* --- no runtime errors --------------------------------------- */
        .then(function () {
          ok(errors.length === 0, 'no console errors (' + errors.slice(0, 2).join(' | ') + ')');
        });
    });
}

main().then(function (failed) {
  console.log('\n' + pass + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
});
