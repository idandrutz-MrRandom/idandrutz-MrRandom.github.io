(() => {
  const $ = id => document.getElementById(id);
  const ed = $('pgEditor'), hl = $('pgHl'), out = $('pgOut'), status = $('pgStatus'), note = $('pgNote');
  const runBtn = $('pgRun'), stopBtn = $('pgStop'), resetBtn = $('pgReset');
  const tabs = [...document.querySelectorAll('#pgTabs button')];
  if (!ed) return;

  /* ---------------- samples ---------------- */
  const SAMPLES = {
    luau: `--!strict
-- Luau: the language behind Roblox

local function fib(n: number): number
	if n < 2 then return n end
	return fib(n - 1) + fib(n - 2)
end

for i = 0, 10 do
	print(\`fib({i}) = {fib(i)}\`)
end

local player = { name = "Idan", level = 42 }
print(player.name, "is level", player.level)
`,
    python: `# Python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

print([fib(i) for i in range(11)])

stack = ["Luau", "Python", "C#"]
for i, lang in enumerate(stack, 1):
    print(f"{i}. {lang}")
`,
    csharp: `using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static int Factorial(int n) => n <= 1 ? 1 : n * Factorial(n - 1);

    static void Main()
    {
        Console.WriteLine("Hello from C#!");

        var scores = new List<int> { 72, 91, 65, 88 };
        Console.WriteLine($"Average: {scores.Average():F1}");
        Console.WriteLine($"Best: {scores.Max()}");

        for (int i = 1; i <= 5; i++)
            Console.WriteLine($"{i}! = {Factorial(i)}");
    }
}
`,
  };
  const NOTES = {
    luau: 'Real Luau, running in your browser.',
    python: 'Real Python (Pyodide). The first run downloads the runtime, later runs are instant.',
    csharp: 'C# runs on a small built-in interpreter: everyday code works (classes, collections, LINQ), but not the whole language.',
  };
  const LIMIT = { luau: 6000, csharp: 6000, python: 15000 };          // ms of actual execution
  const codes = { ...SAMPLES };
  let lang = 'luau';

  /* ---------------- syntax highlighting (overlay behind the textarea) ---------------- */
  const KW = {
    luau: 'and break do else elseif end false for function if in local nil not or repeat return then true until while continue type export',
    python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
    csharp: 'abstract as async await bool break byte case catch char class const continue decimal default do double else enum false finally float for foreach if in int interface internal is long namespace new null object out override private protected public readonly ref return sealed short static string struct switch this throw true try using var virtual void while',
  };
  const COMMENT = { luau: '--[^\\n]*', python: '#[^\\n]*', csharp: '//[^\\n]*|/\\*[\\s\\S]*?\\*/' };
  const STRING = {
    luau: '"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`',
    python: '"""[\\s\\S]*?"""|f?"(?:[^"\\\\\\n]|\\\\.)*"|f?\'(?:[^\'\\\\\\n]|\\\\.)*\'',
    csharp: '[$@]{0,2}"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'',
  };
  const RX = {};
  for (const l of Object.keys(KW)) {
    RX[l] = new RegExp(`(?<c>${COMMENT[l]})|(?<s>${STRING[l]})|(?<n>\\b\\d[\\d_.]*\\b)|(?<k>\\b(?:${KW[l].split(' ').join('|')})\\b)|(?<f>\\b[A-Za-z_]\\w*(?=\\())`, 'g');
  }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const highlight = (code, l) => {
    let html = '', last = 0;
    for (const m of code.matchAll(RX[l])) {
      html += esc(code.slice(last, m.index));
      const g = m.groups; const cls = g.c ? 'c' : g.s ? 's' : g.n ? 'n' : g.k ? 'k' : 'f';
      html += `<span class="tk-${cls}">${esc(m[0])}</span>`; last = m.index + m[0].length;
    }
    return html + esc(code.slice(last)) + '\n';
  };
  const paint = () => { hl.firstChild.innerHTML = highlight(ed.value, lang); hl.scrollTop = ed.scrollTop; hl.scrollLeft = ed.scrollLeft; };
  ed.addEventListener('input', () => { codes[lang] = ed.value; paint(); });
  ed.addEventListener('scroll', () => { hl.scrollTop = ed.scrollTop; hl.scrollLeft = ed.scrollLeft; });

  /* Tab inserts spaces; Enter keeps indentation; Ctrl/Cmd+Enter runs */
  ed.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); return; }
    const { selectionStart: a, selectionEnd: b, value: v } = ed;
    const edit = (text, caret) => {
      ed.setRangeText(text, a, b, 'end'); if (caret !== undefined) ed.selectionStart = ed.selectionEnd = caret;
      ed.dispatchEvent(new Event('input'));
    };
    if (e.key === 'Tab') { e.preventDefault(); edit('    '); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const line = v.slice(v.lastIndexOf('\n', a - 1) + 1, a);
      const indent = /^[ \t]*/.exec(line)[0];
      const more = /(\{|:|\bthen|\bdo)$/.test(line.trimEnd()) ? '    ' : '';
      edit('\n' + indent + more);
    }
  });

  /* ---------------- console ---------------- */
  let lines = 0;
  const addLine = (text, cls = '') => {
    if (lines > 800) return false;
    const d = document.createElement('div'); d.className = 'pg-line ' + cls; d.textContent = text || ' ';
    out.appendChild(d); out.scrollTop = out.scrollHeight; lines++;
    return true;
  };
  const clearOut = () => { out.textContent = ''; lines = 0; };
  const setStatus = (t, cls = '') => { status.textContent = t; status.className = 'play__status ' + cls; };

  /* ---------------- worker lifecycle ---------------- */
  let worker = null, runId = 0, running = false, timer = 0, t0 = 0;
  const makeWorker = () => {
    const w = new Worker('js/runner.worker.js', { type: 'module' });
    w.onmessage = ({ data: m }) => {
      if (m.id !== runId) return;
      switch (m.type) {
        case 'status': setStatus(m.text, 'is-busy'); break;
        case 'start': t0 = performance.now(); setStatus('running…', 'is-busy'); timer = setTimeout(() => stop(`Stopped: it ran for more than ${LIMIT[lang] / 1000}s (infinite loop?)`), LIMIT[lang]); break;
        case 'out': if (!addLine(m.text)) stop('Stopped: too much output'); break;
        case 'error': addLine(m.text, 'is-err'); break;
        case 'done': finish(); break;
      }
    };
    w.onerror = e => {
      addLine('Could not start the code runner. Open the page over http(s) (for example your GitHub Pages URL); browsers block workers on file://.', 'is-err');
      if (e && e.message) addLine(e.message, 'is-err');
      worker = null; finish(true);
    };
    return w;
  };
  const setRunning = on => { running = on; runBtn.disabled = on; stopBtn.hidden = !on; };
  const finish = failed => {
    clearTimeout(timer);
    if (!running) return;
    setRunning(false);
    setStatus(failed ? 'failed' : `done in ${Math.max(1, Math.round(performance.now() - t0))} ms`, failed ? 'is-err' : 'is-ok');
  };
  function stop(reason) {
    if (!running) return;
    clearTimeout(timer);
    if (worker) { worker.terminate(); worker = null; }
    addLine(reason || 'Stopped.', 'is-err');
    setRunning(false); setStatus('stopped', 'is-err');
  }
  function run() {
    if (running) return;
    clearOut(); runId++; t0 = performance.now();
    setRunning(true); setStatus('starting…', 'is-busy');
    try { worker ??= makeWorker(); } catch (e) { addLine('Could not start the code runner: ' + e.message, 'is-err'); finish(true); return; }
    worker.postMessage({ id: runId, lang, code: ed.value });
  }
  runBtn.addEventListener('click', run);
  stopBtn.addEventListener('click', () => stop('Stopped.'));

  /* ---------------- tabs / reset ---------------- */
  function setLang(l) {
    if (running) stop('Stopped.');
    lang = l; ed.value = codes[l];
    tabs.forEach(t => { const on = t.dataset.lang === l; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
    note.textContent = NOTES[l]; clearOut(); setStatus('ready'); paint();
  }
  tabs.forEach(t => t.addEventListener('click', () => setLang(t.dataset.lang)));
  resetBtn.addEventListener('click', () => { codes[lang] = SAMPLES[lang]; ed.value = SAMPLES[lang]; paint(); clearOut(); setStatus('ready'); });

  hl.innerHTML = '<code></code>';
  setLang('luau');
})();
