/*
 * Code runner (module Web Worker). Runs off the main thread so a runaway loop can simply be terminated.
 *   Luau   -> luau-web (real Luau, WebAssembly, vendored in /vendor)
 *   Python -> Pyodide (real CPython, WebAssembly, loaded from jsDelivr on first use)
 *   C#     -> ./csharp.js (small built-in interpreter for a practical subset)
 *
 * In:  { id, lang, code }
 * Out: { id, type: 'status' | 'start' | 'out' | 'error' | 'done', text? }
 */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let luau, pyodide, cs;

const post = m => self.postMessage(m);

/* Luau values arrive as JS values; print them the way Luau would */
const luaStr = v => {
  if (v === undefined || v === null) return 'nil';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(14));
  if (typeof v === 'object') return 'table';
  if (typeof v === 'function') return 'function';
  return String(v);
};
const cleanLua = m => String(m).replace(/\[string "main"\]/g, 'main');
const cleanPy = m => {
  const lines = String(m).split('\n');
  const i = lines.findIndex(l => l.includes('File "<exec>"'));
  return i >= 0 ? 'Traceback (most recent call last):\n' + lines.slice(i).join('\n').trim() : String(m).trim();
};

async function runLuau(id, code) {
  if (!luau) { post({ id, type: 'status', text: 'loading Luau…' }); luau = await import('../vendor/luau-web/index.js'); }
  const line = (...a) => post({ id, type: 'out', text: a.map(luaStr).join('\t') });
  const state = await luau.LuauState.createAsync({ print: line, warn: line });
  const fn = state.loadstring(code, 'main');
  if (typeof fn === 'string') { post({ id, type: 'error', text: cleanLua(fn) }); return; }
  post({ id, type: 'start' });
  try { const r = fn(); if (r && typeof r.then === 'function') await r; }
  catch (e) { post({ id, type: 'error', text: cleanLua(e.message || e) }); }
  // no state.destroy(): in luau-web 1.4 it breaks every state created afterwards
}

async function runPython(id, code) {
  if (!pyodide) {
    post({ id, type: 'status', text: 'loading Python (first run downloads ~10 MB)…' });
    const { loadPyodide } = await import(PYODIDE + 'pyodide.mjs');
    pyodide = await loadPyodide({ indexURL: PYODIDE });
  }
  const emit = s => post({ id, type: 'out', text: s });
  pyodide.setStdout({ batched: emit });
  pyodide.setStderr({ batched: emit });
  post({ id, type: 'start' });
  const globals = pyodide.globals.get('dict')();          // fresh namespace per run
  try { await pyodide.runPythonAsync(code, { globals }); }
  catch (e) { post({ id, type: 'error', text: cleanPy(e.message || e) }); }
  finally { globals.destroy(); }
}

async function runCs(id, code) {
  cs ??= await import('./csharp.js');
  post({ id, type: 'start' });
  const r = cs.runCSharp(code, text => post({ id, type: 'out', text }));
  if (!r.ok) post({ id, type: 'error', text: r.error });
}

self.onmessage = async ({ data: { id, lang, code } }) => {
  try {
    if (lang === 'luau') await runLuau(id, code);
    else if (lang === 'python') await runPython(id, code);
    else if (lang === 'csharp') await runCs(id, code);
  } catch (e) {
    post({ id, type: 'error', text: 'Runner error: ' + (e && e.message || e) });
  }
  post({ id, type: 'done' });
};
