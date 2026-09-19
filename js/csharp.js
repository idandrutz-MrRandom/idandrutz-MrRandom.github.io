/*
 * Mini C# interpreter (a practical subset, not the full language).
 *
 * Supported: top-level statements or a Main method, classes (fields, properties, constructors,
 * methods, static members), int/long/double/float/decimal/bool/char/string, arrays, List<T>,
 * Dictionary<K,V>, StringBuilder, Random, lambdas + common LINQ, if/while/do/for/foreach/switch,
 * try/catch/finally/throw, string interpolation and format specifiers, Console, Math, Convert.
 * Not supported: inheritance, interfaces, generics you define yourself, async, records, tuples, out/ref.
 *
 * runCSharp(source, write) -> { ok: boolean, error?: string }
 */

/* ------------------------------ values ------------------------------ */
class D { constructor(v) { this.v = v; } }                 // double / float / decimal
class Ch { constructor(c) { this.c = c; } }                // char
class List { constructor(a = []) { this.a = a; } }
class Dict { constructor() { this.m = new Map(); } }
class SB { constructor() { this.s = ''; } }
class Rnd { constructor() { } }
class Obj { constructor(cls) { this.cls = cls; this.f = new Map(); } }
class Closure { constructor(params, body, env) { this.params = params; this.body = body; this.env = env; } }
class Method { constructor(name, params, body, ret, cls, isStatic) { Object.assign(this, { name, params, body, ret, cls, isStatic }); } }

class CsError extends Error { constructor(msg) { super(msg); this.cs = true; } }
class Throw extends Error { constructor(ex) { super('thrown'); this.ex = ex; } }

const PRIM = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'decimal', 'bool', 'char', 'string', 'object', 'var', 'void', 'uint', 'ulong']);
const DBL = new Set(['double', 'float', 'decimal']);
const MODS = new Set(['public', 'private', 'protected', 'internal', 'static', 'readonly', 'const', 'override', 'virtual', 'abstract', 'sealed', 'partial', 'async', 'unsafe', 'extern']);

