// D1: exported @graphgoblin/domain evaluator and template observation (DOMAIN-PUBLIC).
// Usage: node d1-domain-observe.mjs <outDir>
import { imp, recorder } from './lib/common.mjs';

const out = process.argv[2];
const r = recorder(out, 'd1');
const D = await imp('packages/domain/dist/index.js');
const { observeExpression, observePredicate, observeTemplate, evaluateExpression, checkExpression, ExpressionError, TemplateError, renderTemplate } = D;
const C = 'DOMAIN-PUBLIC';
const REASONS = new Set(['compile', 'unsafe-regex', 'depth', 'time', 'evaluation-rejected']);
const shape = (o) => ({ ok: o.ok, reason: o.reason, keys: Object.keys(o).sort(), errorClass: o.error?.constructor?.name, errorMessage: o.error?.message });

async function obs(expr, input = {}, options) {
  const o = await observeExpression(expr, input, options);
  r.raw('observe', { expr: expr.length > 200 ? expr.slice(0, 200) + '…' : expr, result: shape(o), value: o.ok ? o.value : undefined });
  return o;
}
const closed = (o) => Object.keys(o).every((k) => ['ok', 'value', 'error', 'reason'].includes(k)) && (o.reason === undefined || REASONS.has(o.reason));

// J01 direct literal + legacy contract
{
  const o = await obs('$error("QA486-LIT-J01")', { a: 1 });
  r.check('J01', 'direct literal $error -> evaluation-rejected', !o.ok && o.reason === 'evaluation-rejected' && closed(o), shape(o), C);
  let legacy;
  try { await evaluateExpression('$error("QA486-LIT-J01")', { a: 1 }); } catch (e) { legacy = e; }
  r.check('J01-legacy', 'legacy evaluateExpression still rejects ExpressionError carrying the literal (legacy contract)', legacy instanceof ExpressionError && legacy.message.includes('QA486-LIT-J01'), { cls: legacy?.constructor?.name, message: legacy?.message, details: legacy?.details }, C);
}
// J02 grouped
{
  const o = await obs('($x := 1; $error("QA486-LIT-J02"))');
  r.check('J02', 'grouped block -> evaluation-rejected', !o.ok && o.reason === 'evaluation-rejected', shape(o), C);
}
// J03 conditional taken / untaken
{
  const t = await obs('a = 1 ? $error("QA486-LIT-J03") : 2', { a: 1 });
  const u = await obs('a = 2 ? $error("QA486-LIT-J03") : 7', { a: 1 });
  r.check('J03-taken', 'taken conditional -> evaluation-rejected', !t.ok && t.reason === 'evaluation-rejected', shape(t), C);
  r.check('J03-untaken', 'untaken conditional -> ordinary value 7', u.ok && u.value === 7, { ...shape(u), value: u.value }, C);
}
// J04 nested function
{
  const o = await obs('($f := function($v){ $error("QA486-LIT-J04") }; $f(1))');
  r.check('J04', 'nested function -> evaluation-rejected', !o.ok && o.reason === 'evaluation-rejected', shape(o), C);
}
// J05 dynamic message from input
{
  const o = await obs('$error("QA486-" & a)', { a: 'IN-J05' });
  r.check('J05', 'dynamic $error message -> evaluation-rejected', !o.ok && o.reason === 'evaluation-rejected', shape(o), C);
}
// J06 assertion
{
  const o = await obs('$assert(false, "QA486-LIT-J06")');
  r.check('J06', '$assert -> evaluation-rejected', !o.ok && o.reason === 'evaluation-rejected', shape(o), C);
}
// J07 length / characters
{
  const long = 'QA486-LIT-J07L' + 'x'.repeat(5000);
  const o1 = await obs(`$error("${long}")`);
  const o2 = await obs('$error("QA486-LIT-J07C\\n\\"quote\\" <script>alert(1)</script> \u{1F642}  ")');
  r.check('J07-length', '5,000-char literal -> evaluation-rejected', !o1.ok && o1.reason === 'evaluation-rejected', shape(o1), C);
  r.check('J07-chars', 'special-character literal -> evaluation-rejected', !o2.ok && o2.reason === 'evaluation-rejected', shape(o2), C);
}
// J08 type errors
{
  const a = await obs('$length(123)');
  const b = await obs('$substring(1)');
  r.check('J08', 'runtime type errors -> evaluation-rejected', !a.ok && a.reason === 'evaluation-rejected' && !b.ok && b.reason === 'evaluation-rejected', [shape(a), shape(b)], C);
}
// J09 $eval malformed / unsafe runtime strings
{
  const a = await obs('$eval("1 +")');
  const b = await obs('$eval("$match(\'aaaa\', /(a+)+$/)")');
  const c = await obs('$eval(src)', { src: '1 +' });
  r.check('J09-malformed', '$eval malformed runtime string -> evaluation-rejected (never compile)', !a.ok && a.reason === 'evaluation-rejected', shape(a), C);
  r.check('J09-unsafe', '$eval unsafe runtime regex -> evaluation-rejected (never unsafe-regex)', !b.ok && b.reason === 'evaluation-rejected', shape(b), C);
  r.check('J09-input', '$eval of input-supplied malformed source -> evaluation-rejected', !c.ok && c.reason === 'evaluation-rejected', shape(c), C);
  const ok = await obs('$eval("1 + 2")');
  r.check('J09-control', '$eval valid string succeeds', ok.ok && ok.value === 3, shape(ok), C);
}
// J10 top-level compile / unsafe regex (synthetic reachability)
{
  const a = await obs('1 +');
  const b = await obs('$match(a, /(a+)+$/)', { a: 'aaa' });
  r.check('J10-compile', 'top-level malformed -> compile (SYNTHETIC: publish refuses)', !a.ok && a.reason === 'compile', shape(a), C + '/SYNTHETIC');
  r.check('J10-unsafe', 'top-level unsafe regex -> unsafe-regex (SYNTHETIC: publish refuses)', !b.ok && b.reason === 'unsafe-regex', shape(b), C + '/SYNTHETIC');
  r.check('J10-check', 'checkExpression refuses both (publish-time validator input)', checkExpression('1 +') !== null && checkExpression('$match(a, /(a+)+$/)') !== null, { a: checkExpression('1 +'), b: checkExpression('$match(a, /(a+)+$/)') }, C);
}
// J11 depth
let depthError;
{
  const o = await obs('($f := function($n){ $n = 0 ? 0 : 1 + $f($n-1) }; $f(5000))');
  depthError = o.error;
  r.check('J11', 'recursion beyond maxDepth -> depth', !o.ok && o.reason === 'depth', shape(o), C);
}
// J12 time
{
  const o = await obs('$count([1..3000000].($ + 1))', {}, { timeoutMs: 20 });
  r.check('J12', 'controlled deadline -> time', !o.ok && o.reason === 'time', shape(o), C);
}
// J13 binding preparation getters
{
  let reads = 0;
  const genuine = new ExpressionError('QA486-EXT-J13-genuine');
  const b1 = Object.defineProperty({}, 'unrelated', { enumerable: true, get() { reads += 1; throw genuine; } });
  const o1 = await obs('1', {}, { bindings: b1 });
  r.check('J13-genuine', 'getter throwing genuine ExpressionError: no reason, same identity, one read', !o1.ok && o1.reason === undefined && o1.error === genuine && reads === 1, { ...shape(o1), reads, identity: o1.error === genuine }, C);
  let reads2 = 0;
  const plain = new Error('QA486-EXT-J13-plain');
  const b2 = Object.defineProperty({}, 'error', { enumerable: true, get() { reads2 += 1; throw plain; } });
  const o2 = await obs('1', {}, { bindings: b2 });
  r.check('J13-plain', 'getter on `error` throwing plain Error: no reason, legacy-wrapped ExpressionError, one read', !o2.ok && o2.reason === undefined && o2.error instanceof ExpressionError && o2.error !== plain && reads2 === 1, { ...shape(o2), reads2 }, C);
}
// J14 rethrow earlier genuine depth error via a later callback
{
  const o = await obs('$boom()', {}, { bindings: { boom: () => { throw depthError; } } });
  r.check('J14', 'earlier depth error rethrown by later callback: identity kept, reason evaluation-rejected (not depth)', !o.ok && o.error === depthError && o.reason === 'evaluation-rejected', { ...shape(o), identity: o.error === depthError }, C);
}
// J15 name / code spoofs from external callback
{
  const named = Object.assign(new Error('QA486-EXT-J15-name'), { name: 'ExpressionError' });
  const coded = { code: 'EXPRESSION_ERROR', message: 'QA486-EXT-J15-code' };
  const a = await obs('$boom()', {}, { bindings: { boom: () => { throw named; } } });
  const b = await obs('$boom()', {}, { bindings: { boom: () => { throw coded; } } });
  r.check('J15-name', 'name-spoofed Error -> only evaluation-rejected; legacy wrapped (not identity)', !a.ok && a.reason === 'evaluation-rejected' && a.error !== named && a.error instanceof ExpressionError, shape(a), C);
  r.check('J15-code', 'code-spoofed object -> only evaluation-rejected; legacy wrapped', !b.ok && b.reason === 'evaluation-rejected' && b.error instanceof ExpressionError, shape(b), C);
  const ok = await obs('$fine()', {}, { bindings: { fine: () => 5 } });
  r.check('J15-control', 'successful callback returns value', ok.ok && ok.value === 5, shape(ok), C);
}
// J16 predicate coercion fault (synthetic)
{
  const hostile = new Proxy({}, { ownKeys() { throw new Error('QA486-EXT-J16-coerce'); } });
  let thrown; let obsResult;
  try { obsResult = await observePredicate('$p()', {}, { bindings: { p: () => hostile } }); } catch (e) { thrown = e; }
  r.raw('J16', { thrown: thrown?.message, obsResult: obsResult && shape(obsResult) });
  r.check('J16', 'predicate coercion failure carries no authored reason (propagates or rejects without reason)', thrown !== undefined ? !('reason' in Object(thrown)) : obsResult && obsResult.reason === undefined, { thrown: thrown && { cls: thrown.constructor.name, message: thrown.message }, obsResult: obsResult && shape(obsResult) }, C + '/SYNTHETIC');
}
// J17 predicate success controls
{
  const cases = [['true', true], ['false', false], ['null', false], ['[]', false], ['[1]', true], ['{}', false], ['{"a":1}', true], ['0', false], ['"x"', true], ['missing', false]];
  const got = [];
  for (const [e, want] of cases) { const o = await observePredicate(e, {}); got.push({ e, ok: o.ok, value: o.value, want }); }
  r.check('J17', 'predicate coercion outcomes unchanged', got.every((g) => g.ok && g.value === g.want), got, C);
  const f = await observePredicate('$error("QA486-LIT-J17")', {});
  r.check('J17-fail', 'failing predicate expression -> evaluation-rejected', !f.ok && f.reason === 'evaluation-rejected', shape(f), C);
}
// J18 overlapping evaluations of the same cached source
{
  const src = 'v = 1 ? $error("QA486-LIT-J18") : v * 2';
  const [a, b, c] = await Promise.all([obs(src, { v: 1 }), obs(src, { v: 3 }), obs(src, { v: 1 })]);
  r.check('J18', 'overlapping same-source invocations are independent', !a.ok && a.reason === 'evaluation-rejected' && b.ok && b.value === 6 && !c.ok && c.reason === 'evaluation-rejected', [shape(a), { ...shape(b), value: b.value }, shape(c)], C);
}
// J19 Liquid observation
{
  const inc = await observeTemplate('first\n{% include "QA486-PATH-T" %}', {});
  r.raw('J19-include', { ok: inc.ok, fact: inc.fact, errorClass: inc.error?.constructor?.name, errorMessage: inc.error?.message });
  r.check('J19-include', 'include at line 2 -> render fact line 2 column 1', !inc.ok && inc.fact.phase === 'render' && inc.fact.line === 2 && inc.fact.column === 1 && inc.error instanceof TemplateError, { fact: inc.fact }, C);
  const taken = await observeTemplate('{% if flag %}{{ "QA486-LIT-T" | append }}{% else %}Main{% endif %}', { flag: true });
  const untaken = await observeTemplate('{% if flag %}{{ "QA486-LIT-T" | append }}{% else %}Main{% endif %}', { flag: false });
  r.raw('J19-filter', { taken: { ok: taken.ok, fact: taken.fact, msg: taken.error?.message }, untaken });
  r.check('J19-taken', 'taken-branch filter fault -> render fact', !taken.ok && taken.fact.phase === 'render', { fact: taken.fact }, C);
  r.check('J19-untaken', 'untaken branch renders ordinary text', untaken.ok && untaken.value === 'Main', untaken, C);
  const parse = await observeTemplate('ok\n{% if %}', {});
  r.check('J19-parse', 'parse error -> parse fact (SYNTHETIC at runtime: publish refuses)', !parse.ok && parse.fact.phase === 'parse', { fact: parse.fact }, C + '/SYNTHETIC');
  let legacy;
  try { await renderTemplate('{% include "QA486-PATH-T" %}', {}); } catch (e) { legacy = e; }
  r.check('J19-legacy', 'legacy renderTemplate still rejects TemplateError', legacy instanceof TemplateError, { cls: legacy?.constructor?.name, message: legacy?.message }, C);
  const facts = [inc.fact, taken.fact, parse.fact];
  r.check('J20-template', 'template facts contain only phase/line/column with numeric positions', facts.every((f) => Object.keys(f).every((k) => ['phase', 'line', 'column'].includes(k)) && ['parse', 'render'].includes(f.phase) && (f.line === undefined || Number.isSafeInteger(f.line))), facts, C);
}
r.finish();