/* ------------------------------ lexer ------------------------------ */
const OPS = ['<<=', '>>=', '??=', '...', '++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '??', '=>', '::', '->'];
function lex(src) {
  const t = []; let i = 0, line = 1;
  const push = (k, v, extra) => t.push({ k, v, line, ...extra });
  const esc = c => ({ n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'" }[c] ?? c);
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const chunk = src.slice(i, e < 0 ? src.length : e + 2); line += (chunk.match(/\n/g) || []).length; i += chunk.length; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < src.length && /[\w]/.test(src[j])) j++; push('id', src.slice(i, j)); i = j; continue; }
    if (/\d/.test(c)) {
      const m = /^(0[xX][0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)([fFdDmMlLuU]*)/.exec(src.slice(i));
      const body = m[1].replace(/_/g, ''), suf = m[4].toLowerCase();
      const isD = /[.eE]/.test(body) && !/^0[xX]/.test(body) || /[fdm]/.test(suf);
      push('num', Number(body), { dbl: isD }); i += m[0].length; continue;
    }
    if (c === '"' || ((c === '$' || c === '@') && (src[i + 1] === '"' || (src[i + 1] === '$' || src[i + 1] === '@') && src[i + 2] === '"'))) {
      let interp = false, verb = false;
      while (src[i] !== '"') { if (src[i] === '$') interp = true; if (src[i] === '@') verb = true; i++; }
      i++;
      const parts = []; let cur = '';
      while (i < src.length) {
        const d = src[i];
        if (d === '"') { if (verb && src[i + 1] === '"') { cur += '"'; i += 2; continue; } break; }
        if (d === '\n') line++;
        if (!verb && d === '\\') { cur += esc(src[i + 1]); i += 2; continue; }
        if (interp && d === '{') {
          if (src[i + 1] === '{') { cur += '{'; i += 2; continue; }
          let depth = 0, j = i + 1, expr = '', align = null, fmt = null;
          while (j < src.length) {
            const e = src[j];
            if (e === '(' || e === '[' || e === '{') depth++;
            if (e === ')' || e === ']') depth--;
            if (e === '}') { if (depth === 0) break; depth--; }
            if (depth === 0 && e === ':' && fmt === null) { fmt = ''; j++; continue; }
            if (depth === 0 && e === ',' && fmt === null && align === null) { align = ''; j++; continue; }
            if (fmt !== null) fmt += e; else if (align !== null) align += e; else expr += e;
            j++;
          }
          if (cur) parts.push(cur); cur = '';
          parts.push({ expr, align: align === null ? null : parseInt(align, 10), fmt }); i = j + 1; continue;
        }
        if (interp && d === '}' && src[i + 1] === '}') { cur += '}'; i += 2; continue; }
        cur += d; i++;
      }
      i++;
      if (cur || !parts.length) parts.push(cur);
      if (interp) push('interp', parts); else push('str', parts.join(''));
      continue;
    }
    if (c === "'") {
      let ch = src[i + 1]; let n = 3;
      if (ch === '\\') { ch = src[i + 2] === 'u' ? String.fromCharCode(parseInt(src.slice(i + 3, i + 7), 16)) : esc(src[i + 2]); n = src[i + 2] === 'u' ? 7 : 4; }
      push('chr', ch); i += n; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { push('op', op); i += op.length; continue; }
    push('op', c); i++;
  }
  push('eof', '');
  return t;
}

/* ------------------------------ parser ------------------------------ */
class Parser {
  constructor(tokens) { this.t = tokens; this.p = 0; }
  peek(n = 0) { return this.t[Math.min(this.p + n, this.t.length - 1)]; }
  next() { return this.t[this.p++]; }
  isOp(v, n = 0) { const k = this.peek(n); return k.k === 'op' && k.v === v; }
  isId(v, n = 0) { const k = this.peek(n); return k.k === 'id' && k.v === v; }
  eatOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }
  eatId(v) { if (this.isId(v)) { this.p++; return true; } return false; }
  err(msg) { const k = this.peek(); throw new CsError(`(${k.line}) error: ${msg}${k.k === 'eof' ? ' (unexpected end of code)' : ` near '${k.v}'`}`); }
  expectOp(v) { if (!this.eatOp(v)) this.err(`expected '${v}'`); }
  ident() { const k = this.peek(); if (k.k !== 'id') this.err('expected a name'); this.p++; return k.v; }

  /* ---- types ---- */
  tryType() {
    const s = this.p;
    if (this.peek().k !== 'id') return null;
    let name = this.next().v;
    while (this.isOp('.') && this.peek(1).k === 'id') { this.p++; name += '.' + this.next().v; }
    let args = null;
    if (this.isOp('<')) {
      this.p++; args = [];
      for (;;) { const a = this.tryType(); if (!a) { this.p = s; return null; } args.push(a); if (this.eatOp(',')) continue; break; }
      if (!this.eatOp('>')) { this.p = s; return null; }
    }
    let rank = 0;
    while (this.isOp('[') && (this.isOp(']', 1) || this.isOp(',', 1))) { this.p++; while (this.eatOp(',')); this.expectOp(']'); rank++; }
    if (this.isOp('?') && this.peek(1).k === 'id' && (this.isOp('=', 2) || this.isOp(';', 2))) this.p++;
    return { name: name.split('.').pop(), args, rank };
  }

  /* ---- program ---- */
  parseProgram() {
    const prog = { classes: [], stmts: [] };
    this.parseMembers(prog, true);
    return prog;
  }
  parseMembers(prog, top) {
    while (this.peek().k !== 'eof' && !(this.isOp('}') && !top)) {
      if (this.isId('using') && this.peek(1).k === 'id' && !this.isOp('(', 1)) { while (!this.eatOp(';')) this.next(); continue; }
      if (this.isId('namespace')) {
        this.next(); while (!this.isOp('{') && !this.isOp(';')) this.next();
        if (this.eatOp(';')) continue;
        this.expectOp('{'); this.parseMembers(prog, false); this.expectOp('}'); continue;
      }
      const s = this.p; while (this.peek().k === 'id' && MODS.has(this.peek().v)) this.p++;
      if (this.isId('class') || this.isId('struct')) { this.p++; prog.classes.push(this.parseClass()); continue; }
      if (this.isId('interface') || this.isId('enum') || this.isId('record') || this.isId('delegate')) this.err(`'${this.peek().v}' is not supported in this mini C#`);
      this.p = s;
      prog.stmts.push(this.statement());
    }
  }
  parseClass() {
    const name = this.ident();
    if (this.isOp('<')) this.err('generic classes are not supported in this mini C#');
    if (this.eatOp(':')) this.err('inheritance/interfaces are not supported in this mini C#');
    const cls = { name, fields: [], methods: [], ctors: [] };
    this.expectOp('{');
    while (!this.isOp('}')) {
      let isStatic = false;
      while (this.peek().k === 'id' && MODS.has(this.peek().v)) { if (this.next().v === 'static') isStatic = true; }
      if (this.isId(name) && this.isOp('(', 1)) { this.p++; const params = this.params(); cls.ctors.push({ params, body: this.methodBody() }); continue; }
      const type = this.tryType(); if (!type) this.err('expected a member declaration');
      const mname = this.ident();
      if (this.isOp('(')) {
        const params = this.params();
        cls.methods.push(new Method(mname, params, this.methodBody(), type, cls, isStatic));
      } else if (this.isOp('{') || this.isOp('=>')) {           // property
        let getter = null, init = null;
        if (this.eatOp('=>')) { getter = this.expr(); this.expectOp(';'); }
        else {
          this.expectOp('{');
          while (!this.eatOp('}')) {
            if (this.isId('get') && this.isOp('=>', 1)) { this.p += 2; getter = this.expr(); this.expectOp(';'); }
            else this.next();
          }
          if (this.eatOp('=')) { init = this.expr(); this.expectOp(';'); }
        }
        cls.fields.push({ name: mname, type, init, isStatic, getter });
      } else {
        for (let n = mname; ; ) {
          let init = null; if (this.eatOp('=')) init = this.initializer(type);
          cls.fields.push({ name: n, type, init, isStatic });
          if (this.eatOp(',')) { n = this.ident(); continue; } break;
        }
        this.expectOp(';');
      }
    }
    this.expectOp('}');
    return cls;
  }
  params() {
    const ps = []; this.expectOp('(');
    while (!this.isOp(')')) {
      while (this.isId('ref') || this.isId('out') || this.isId('params') || this.isId('in')) this.err("'ref', 'out' and 'params' are not supported in this mini C#");
      const type = this.tryType(); if (!type) this.err('expected a parameter type');
      const name = this.ident(); let def = null;
      if (this.eatOp('=')) def = this.expr();
      ps.push({ type, name, def });
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')'); return ps;
  }
  methodBody() {
    if (this.eatOp('=>')) { const e = this.expr(); this.expectOp(';'); return { k: 'block', body: [{ k: 'return', e }] }; }
    return this.block();
  }

  /* ---- statements ---- */
  block() { this.expectOp('{'); const body = []; while (!this.isOp('}')) { if (this.peek().k === 'eof') this.err("expected '}'"); body.push(this.statement()); } this.p++; return { k: 'block', body }; }
  isDeclStart() {
    const s = this.p; const type = this.tryType();
    let ok = false;
    if (type && this.peek().k === 'id' && !MODS.has(this.peek().v)) ok = this.isOp('=', 1) || this.isOp(';', 1) || this.isOp(',', 1);
    this.p = s; return ok ? type : null;
  }
  declIsFunc() { // Type name ( ... ) { or =>   => a local function
    let d = 0, i = 1; for (;; i++) { const k = this.peek(i); if (k.k === 'eof') return false; if (k.k === 'op' && k.v === '(') d++; if (k.k === 'op' && k.v === ')') { d--; if (d === 0) break; } }
    return this.isOp('{', i + 1) || this.isOp('=>', i + 1);
  }
  initializer(type) {
    if (this.isOp('{')) { this.p++; const items = []; while (!this.isOp('}')) { items.push(this.expr()); if (!this.eatOp(',')) break; } this.expectOp('}'); return { k: 'arrlit', items, type }; }
    return this.expr();
  }
  statement() {
    const k = this.peek();
    if (k.k === 'op') {
      if (k.v === '{') return this.block();
      if (k.v === ';') { this.p++; return { k: 'block', body: [] }; }
    }
    if (k.k === 'id') {
      while (MODS.has(this.peek().v) && this.peek(1).k === 'id') this.p++;
      switch (this.peek().v) {
        case 'if': { this.p++; this.expectOp('('); const c = this.expr(); this.expectOp(')'); const a = this.statement(); const b = this.eatId('else') ? this.statement() : null; return { k: 'if', c, a, b }; }
        case 'while': { this.p++; this.expectOp('('); const c = this.expr(); this.expectOp(')'); return { k: 'while', c, body: this.statement() }; }
        case 'do': { this.p++; const body = this.statement(); if (!this.eatId('while')) this.err("expected 'while'"); this.expectOp('('); const c = this.expr(); this.expectOp(')'); this.expectOp(';'); return { k: 'do', c, body }; }
        case 'for': {
          this.p++; this.expectOp('('); let init = null;
          if (!this.isOp(';')) { const ty = this.isDeclStart(); init = ty ? this.declaration(ty) : { k: 'expr', e: this.expr() }; }
          this.expectOp(';'); const c = this.isOp(';') ? null : this.expr(); this.expectOp(';');
          const step = []; while (!this.isOp(')')) { step.push(this.expr()); if (!this.eatOp(',')) break; } this.expectOp(')');
          return { k: 'for', init, c, step, body: this.statement() };
        }
        case 'foreach': {
          this.p++; this.expectOp('('); const type = this.tryType(); const name = this.ident(); if (!this.eatId('in')) this.err("expected 'in'");
          const e = this.expr(); this.expectOp(')'); return { k: 'foreach', type, name, e, body: this.statement() };
        }
        case 'return': { this.p++; const e = this.isOp(';') ? null : this.expr(); this.expectOp(';'); return { k: 'return', e }; }
        case 'break': this.p++; this.expectOp(';'); return { k: 'break' };
        case 'continue': this.p++; this.expectOp(';'); return { k: 'continue' };
        case 'throw': { this.p++; const e = this.expr(); this.expectOp(';'); return { k: 'throw', e }; }
        case 'try': {
          this.p++; const body = this.block(); const catches = []; let fin = null;
          while (this.eatId('catch')) {
            let type = null, name = null;
            if (this.eatOp('(')) { type = this.tryType(); if (this.peek().k === 'id') name = this.ident(); this.expectOp(')'); }
            catches.push({ type, name, body: this.block() });
          }
          if (this.eatId('finally')) fin = this.block();
          return { k: 'try', body, catches, fin };
        }
        case 'switch': return this.switchStmt();
      }
      const ty = this.isDeclStart();
      if (ty) { const d = this.declaration(ty); this.expectOp(';'); return d; }
      // local function
      const s = this.p; const ft = this.tryType();
      if (ft && this.peek().k === 'id' && this.isOp('(', 1) && this.declIsFunc()) { const name = this.ident(); const params = this.params(); return { k: 'func', name, params, body: this.methodBody(), ret: ft }; }
      this.p = s;
    }
    const e = this.expr(); this.expectOp(';'); return { k: 'expr', e };
  }
  declaration(type) {
    this.tryType(); const decls = [];
    for (;;) {
      const name = this.ident(); let init = null;
      if (this.eatOp('=')) init = this.initializer(type);
      decls.push({ name, init });
      if (!this.eatOp(',')) break;
    }
    return { k: 'decl', type, decls };
  }
  switchStmt() {
    this.p++; this.expectOp('('); const e = this.expr(); this.expectOp(')'); this.expectOp('{');
    const cases = [];
    while (!this.isOp('}')) {
      const labels = []; let isDef = false;
      for (;;) {
        if (this.eatId('case')) { labels.push(this.expr()); this.expectOp(':'); }
        else if (this.isId('default') && this.isOp(':', 1)) { this.p += 2; isDef = true; }
        else break;
      }
      const body = []; while (!this.isId('case') && !(this.isId('default') && this.isOp(':', 1)) && !this.isOp('}')) body.push(this.statement());
      cases.push({ labels, isDef, body });
    }
    this.p++; return { k: 'switch', e, cases };
  }

  /* ---- expressions ---- */
  expr() { return this.assignment(); }
  assignment() {
    const left = this.ternary();
    const k = this.peek();
    if (k.k === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '??='].includes(k.v)) {
      this.p++;
      if (!['ident', 'member', 'index'].includes(left.k)) this.err('invalid assignment target');
      return { k: 'assign', op: k.v, target: left, value: this.assignment() };
    }
    return left;
  }
  ternary() {
    const c = this.binary(0);
    if (this.eatOp('?')) { const a = this.assignment(); this.expectOp(':'); const b = this.assignment(); return { k: 'cond', c, a, b }; }
    return c;
  }
  binary(level) {
    const LV = [['??'], ['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    if (level >= LV.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const k = this.peek();
      if (k.k === 'op' && LV[level].includes(k.v)) {
        if (k.v === '&' && this.isOp('&', 1)) break;
        this.p++;
        const right = level === 0 ? this.binary(0) : this.binary(level + 1);
        left = { k: 'bin', op: k.v, l: left, r: right };
      } else if (level === 7 && k.k === 'id' && (k.v === 'is' || k.v === 'as')) {
        this.p++; const type = this.tryType(); left = { k: k.v === 'is' ? 'is' : 'as', e: left, type };
      } else break;
    }
    return left;
  }
  unary() {
    const k = this.peek();
    if (k.k === 'op') {
      if (['!', '-', '+'].includes(k.v)) { this.p++; return { k: 'un', op: k.v, e: this.unary() }; }
      if (k.v === '++' || k.v === '--') { this.p++; return { k: 'incdec', target: this.unary(), d: k.v === '++' ? 1 : -1, prefix: true }; }
      if (k.v === '(') {                                            // cast?
        const s = this.p; this.p++; const ty = this.tryType();
        if (ty && this.eatOp(')') && PRIM.has(ty.name) && ty.name !== 'var' && !ty.rank) {
          const n = this.peek(); if (n.k === 'id' || n.k === 'num' || n.k === 'str' || n.k === 'chr' || n.k === 'interp' || (n.k === 'op' && (n.v === '(' || n.v === '!' || n.v === '-'))) return { k: 'cast', type: ty.name, e: this.unary() };
        }
        this.p = s;
      }
    }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.eatOp('.')) { const name = this.ident(); if (this.isOp('<')) { const s = this.p; if (!this.tryType()) this.p = s; } e = { k: 'member', o: e, name }; }
      else if (this.isOp('?') && this.isOp('.', 1)) { this.p += 2; e = { k: 'member', o: e, name: this.ident(), safe: true }; }
      else if (this.isOp('(')) { e = { k: 'call', f: e, args: this.args() }; }
      else if (this.isOp('[')) { this.p++; const i = this.expr(); this.expectOp(']'); e = { k: 'index', o: e, i }; }
      else if (this.isOp('++') || this.isOp('--')) { const d = this.next().v === '++' ? 1 : -1; e = { k: 'incdec', target: e, d, prefix: false }; }
      else if (this.isOp('!') && !this.isOp('=', 1) && (this.isOp('.', 1) || this.isOp(')', 1) || this.isOp(';', 1))) this.p++;  // null-forgiving
      else break;
    }
    return e;
  }
  args() { this.expectOp('('); const a = []; while (!this.isOp(')')) { if (this.isId('out') || this.isId('ref')) this.err("'out'/'ref' arguments are not supported in this mini C#"); a.push(this.expr()); if (!this.eatOp(',')) break; } this.expectOp(')'); return a; }
  primary() {
    const k = this.next();
    switch (k.k) {
      case 'num': return { k: 'lit', v: k.dbl ? new D(k.v) : k.v };
      case 'str': return { k: 'lit', v: k.v };
      case 'chr': return { k: 'lit', v: new Ch(k.v) };
      case 'interp': return { k: 'interp', parts: k.v.map(p => typeof p === 'string' ? p : { e: new Parser(lex(p.expr)).expr(), align: p.align, fmt: p.fmt }) };
      case 'op':
        if (k.v === '(') {
          // lambda with parenthesised params?
          const s = this.p - 1;
          this.p = s; const lam = this.tryLambda(); if (lam) return lam; this.p = s + 1;
          const e = this.expr(); this.expectOp(')'); return e;
        }
        break;
      case 'id':
        switch (k.v) {
          case 'true': return { k: 'lit', v: true };
          case 'false': return { k: 'lit', v: false };
          case 'null': return { k: 'lit', v: null };
          case 'this': return { k: 'this' };
          case 'new': return this.newExpr();
        }
        if (this.isOp('=>')) { this.p--; return this.tryLambda(); }
        return { k: 'ident', name: k.v, line: k.line };
    }
    this.p--; this.err('unexpected token');
  }
  tryLambda() {
    const s = this.p; const params = [];
    if (this.eatOp('(')) {
      while (!this.isOp(')')) { const a = this.peek(); const b = this.peek(1); if (a.k === 'id' && b.k === 'id') this.p++; if (this.peek().k !== 'id') { this.p = s; return null; } params.push(this.next().v); if (!this.eatOp(',')) break; }
      if (!this.eatOp(')')) { this.p = s; return null; }
    } else if (this.peek().k === 'id') params.push(this.next().v);
    else return null;
    if (!this.eatOp('=>')) { this.p = s; return null; }
    const body = this.isOp('{') ? this.block() : this.assignment();
    return { k: 'lambda', params, body };
  }
  newExpr() {
    if (this.isOp('[') && this.isOp(']', 1)) { this.p += 2; return { ...this.initializer({ name: 'var', rank: 1 }), elem: { name: 'var' } }; }
    const type = this.tryType(); if (!type) this.err('expected a type after new');
    if (this.isOp('[') || type.rank) {                              // arrays
      if (type.rank && this.isOp('{')) return { ...this.initializer({ name: type.name, rank: 1 }), elem: type };
      this.expectOp('['); const size = this.expr(); this.expectOp(']');
      return { k: 'newarr', type, size };
    }
    const args = this.isOp('(') ? this.args() : [];
    let init = null;
    if (this.isOp('{')) {
      this.p++; init = [];
      while (!this.isOp('}')) {
        if (this.eatOp('{')) { const a = [this.expr()]; while (this.eatOp(',')) a.push(this.expr()); this.expectOp('}'); init.push(a); }
        else init.push([this.expr()]);
        if (!this.eatOp(',')) break;
      }
      this.expectOp('}');
    }
    return { k: 'new', type, args, init };
  }
}

/* ------------------------------ runtime helpers ------------------------------ */
const isNum = v => typeof v === 'number' || v instanceof D || v instanceof Ch;
const num = v => v instanceof D ? v.v : v instanceof Ch ? v.c.charCodeAt(0) : v;
const fmtD = x => Number.isNaN(x) ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity' : String(x).replace('e+', 'E+').replace('e-', 'E-');

function fmtSpec(v, spec) {
  const n = num(v); const m = /^([A-Za-z])(\d*)$/.exec(spec);
  if (m) {
    const dg = m[2] === '' ? null : +m[2];
    switch (m[1].toUpperCase()) {
      case 'F': return n.toFixed(dg ?? 2);
      case 'N': return n.toLocaleString('en-US', { minimumFractionDigits: dg ?? 2, maximumFractionDigits: dg ?? 2 });
      case 'D': return String(Math.trunc(n)).padStart(dg ?? 0, '0');
      case 'P': return (n * 100).toFixed(dg ?? 2) + ' %';
      case 'X': return Math.trunc(n).toString(16).toUpperCase().padStart(dg ?? 0, '0');
      case 'E': return n.toExponential(dg ?? 6).toUpperCase();
      case 'C': return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dg ?? 2, maximumFractionDigits: dg ?? 2 });
    }
  }
  if (/^[0#.,]+$/.test(spec)) {                                     // custom: 0.00 / #,##0.0
    const dec = (spec.split('.')[1] || '').length; const ints = (spec.split('.')[0].match(/0/g) || []).length;
    let s = Math.abs(n).toFixed(dec); let [a, b] = s.split('.'); a = a.padStart(ints, '0');
    if (spec.includes(',')) a = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (spec.split('.')[1] && spec.split('.')[1].endsWith('#')) b = b.replace(/0+$/, '');
    return (n < 0 ? '-' : '') + (a === '' ? '0' : a) + (b ? '.' + b : '');
  }
  return toStr(v);
}
function toStr(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'True'; if (v === false) return 'False';
  if (v instanceof D) return fmtD(v.v);
  if (v instanceof Ch) return v.c;
  if (v instanceof SB) return v.s;
  if (v instanceof List) return 'System.Collections.Generic.List`1[System.Object]';
  if (v instanceof Dict) return 'System.Collections.Generic.Dictionary`2[System.Object,System.Object]';
  if (Array.isArray(v)) return 'System.Object[]';
  if (v instanceof Obj) return v.cls.builtinEx ? `System.${v.cls.name}: ${toStr(v.f.get('Message'))}` : v.cls.name;
  if (v instanceof Closure || v instanceof Method) return 'System.Func';
  return String(v);
}
function eq(a, b) {
  if (isNum(a) && isNum(b)) return num(a) === num(b);
  if (a === null || b === null) return a === b;
  return a === b;
}
function cmp(a, b) { const x = isNum(a) ? num(a) : a, y = isNum(b) ? num(b) : b; return x < y ? -1 : x > y ? 1 : 0; }
function coerce(type, v) {
  if (!type || v === null || v === undefined) return v;
  if (DBL.has(type.name) && !type.rank && typeof v === 'number') return new D(v);
  if (type.name === 'char' && typeof v === 'number') return new Ch(String.fromCharCode(v));
  if ((type.name === 'int' || type.name === 'long') && v instanceof Ch) return v.c.charCodeAt(0);
  return v;
}
function defaultOf(type) {
  if (type.rank) return null;
  if (DBL.has(type.name)) return new D(0);
  if (['int', 'long', 'short', 'byte', 'uint', 'ulong'].includes(type.name)) return 0;
  if (type.name === 'bool') return false;
  if (type.name === 'char') return new Ch('\0');
  return null;
}
function arith(op, a, b) {
  if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return toStr(a) + toStr(b);
  if (op === '+' && (a instanceof Ch && b instanceof Ch)) return num(a) + num(b);
  if (!isNum(a) || !isNum(b)) throw new CsError(`cannot apply '${op}' to ${typeName(a)} and ${typeName(b)}`);
  const x = num(a), y = num(b), dbl = a instanceof D || b instanceof D;
  let r;
  switch (op) {
    case '+': r = x + y; break; case '-': r = x - y; break; case '*': r = x * y; break;
    case '/': if (!dbl) { if (y === 0) throw exThrow('DivideByZeroException', 'Attempted to divide by zero.'); r = Math.trunc(x / y); } else r = x / y; break;
    case '%': if (!dbl && y === 0) throw exThrow('DivideByZeroException', 'Attempted to divide by zero.'); r = x % y; break;
  }
  return dbl ? new D(r) : r;
}
function typeName(v) { return v === null ? 'null' : v instanceof D ? 'double' : v instanceof Ch ? 'char' : typeof v === 'number' ? 'int' : typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'bool' : v?.constructor?.name ?? 'object'; }
const exClasses = new Map();
function exClass(name) { if (!exClasses.has(name)) exClasses.set(name, { name, builtinEx: true, fields: [], methods: [], ctors: [] }); return exClasses.get(name); }
function mkEx(name, msg) { const o = new Obj(exClass(name)); o.f.set('Message', msg ?? `Exception of type '${name}' was thrown.`); return o; }
function exThrow(name, msg) { return new Throw(mkEx(name, msg)); }
const seq = v => v instanceof List ? v.a : Array.isArray(v) ? v : typeof v === 'string' ? [...v].map(c => new Ch(c)) : v instanceof Dict ? [...v.m.values()].map(e => new Obj(kvCls(e.k, e.v))) : (() => { throw new CsError('value is not iterable'); })();
const kvCls = (k, val) => { const c = { name: 'KeyValuePair', kv: [k, val], fields: [], methods: [], ctors: [] }; return c; };
const roundEven = (x, d = 0) => { const p = 10 ** d, y = x * p, r = Math.round(y); return (Math.abs(y % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r) / p; };
const dkey = k => k instanceof Ch ? 'c' + k.c : typeof k === 'string' ? 's' + k : isNum(k) ? 'n' + num(k) : k;

/* ------------------------------ interpreter ------------------------------ */
class Env {
  constructor(parent = null) { this.vars = new Map(); this.parent = parent; }
  find(n) { for (let e = this; e; e = e.parent) if (e.vars.has(n)) return e; return null; }
  def(n, v, t) { this.vars.set(n, { v, t }); }
}
const BREAK = { k: 'break' }, CONT = { k: 'continue' };

export function runCSharp(source, write) {
  let prog;
  try { prog = new Parser(lex(source)).parseProgram(); }
  catch (e) { if (e.cs) return { ok: false, error: e.message }; throw e; }

  const classes = new Map(prog.classes.map(c => [c.name, c]));
  const statics = new Map();                                       // class -> Map(field -> {v,t})
  const global = new Env();
  const rng = { next: () => Math.random() };
  let out = ''; const emit = s => { out += s; if (out.includes('\n')) { const parts = out.split('\n'); out = parts.pop(); parts.forEach(p => write(p)); } };
  const flush = () => { if (out) { write(out); out = ''; } };

  function initStatics(cls) {
    const m = new Map(); statics.set(cls, m);
    for (const f of cls.fields) if (f.isStatic && !f.getter) m.set(f.name, { v: f.init ? coerce(f.type, ev(f.init, new Env(global), { cls })) : defaultOf(f.type), t: f.type });
  }

  /* --- calls --- */
  function callFn(fn, args, thisObj) {
    if (fn instanceof Closure) {
      const env = new Env(fn.env); fn.params.forEach((p, i) => env.def(p, fn.ptypes ? coerce(fn.ptypes[i], args[i]) : args[i], fn.ptypes?.[i]));
      if (fn.body.k === 'block') { const r = execBlock(fn.body, env, { cls: fn.cls, self: fn.self }); const v = r && r.k === 'return' ? r.v : null; return fn.ret ? coerce(fn.ret, v) : v; }
      return ev(fn.body, env, { cls: fn.cls, self: fn.self });
    }
    if (fn instanceof Method) {
      const env = new Env(global); const ctx = { cls: fn.cls, self: fn.isStatic ? null : thisObj };
      fn.params.forEach((p, i) => env.def(p.name, coerce(p.type, args[i] !== undefined ? args[i] : p.def ? ev(p.def, env, ctx) : null), p.type));
      const r = execBlock(fn.body, env, ctx); const v = r && r.k === 'return' ? r.v : null;
      return fn.ret && fn.ret.name !== 'void' ? coerce(fn.ret, v) : v;
    }
    throw new CsError('value is not callable');
  }
  function construct(cls, args) {
    const o = new Obj(cls);
    for (const f of cls.fields) if (!f.isStatic && !f.getter) o.f.set(f.name, f.init ? coerce(f.type, ev(f.init, new Env(global), { cls, self: o })) : defaultOf(f.type));
    const ct = cls.ctors.find(c => c.params.length === args.length) || cls.ctors.find(c => c.params.length >= args.length);
    if (cls.ctors.length && !ct) throw new CsError(`no constructor of '${cls.name}' takes ${args.length} argument(s)`);
    if (ct) callFn(new Method('.ctor', ct.params, ct.body, null, cls, false), args, o);
    return o;
  }

  /* --- statements --- */
  function execBlock(b, env, ctx) {
    const scope = new Env(env);
    for (const s of b.body) if (s.k === 'func') { const c = new Closure(s.params.map(p => p.name), s.body, scope); c.cls = ctx.cls; c.self = ctx.self; c.ptypes = s.params.map(p => p.type); c.ret = s.ret; scope.def(s.name, c, null); }
    for (const s of b.body) { const r = exec(s, scope, ctx); if (r) return r; }
    return null;
  }
  function exec(s, env, ctx) {
    switch (s.k) {
      case 'expr': ev(s.e, env, ctx); return null;
      case 'func': return null;
      case 'decl': for (const d of s.decls) env.def(d.name, d.init ? coerce(s.type, evInit(d.init, s.type, env, ctx)) : defaultOf(s.type), s.type); return null;
      case 'block': return execBlock(s, env, ctx);
      case 'if': if (truthy(ev(s.c, env, ctx))) return exec(s.a, env, ctx); else if (s.b) return exec(s.b, env, ctx); return null;
      case 'while': while (truthy(ev(s.c, env, ctx))) { const r = exec(s.body, env, ctx); if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; } } return null;
      case 'do': do { const r = exec(s.body, env, ctx); if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; } } while (truthy(ev(s.c, env, ctx))); return null;
      case 'for': {
        const scope = new Env(env); if (s.init) exec(s.init, scope, ctx);
        while (!s.c || truthy(ev(s.c, scope, ctx))) {
          const r = exec(s.body, scope, ctx); if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; }
          s.step.forEach(e => ev(e, scope, ctx));
        }
        return null;
      }
      case 'foreach': {
        for (const item of [...seq(ev(s.e, env, ctx))]) {
          const scope = new Env(env); scope.def(s.name, coerce(s.type, item), s.type);
          const r = exec(s.body, scope, ctx); if (r) { if (r.k === 'break') break; if (r.k === 'return') return r; }
        }
        return null;
      }
      case 'return': return { k: 'return', v: s.e ? ev(s.e, env, ctx) : null };
      case 'break': return BREAK;
      case 'continue': return CONT;
      case 'throw': { const v = ev(s.e, env, ctx); if (!(v instanceof Obj)) throw new CsError('can only throw exception objects'); throw new Throw(v); }
      case 'switch': {
        const v = ev(s.e, env, ctx); let hit = -1;
        s.cases.forEach((c, i) => { if (hit < 0 && c.labels.some(l => eq(ev(l, env, ctx), v))) hit = i; });
        if (hit < 0) hit = s.cases.findIndex(c => c.isDef);
        if (hit < 0) return null;
        const scope = new Env(env);
        for (let i = hit; i < s.cases.length; i++) for (const st of s.cases[i].body) { const r = exec(st, scope, ctx); if (r) { if (r.k === 'break') return null; return r; } }
        return null;
      }
      case 'try': {
        let result = null;
        try { result = exec(s.body, env, ctx); }
        catch (err) {
          const ex = err instanceof Throw ? err.ex : err instanceof RangeError ? mkEx('StackOverflowException', 'Stack overflow.') : null;
          if (!ex) throw err;
          const c = s.catches.find(c => !c.type || c.type.name === 'Exception' || c.type.name === ex.cls.name || c.type.name.endsWith('.' + ex.cls.name));
          if (!c) throw err;
          const scope = new Env(env); if (c.name) scope.def(c.name, ex); result = exec(c.body, scope, ctx);
        } finally { if (s.fin) { const r = exec(s.fin, env, ctx); if (r) result = r; } }
        return result;
      }
    }
    throw new CsError('unsupported statement: ' + s.k);
  }
  const truthy = v => v === true;
  const evInit = (init, type, env, ctx) => init.k === 'arrlit' ? arrLit(init, type, env, ctx) : ev(init, env, ctx);
  function arrLit(n, type, env, ctx) {
    const et = n.elem || type; const et2 = { name: et.name, rank: 0 };
    const a = n.items.map(i => coerce(et2, i.k === 'arrlit' ? arrLit(i, et2, env, ctx) : ev(i, env, ctx)));
    return (type?.name?.startsWith('List') && !type.rank) ? new List(a) : a;
  }

  /* --- expressions --- */
  function lookupVar(name, env, ctx) {
    const e = env.find(name); if (e) return { kind: 'local', e };
    if (ctx.self && ctx.self.f.has(name)) return { kind: 'field', o: ctx.self };
    if (ctx.self && ctx.cls) { const f = ctx.cls.fields.find(f => f.name === name && f.getter); if (f) return { kind: 'getter', f }; }
    if (ctx.cls && statics.get(ctx.cls)?.has(name)) return { kind: 'static', m: statics.get(ctx.cls) };
    return null;
  }
  function ev(n, env, ctx) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'this': return ctx.self;
      case 'interp': return n.parts.map(p => {
        if (typeof p === 'string') return p;
        const v = ev(p.e, env, ctx); let s = p.fmt ? fmtSpec(v, p.fmt) : toStr(v);
        if (p.align) s = p.align < 0 ? s.padEnd(-p.align) : s.padStart(p.align); return s;
      }).join('');
      case 'ident': {
        const r = lookupVar(n.name, env, ctx);
        if (r) return r.kind === 'local' ? r.e.vars.get(n.name).v : r.kind === 'field' ? r.o.f.get(n.name) : r.kind === 'getter' ? ev(r.f.getter, new Env(global), ctx) : r.m.get(n.name).v;
        if (ctx.cls) { const m = ctx.cls.methods.find(m => m.name === n.name); if (m) return m; }
        if (classes.has(n.name)) return { staticOf: classes.get(n.name) };
        if (n.name in STATICS || n.name === 'string' || n.name === 'int' || n.name === 'double' || n.name === 'char' || n.name === 'bool' || n.name === 'long') return { builtin: n.name };
        throw new CsError(`(${n.line}) error: the name '${n.name}' does not exist in the current context`);
      }
      case 'cond': return truthy(ev(n.c, env, ctx)) ? ev(n.a, env, ctx) : ev(n.b, env, ctx);
      case 'un': { const v = ev(n.e, env, ctx); if (n.op === '!') return !v; if (n.op === '-') return v instanceof D ? new D(-v.v) : -num(v); return v; }
      case 'bin': return binary(n, env, ctx);
      case 'cast': {
        const v = ev(n.e, env, ctx); const x = num(v);
        switch (n.type) {
          case 'int': case 'long': case 'short': case 'byte': case 'uint': case 'ulong': return Math.trunc(x);
          case 'double': case 'float': case 'decimal': return new D(n.type === 'float' ? Math.fround(x) : x);
          case 'char': return new Ch(String.fromCharCode(x));
          case 'string': return toStr(v);
          default: return v;
        }
      }
      case 'is': { const v = ev(n.e, env, ctx); const t = n.type.name; return t === 'string' ? typeof v === 'string' : t === 'int' ? typeof v === 'number' : DBL.has(t) ? v instanceof D : t === 'char' ? v instanceof Ch : t === 'bool' ? typeof v === 'boolean' : v instanceof Obj && v.cls.name === t; }
      case 'as': { const v = ev(n.e, env, ctx); return (n.type.name === 'string' && typeof v !== 'string') ? null : v; }
      case 'assign': return assign(n, env, ctx);
      case 'incdec': {
        const cur = ev(n.target, env, ctx); const nv = arith('+', cur, n.d);
        store(n.target, coerceLike(cur, nv), env, ctx); return n.prefix ? nv : cur;
      }
      case 'index': {
        const o = ev(n.o, env, ctx), i = ev(n.i, env, ctx);
        if (o instanceof Dict) { const k = dkey(i); if (!o.m.has(k)) throw exThrow('KeyNotFoundException', `The given key '${toStr(i)}' was not present in the dictionary.`); return o.m.get(k).v; }
        const arr = o instanceof List ? o.a : o;
        if (typeof o === 'string') { const idx = num(i); if (idx < 0 || idx >= o.length) throw exThrow('IndexOutOfRangeException', 'Index was outside the bounds of the array.'); return new Ch(o[idx]); }
        if (!Array.isArray(arr)) throw new CsError('value cannot be indexed');
        const idx = num(i); if (idx < 0 || idx >= arr.length) throw exThrow(o instanceof List ? 'ArgumentOutOfRangeException' : 'IndexOutOfRangeException', o instanceof List ? 'Index was out of range. Must be non-negative and less than the size of the collection.' : 'Index was outside the bounds of the array.');
        return arr[idx];
      }
      case 'member': {
        const o = ev(n.o, env, ctx);
        if (n.safe && o === null) return null;
        return getMember(o, n.name, n);
      }
      case 'call': return call(n, env, ctx);
      case 'lambda': { const c = new Closure(n.params, n.body, env); c.cls = ctx.cls; c.self = ctx.self; return c; }
      case 'newarr': { const size = num(ev(n.size, env, ctx)); if (size < 0) throw exThrow('OverflowException', 'Array dimensions exceeded supported range.'); const d = defaultOf({ name: n.type.name, rank: 0 }); return Array.from({ length: size }, () => d); }
      case 'arrlit': return arrLit(n, n.type, env, ctx);
      case 'new': return newObj(n, env, ctx);
    }
    throw new CsError('unsupported expression: ' + n.k);
  }
  const coerceLike = (old, v) => old instanceof D && typeof v === 'number' ? new D(v) : old instanceof Ch && typeof v === 'number' ? new Ch(String.fromCharCode(v)) : v;

  function binary(n, env, ctx) {
    const op = n.op;
    if (op === '&&') return truthy(ev(n.l, env, ctx)) && truthy(ev(n.r, env, ctx));
    if (op === '||') return truthy(ev(n.l, env, ctx)) || truthy(ev(n.r, env, ctx));
    if (op === '??') { const l = ev(n.l, env, ctx); return l !== null ? l : ev(n.r, env, ctx); }
    const a = ev(n.l, env, ctx), b = ev(n.r, env, ctx);
    switch (op) {
      case '==': return eq(a, b); case '!=': return !eq(a, b);
      case '<': return cmp(a, b) < 0; case '>': return cmp(a, b) > 0; case '<=': return cmp(a, b) <= 0; case '>=': return cmp(a, b) >= 0;
      case '&': return typeof a === 'boolean' ? a && b : num(a) & num(b);
      case '|': return typeof a === 'boolean' ? a || b : num(a) | num(b);
      case '^': return typeof a === 'boolean' ? a !== b : num(a) ^ num(b);
      default: return arith(op, a, b);
    }
  }
  function assign(n, env, ctx) {
    let v = ev(n.value, env, ctx);
    if (n.op === '??=') { const cur = ev(n.target, env, ctx); if (cur !== null) return cur; }
    else if (n.op !== '=') { const cur = ev(n.target, env, ctx); v = coerceLike(cur, arith(n.op[0], cur, v)); }
    store(n.target, v, env, ctx); return v;
  }
  function store(t, v, env, ctx) {
    if (t.k === 'ident') {
      const r = lookupVar(t.name, env, ctx);
      if (!r) throw new CsError(`(${t.line}) error: the name '${t.name}' does not exist in the current context`);
      if (r.kind === 'local') { const s = r.e.vars.get(t.name); s.v = coerce(s.t, coerceLike(s.v, v)); }
      else if (r.kind === 'field') { const f = ctx.cls?.fields.find(f => f.name === t.name); r.o.f.set(t.name, coerce(f?.type, v)); }
      else if (r.kind === 'static') { const s = r.m.get(t.name); s.v = coerce(s.t, v); }
      else throw new CsError(`property '${t.name}' is read-only`);
    } else if (t.k === 'member') {
      const o = ev(t.o, env, ctx);
      if (o instanceof Obj) { const f = o.cls.fields.find(f => f.name === t.name); o.f.set(t.name, coerce(f?.type, v)); }
      else if (o && o.staticOf) { const s = statics.get(o.staticOf).get(t.name); if (!s) throw new CsError(`'${t.name}' is not a static field`); s.v = coerce(s.t, v); }
      else throw new CsError(`cannot assign to '${t.name}'`);
    } else {
      const o = ev(t.o, env, ctx), i = ev(t.i, env, ctx);
      if (o instanceof Dict) { o.m.set(dkey(i), { k: i, v }); return; }
      const arr = o instanceof List ? o.a : o; const idx = num(i);
      if (!Array.isArray(arr)) throw new CsError('value cannot be indexed');
      if (idx < 0 || idx >= arr.length) throw exThrow('IndexOutOfRangeException', 'Index was outside the bounds of the array.');
      arr[idx] = coerceLike(arr[idx], v);
    }
  }

  function getMember(o, name, n) {
    if (o === null) throw exThrow('NullReferenceException', 'Object reference not set to an instance of an object.');
    if (o.staticOf) {
      const cls = o.staticOf; const s = statics.get(cls)?.get(name); if (s) return s.v;
      const m = cls.methods.find(m => m.name === name); if (m) return m;
      throw new CsError(`'${cls.name}' has no static member '${name}'`);
    }
    if (o.builtin) { const b = STATICS[o.builtin]; if (b && name in b.props) return b.props[name](); if (o.builtin === 'string' && name === 'Empty') return ''; throw new CsError(`unknown member '${o.builtin}.${name}'`); }
    if (typeof o === 'string') { if (name === 'Length') return o.length; }
    if (Array.isArray(o) && name === 'Length') return o.length;
    if (o instanceof List && (name === 'Count' || name === 'Capacity')) return o.a.length;
    if (o instanceof Dict) { if (name === 'Count') return o.m.size; if (name === 'Keys') return new List([...o.m.values()].map(e => e.k)); if (name === 'Values') return new List([...o.m.values()].map(e => e.v)); }
    if (o instanceof SB && name === 'Length') return o.s.length;
    if (o instanceof D || typeof o === 'number') { /* no members */ }
    if (o instanceof Obj) {
      if (o.cls.kv) return name === 'Key' ? o.cls.kv[0] : o.cls.kv[1];
      if (o.f.has(name)) return o.f.get(name);
      const g = o.cls.fields.find(f => f.name === name && f.getter); if (g) return ev(g.getter, new Env(global), { cls: o.cls, self: o });
      const sm = statics.get(o.cls)?.get(name); if (sm) return sm.v;
      const m = o.cls.methods.find(m => m.name === name); if (m) return { bound: m, self: o };
    }
    return { recv: o, method: name };                               // resolved when called
  }

  function call(n, env, ctx) {
    const args = n.args.map(a => ev(a, env, ctx));
    const f = n.f;
    if (f.k === 'member') {
      const o = ev(f.o, env, ctx);
      if (f.safe && o === null) return null;
      if (o === null) throw exThrow('NullReferenceException', 'Object reference not set to an instance of an object.');
      if (o.builtin) return callStatic(o.builtin, f.name, args, f);
      if (o.staticOf) { const m = o.staticOf.methods.find(m => m.name === f.name && m.params.length >= args.length); if (!m) throw new CsError(`'${o.staticOf.name}' has no method '${f.name}'`); return callFn(m, args, null); }
      if (o instanceof Obj && !o.cls.builtinEx && !o.cls.kv) {
        const m = o.cls.methods.find(m => m.name === f.name && m.params.length >= args.length);
        if (m) return callFn(m, args, o);
        const fv = o.f.get(f.name); if (fv instanceof Closure) return callFn(fv, args);
      }
      return callInstance(o, f.name, args);
    }
    if (f.k === 'ident') {
      const r = lookupVar(f.name, env, ctx);
      if (r) { const fn = r.kind === 'local' ? r.e.vars.get(f.name).v : r.kind === 'field' ? r.o.f.get(f.name) : null; return callFn(fn, args); }
      if (ctx.cls) { const m = ctx.cls.methods.find(m => m.name === f.name && m.params.length >= args.length); if (m) return callFn(m, args, m.isStatic ? null : ctx.self); }
      throw new CsError(`(${f.line}) error: the name '${f.name}' does not exist in the current context`);
    }
    const fn = ev(f, env, ctx);
    if (fn && fn.bound) return callFn(fn.bound, args, fn.self);
    return callFn(fn, args);
  }

  function newObj(n, env, ctx) {
    const args = n.args.map(a => ev(a, env, ctx)); const t = n.type.name;
    if (classes.has(t)) return construct(classes.get(t), args);
    if (t.endsWith('Exception') || t === 'Exception') return mkEx(t, args[0] === undefined ? undefined : toStr(args[0]));
    switch (t) {
      case 'List': { const l = new List(args[0] !== undefined && typeof args[0] !== 'number' ? [...seq(args[0])] : []); if (n.init) n.init.forEach(a => l.a.push(coerce({ name: n.type.args?.[0]?.name }, ev(a[0], env, ctx)))); return l; }
      case 'Dictionary': { const d = new Dict(); if (n.init) n.init.forEach(a => d.m.set(dkey(ev(a[0], env, ctx)), { k: ev(a[0], env, ctx), v: coerce(n.type.args?.[1], ev(a[1], env, ctx)) })); return d; }
      case 'StringBuilder': { const s = new SB(); if (typeof args[0] === 'string') s.s = args[0]; return s; }
      case 'Random': return new Rnd();
      case 'Object': return new Obj({ name: 'Object', fields: [], methods: [], ctors: [] });
    }
    throw new CsError(`unknown type '${t}' (not supported in this mini C#)`);
  }

  /* --- built-in static classes --- */
  const D_ = x => new D(x);
  const STATICS = {
    Console: { props: {}, fns: {
      WriteLine: a => { emit(a.length ? (a.length > 1 && typeof a[0] === 'string' ? formatStr(a[0], a.slice(1)) : toStr(a[0])) + '\n' : '\n'); return null; },
      Write: a => { emit(a.length > 1 && typeof a[0] === 'string' ? formatStr(a[0], a.slice(1)) : toStr(a[0])); return null; },
      ReadLine: () => null, Clear: () => null,
    } },
    Math: { props: { PI: () => D_(Math.PI), E: () => D_(Math.E) }, fns: {
      Sqrt: a => D_(Math.sqrt(num(a[0]))), Pow: a => D_(Math.pow(num(a[0]), num(a[1]))), Abs: a => a[0] instanceof D ? D_(Math.abs(a[0].v)) : Math.abs(a[0]),
      Max: a => (a[0] instanceof D || a[1] instanceof D) ? D_(Math.max(num(a[0]), num(a[1]))) : Math.max(a[0], a[1]),
      Min: a => (a[0] instanceof D || a[1] instanceof D) ? D_(Math.min(num(a[0]), num(a[1]))) : Math.min(a[0], a[1]),
      Floor: a => D_(Math.floor(num(a[0]))), Ceiling: a => D_(Math.ceil(num(a[0]))), Truncate: a => D_(Math.trunc(num(a[0]))),
      Round: a => D_(roundEven(num(a[0]), a[1] ?? 0)), Sign: a => Math.sign(num(a[0])),
      Sin: a => D_(Math.sin(num(a[0]))), Cos: a => D_(Math.cos(num(a[0]))), Tan: a => D_(Math.tan(num(a[0]))), Log: a => D_(a[1] === undefined ? Math.log(num(a[0])) : Math.log(num(a[0])) / Math.log(num(a[1]))), Log10: a => D_(Math.log10(num(a[0]))), Exp: a => D_(Math.exp(num(a[0]))),
    } },
    Convert: { props: {}, fns: {
      ToString: a => toStr(a[0]), ToInt32: a => Math.trunc(parseNum(a[0])), ToInt64: a => Math.trunc(parseNum(a[0])), ToDouble: a => D_(parseNum(a[0])), ToBoolean: a => typeof a[0] === 'string' ? a[0].toLowerCase() === 'true' : !!num(a[0]),
    } },
    Environment: { props: { NewLine: () => '\n' }, fns: {} },
    DateTime: { props: { Now: () => new Obj({ name: 'DateTime', fields: [], methods: [], ctors: [] }) }, fns: {} },
  };
  const parseNum = v => { if (typeof v === 'string') { const x = Number(v.trim()); if (v.trim() === '' || Number.isNaN(x)) throw exThrow('FormatException', 'The input string was not in a correct format.'); return x; } return num(v); };
  function formatStr(f, a) { return f.replace(/\{(\d+)(?:,(-?\d+))?(?::([^}]*))?\}/g, (_, i, al, sp) => { let s = a[+i] === undefined ? '' : sp ? fmtSpec(a[+i], sp) : toStr(a[+i]); if (al) s = +al < 0 ? s.padEnd(-al) : s.padStart(+al); return s; }).replace(/\{\{/g, '{').replace(/\}\}/g, '}'); }
  function callStatic(name, fn, a, f) {
    if (STATICS[name]?.fns[fn]) return STATICS[name].fns[fn](a);
    switch (name + '.' + fn) {
      case 'string.Join': return seq(a[1] !== undefined && a.length === 2 ? a[1] : a.slice(1)).map(toStr).join(toStr(a[0]));
      case 'string.Format': return formatStr(a[0], a.slice(1));
      case 'string.IsNullOrEmpty': return a[0] === null || a[0] === '';
      case 'string.IsNullOrWhiteSpace': return a[0] === null || String(a[0]).trim() === '';
      case 'string.Concat': return a.map(toStr).join('');
      case 'int.Parse': case 'long.Parse': return Math.trunc(parseNum(a[0]));
      case 'double.Parse': return D_(parseNum(a[0]));
      case 'int.TryParse': case 'double.TryParse': throw new CsError("'out' arguments are not supported; use int.Parse inside try/catch");
      case 'char.IsDigit': return /\d/.test(toStr(a[0])); case 'char.IsLetter': return /\p{L}/u.test(toStr(a[0]));
      case 'char.IsLetterOrDigit': return /[\p{L}\d]/u.test(toStr(a[0])); case 'char.IsUpper': return /\p{Lu}/u.test(toStr(a[0]));
      case 'char.IsLower': return /\p{Ll}/u.test(toStr(a[0])); case 'char.IsWhiteSpace': return /\s/.test(toStr(a[0]));
      case 'char.ToUpper': return new Ch(toStr(a[0]).toUpperCase()); case 'char.ToLower': return new Ch(toStr(a[0]).toLowerCase());
      case 'int.MaxValue': return 2147483647;
    }
    throw new CsError(`unknown method '${name}.${fn}' (not supported in this mini C#)`);
  }
  // constants such as int.MaxValue
  Object.assign(STATICS, { int: { props: { MaxValue: () => 2147483647, MinValue: () => -2147483648 }, fns: {} }, double: { props: { MaxValue: () => D_(Number.MAX_VALUE), MinValue: () => D_(-Number.MAX_VALUE), PositiveInfinity: () => D_(Infinity), NaN: () => D_(NaN) }, fns: {} }, long: { props: { MaxValue: () => 9223372036854775807 }, fns: {} } });

  /* --- instance methods on built-in values --- */
  const fnOf = f => a => callFn(f, a);
  function callInstance(o, name, a) {
    if (o && o.recv !== undefined) { return callInstance(o.recv, o.method, a); }
    if (o && o.bound) return callFn(o.bound, a, o.self);
    const x = a[0];
    if (typeof o === 'string') switch (name) {
      case 'ToUpper': return o.toUpperCase(); case 'ToLower': return o.toLowerCase(); case 'Trim': return o.trim(); case 'TrimStart': return o.trimStart(); case 'TrimEnd': return o.trimEnd();
      case 'Substring': { if (x < 0 || x > o.length || (a[1] !== undefined && x + a[1] > o.length)) throw exThrow('ArgumentOutOfRangeException', 'Index and length must refer to a location within the string.'); return a[1] === undefined ? o.slice(x) : o.substr(x, a[1]); }
      case 'Contains': return o.includes(toStr(x)); case 'StartsWith': return o.startsWith(toStr(x)); case 'EndsWith': return o.endsWith(toStr(x));
      case 'IndexOf': return o.indexOf(toStr(x), a[1] ?? 0); case 'LastIndexOf': return o.lastIndexOf(toStr(x));
      case 'Replace': return o.split(toStr(x)).join(toStr(a[1])); case 'Split': return o.split(x instanceof Ch ? x.c : Array.isArray(x) ? new RegExp('[' + x.map(c => toStr(c).replace(/[\]\\^-]/g, '\\$&')).join('') + ']') : toStr(x));
      case 'PadLeft': return o.padStart(x, a[1] ? toStr(a[1]) : ' '); case 'PadRight': return o.padEnd(x, a[1] ? toStr(a[1]) : ' ');
      case 'ToString': return o; case 'ToCharArray': return [...o].map(c => new Ch(c)); case 'Equals': return o === x; case 'CompareTo': return cmp(o, x);
      case 'Insert': return o.slice(0, x) + toStr(a[1]) + o.slice(x); case 'Remove': return a[1] === undefined ? o.slice(0, x) : o.slice(0, x) + o.slice(x + a[1]);
    }
    if (typeof o === 'number' || o instanceof D || o instanceof Ch || typeof o === 'boolean') {
      if (name === 'ToString') return x !== undefined ? fmtSpec(o, x) : toStr(o); if (name === 'Equals') return eq(o, x); if (name === 'CompareTo') return cmp(o, x);
    }
    if (o instanceof SB) switch (name) {
      case 'Append': o.s += toStr(x); return o; case 'AppendLine': o.s += (x === undefined ? '' : toStr(x)) + '\n'; return o; case 'ToString': return o.s;
      case 'Clear': o.s = ''; return o; case 'Insert': o.s = o.s.slice(0, x) + toStr(a[1]) + o.s.slice(x); return o;
    }
    if (o instanceof Rnd) switch (name) {
      case 'Next': return a.length === 0 ? Math.floor(rng.next() * 2147483647) : a.length === 1 ? Math.floor(rng.next() * x) : x + Math.floor(rng.next() * (a[1] - x));
      case 'NextDouble': return D_(rng.next());
    }
    if (o instanceof Dict) switch (name) {
      case 'Add': if (o.m.has(dkey(x))) throw exThrow('ArgumentException', 'An item with the same key has already been added.'); o.m.set(dkey(x), { k: x, v: a[1] }); return null;
      case 'ContainsKey': return o.m.has(dkey(x)); case 'Remove': return o.m.delete(dkey(x)); case 'Clear': o.m.clear(); return null;
      case 'TryGetValue': throw new CsError("'out' arguments are not supported; use ContainsKey and the indexer");
      case 'ContainsValue': return [...o.m.values()].some(e => eq(e.v, x));
    }
    if (o instanceof Obj && o.cls.builtinEx) { if (name === 'ToString') return toStr(o); if (name === 'GetType') return new Obj({ name: 'Type', fields: [], methods: [], ctors: [], builtinEx: false, kv: [o.cls.name, o.cls.name] }); }
    if (o instanceof Obj && o.cls.name === 'DateTime') { if (name === 'ToString') return new Date().toISOString().replace('T', ' ').slice(0, 19); }
    if (o instanceof Obj && !o.cls.kv && name === 'ToString') return toStr(o);
    if (o instanceof List || Array.isArray(o) || o instanceof Dict || typeof o === 'string') return callSeq(o, name, a);
    throw new CsError(`unknown method '${name}' on ${typeName(o)} (not supported in this mini C#)`);
  }
  function callSeq(o, name, a) {
    const isList = o instanceof List; const arr = isList ? o.a : o; const x = a[0];
    const P = f => v => truthy(callFn(f, [v]));
    if (isList) switch (name) {
      case 'Add': arr.push(x); return null; case 'AddRange': arr.push(...seq(x)); return null; case 'Insert': arr.splice(x, 0, a[1]); return null;
      case 'Remove': { const i = arr.findIndex(v => eq(v, x)); if (i >= 0) arr.splice(i, 1); return i >= 0; }
      case 'RemoveAt': if (x < 0 || x >= arr.length) throw exThrow('ArgumentOutOfRangeException', 'Index was out of range.'); arr.splice(x, 1); return null;
      case 'RemoveAll': { const n0 = arr.length; const keep = arr.filter(v => !P(x)(v)); arr.length = 0; arr.push(...keep); return n0 - keep.length; }
      case 'Clear': arr.length = 0; return null; case 'IndexOf': return arr.findIndex(v => eq(v, x));
      case 'Sort': arr.sort(x ? (p, q) => num(callFn(x, [p, q])) : cmp); return null; case 'Reverse': arr.reverse(); return null;
      case 'Find': return arr.find(P(x)) ?? null; case 'FindAll': return new List(arr.filter(P(x))); case 'Exists': return arr.some(P(x));
      case 'ForEach': arr.forEach(v => callFn(x, [v])); return null; case 'ToArray': return [...arr];
    }
    if (name === 'Contains') return typeof o === 'string' ? o.includes(toStr(x)) : arr.some(v => eq(v, x));
    const src = typeof o === 'string' ? seq(o) : arr;
    switch (name) {
      case 'Where': return new List(src.filter(P(x))); case 'Select': return new List(src.map(v => callFn(x, [v])));
      case 'OrderBy': return new List([...src].sort((p, q) => cmp(callFn(x, [p]), callFn(x, [q]))));
      case 'OrderByDescending': return new List([...src].sort((p, q) => cmp(callFn(x, [q]), callFn(x, [p]))));
      case 'Sum': { const vs = x ? src.map(v => callFn(x, [v])) : src; const dbl = vs.some(v => v instanceof D); const s = vs.reduce((t, v) => t + num(v), 0); return dbl ? D_(s) : s; }
      case 'Average': { const vs = (x ? src.map(v => callFn(x, [v])) : src).map(num); if (!vs.length) throw exThrow('InvalidOperationException', 'Sequence contains no elements'); return D_(vs.reduce((t, v) => t + v, 0) / vs.length); }
      case 'Max': case 'Min': { const vs = x ? src.map(v => callFn(x, [v])) : src; if (!vs.length) throw exThrow('InvalidOperationException', 'Sequence contains no elements'); return vs.reduce((t, v) => (cmp(v, t) * (name === 'Max' ? 1 : -1) > 0 ? v : t)); }
      case 'Count': return x ? src.filter(P(x)).length : src.length; case 'Any': return x ? src.some(P(x)) : src.length > 0; case 'All': return src.every(P(x));
      case 'First': { const r = x ? src.find(P(x)) : src[0]; if (r === undefined) throw exThrow('InvalidOperationException', 'Sequence contains no elements'); return r; }
      case 'FirstOrDefault': return (x ? src.find(P(x)) : src[0]) ?? null; case 'Last': { const r = src[src.length - 1]; if (r === undefined) throw exThrow('InvalidOperationException', 'Sequence contains no elements'); return r; }
      case 'ToList': return new List([...src]); case 'ToArray': return [...src]; case 'Reverse': return new List([...src].reverse());
      case 'Distinct': return new List(src.filter((v, i) => src.findIndex(w => eq(v, w)) === i)); case 'Take': return new List(src.slice(0, x)); case 'Skip': return new List(src.slice(x));
      case 'IndexOf': return src.findIndex(v => eq(v, x));
      case 'ToString': return toStr(o); case 'Clone': return [...src];
    }
    throw new CsError(`unknown method '${name}' on ${typeName(o)} (not supported in this mini C#)`);
  }

  /* --- run --- */
  let ok = true, error;
  try {
    const ctx = { cls: null, self: null };
    for (const c of prog.classes) initStatics(c);
    if (prog.stmts.length) execBlock({ body: prog.stmts }, global, ctx);
    else {
      const mainCls = prog.classes.find(c => c.methods.some(m => m.name === 'Main'));
      if (!mainCls) throw new CsError('error: no Main method or top-level statements found');
      callFn(mainCls.methods.find(m => m.name === 'Main'), [[]], null);
    }
  } catch (e) {
    ok = false;
    if (e instanceof Throw) error = `Unhandled exception. System.${e.ex.cls.name}: ${toStr(e.ex.f.get('Message'))}`;
    else if (e instanceof RangeError) error = 'Unhandled exception. System.StackOverflowException: stack overflow (too much recursion)';
    else if (e.cs) error = e.message.startsWith('(') || e.message.startsWith('error') ? e.message : 'error: ' + e.message;
    else error = 'internal error: ' + (e && e.message);
  }
  flush();
  return { ok, error };
}
