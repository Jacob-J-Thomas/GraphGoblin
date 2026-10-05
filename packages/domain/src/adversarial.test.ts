import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { MutationOperationSchema } from '@graphgoblin/contracts';
import { sampleThread } from '@graphgoblin/contracts/testing';
import { applyPatch } from './patch.js';
import { getAtPointer } from './pointer.js';
import { applyMutations, planMutation, MUTABLE_REGIONS } from './mutations.js';
import { renderTemplate } from './template.js';
import { checkExpression, evaluateExpression } from './expression.js';

const ctx = { nodeId: 'attack', newId: () => 'test', now: () => '2026-10-03T00:00:00.000Z' };
const op = (input: unknown) => MutationOperationSchema.parse(input);

describe('adversarial domain invariants', () => {
  it('9: escaped pointers, array append and failed tests are atomic', () => {
    const doc = { 'a/b': { '~key': [1] } };
    expect(applyPatch(doc, [{ op: 'add', path: '/a~1b/~0key/-', value: 2 }])).toEqual({
      'a/b': { '~key': [1, 2] },
    });
    for (const path of ['/a~1b/~0key/2', '/a~1b/~0key/-1', '/a~1b/~0key/01']) {
      expect(() => applyPatch(doc, [{ op: 'add', path, value: 2 }])).toThrow();
    }
    expect(() =>
      applyPatch(doc, [
        { op: 'add', path: '/new', value: 3 },
        { op: 'test', path: '/a~1b/~0key/0', value: 2 },
      ]),
    ).toThrow(/test failed/);
    expect(doc).toEqual({ 'a/b': { '~key': [1] } });
    expect(() => applyPatch(doc, [{ op: 'move', from: '/a~1b', path: '/a~1b/child' }])).toThrow(
      /own child/,
    );
  });

  it('ADV-006: __proto__ is an ordinary own JSON key after patching', () => {
    const patched = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { poisoned: true } }]);
    expect(getAtPointer(patched, '/__proto__')).toEqual({ found: true, value: { poisoned: true } });
    expect(Object.getPrototypeOf(patched)).toBe(Object.prototype);
    expect(JSON.stringify(patched)).toBe('{"__proto__":{"poisoned":true}}');
    expect(Object.prototype).not.toHaveProperty('poisoned');
    const nested = JSON.parse('{"__proto__":{"poisoned":true}}') as Record<string, unknown>;
    expect(
      JSON.stringify(applyPatch({}, [{ op: 'add', path: '/nested', value: nested as never }])),
    ).toBe('{"nested":{"__proto__":{"poisoned":true}}}');
  });

  it.each(['include', 'render', 'layout'])(
    '10: Liquid %s cannot read a local file',
    async (tag) => {
      await expect(renderTemplate(`{% ${tag} 'C:/Windows/win.ini' %}`, {})).rejects.toThrow();
    },
  );

  it('10: JSONata recursion and eval cannot escape into JS', async () => {
    await expect(
      evaluateExpression(
        '($f := function($n){$n <= 0 ? 0 : 1 + $f($n - 1)}; $f(500))',
        {},
        { maxDepth: 20 },
      ),
    ).rejects.toThrow(/depth/);
    await expect(evaluateExpression('$eval("$f()")', {})).rejects.toThrow();
    expect(await evaluateExpression('$eval("$lookup($, \'process\')")', {})).toBeUndefined();
    expect(await renderTemplate('{{ x.constructor.constructor }}', { x: {} })).toBe('');
  });

  it('10: exponentially growing strings stop at a deterministic evaluator deadline', async () => {
    let elapsed = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => elapsed++);
    try {
      await expect(
        evaluateExpression(
          '($f := function($s, $n){$n = 0 ? $s : $f($s & $s, $n - 1)}; $f("x", 40))',
          {},
          { timeoutMs: 10 },
        ),
      ).rejects.toThrow(/exceeded 10ms/);
    } finally {
      clock.mockRestore();
    }
  });

  it('ADV-007: JSONata native regex is bounded by its expression timeout', async () => {
    // Run the untrusted regex in a disposable process: if the check regressed, the match would
    // never return and only a separate watchdog could stop it.
    const module = new URL('./expression.ts', import.meta.url).href;
    const expression = '$match("' + 'a'.repeat(32) + '!", /^(a+)+$/)';
    const compiler = pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
    const code = `import ts from ${JSON.stringify(compiler)};
      import { readFileSync } from 'node:fs'; import { registerHooks } from 'node:module';
      registerHooks({ resolve(s,c,n) { return n(s.startsWith('.') && s.endsWith('.js') ? s.slice(0,-3)+'.ts' : s,c); },
        load(u,c,n) { return u.endsWith('.ts') ? {format:'module', shortCircuit:true, source:ts.transpile(readFileSync(new URL(u),'utf8'), {module:ts.ModuleKind.ESNext})} : n(u,c); } });
      const { evaluateExpression } = await import(${JSON.stringify(module)});
      try { await evaluateExpression(${JSON.stringify(expression)}, {}, {timeoutMs: 2_000}); process.exit(2); }
      catch (error) { process.stderr.write(String(error.message)); process.exit(0); }`;
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve('watchdog');
      }, 10_000);
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(`exit:${code}:${stderr}`);
      });
    });
    expect(result).toMatch(/^exit:0:.*can run without bound/);
  }, 15_000);

  it.each([
    '$match("' + 'a'.repeat(32) + '!", /^(a+)+$/)',
    '$replace("x", /(\\w*\\s?)*$/, "")',
    '$contains("x", /(a|aa)+b/)',
    '$split("x", /(.)\\1/)',
    '{"r": $match("x", /((ab)*c){2,}/)}',
  ])('ADV-007: rejects the pathological pattern in %s before it runs', async (expression) => {
    expect(checkExpression(expression)).toMatch(/can run without bound/);
    await expect(evaluateExpression(expression, {})).rejects.toThrow(/can run without bound/);
  });

  it('ADV-007: ordinary regex patterns still evaluate', async () => {
    expect(await evaluateExpression('$match("ab-12-cd", /\\d+/).match', {})).toBe('12');
    expect(await evaluateExpression('$replace("a.b.c", /\\./, "/")', {})).toBe('a/b/c');
    expect(await evaluateExpression('$split("a, b,c", /,\\s*/)', {})).toEqual(['a', 'b', 'c']);
    expect(await evaluateExpression('$contains("Foo@Bar.com", /^\\w+@\\w+\\.com$/i)', {})).toBe(
      true,
    );
    expect(await evaluateExpression('$contains("foobarfoo", /^(foo|bar)+$/)', {})).toBe(true);
    expect(await evaluateExpression('$contains("2026-10-03", /^\\d{4}-\\d{2}-\\d{2}$/)', {})).toBe(
      true,
    );
  });

  it('ADV-007: redact and replace patterns get the same check', async () => {
    const thread = { ...sampleThread(), messages: [], vars: { value: 'aaaa!' } };
    await expect(
      applyMutations(thread, [op({ op: 'redact', target: 'vars', patterns: ['^(a+)+$'] })], ctx),
    ).rejects.toThrow(/can run without bound/);
    const ok = await applyMutations(
      thread,
      [op({ op: 'redact', target: 'vars', patterns: ['a+'], replacement: 'X' })],
      ctx,
    );
    expect(ok.thread.vars['value']).toBe('X!');
  });

  // Review of WP-G: ambiguity inside a nested, unquantified group, and runtime compilation.
  it.each(['redact', 'replace'] as const)(
    'ADV-007 review: %s rejects ambiguity nested inside a repeated group',
    async (kind) => {
      const mutation =
        kind === 'redact'
          ? { op: kind, target: 'vars', patterns: ['^(?:(?:a|aa))+$'] }
          : { op: kind, target: 'vars', pattern: '^(?:(?:a|aa))+$', replacement: 'X' };
      await expect(
        applyMutations({ ...sampleThread(), vars: { text: 'aaaa!' } }, [op(mutation)], ctx),
      ).rejects.toThrow(/can run without bound/);
    },
  );

  // Third review round: the checked $eval must behave like JSONata's own.
  it.each([
    ['($x:=42;$eval("$x"))', 42],
    ['($f:=function($x){$x+1};$eval("$f(2)"))', 3],
    ['($x:=2;$eval("$x + a", {"a":3}))', 5],
  ])('ADV-007 review: $eval keeps the lexical context in %s', async (source, expected) => {
    expect(await evaluateExpression(source, { a: 1 })).toBe(expected);
  });

  it('ADV-007 review: nested $eval counts toward the caller depth budget', async () => {
    let input: unknown = { expr: '42' };
    for (let i = 0; i < 120; i += 1) input = { expr: '$eval(expr,next)', next: input };
    await expect(
      evaluateExpression('$eval(expr,next)', input, { maxDepth: 20, timeoutMs: 10_000 }),
    ).rejects.toThrow(/max depth/);
  });

  it('ADV-007 review: a nested $eval failure keeps one bounded cause', async () => {
    let input: unknown = { expr: '$error("small failure")' };
    for (let i = 0; i < 30; i += 1) input = { expr: '$eval(expr,next)', next: input };
    const error = await evaluateExpression('$eval(expr,next)', input, { timeoutMs: 2000 }).catch(
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('$eval failed: small failure');
    // A huge inner message is cut at the boundary.
    const long = await evaluateExpression(`$eval('$error("${'x'.repeat(5000)}")')`, {}).catch(
      (e: unknown) => e as Error,
    );
    expect((long as Error).message.length).toBeLessThan(1100);
    expect((long as Error).message).toMatch(/more characters\)$/);
  });

  it.each([10, 20, 30])(
    'ADV-007 review: %i nested failing $evals stay small in a 128 MB process',
    (depth) => {
      const module = new URL('./expression.ts', import.meta.url).href;
      const compiler = pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
      const code = `import ts from ${JSON.stringify(compiler)};
        import { readFileSync } from 'node:fs'; import { registerHooks } from 'node:module';
        registerHooks({ resolve(s,c,n) { return n(s.startsWith('.') && s.endsWith('.js') ? s.slice(0,-3)+'.ts' : s,c); },
          load(u,c,n) { return u.endsWith('.ts') ? {format:'module', shortCircuit:true, source:ts.transpile(readFileSync(new URL(u),'utf8'), {module:ts.ModuleKind.ESNext})} : n(u,c); } });
        const { evaluateExpression } = await import(${JSON.stringify(module)});
        let input = { expr: '$error("small failure")' };
        for (let i = 0; i < ${depth}; i++) input = { expr: '$eval(expr,next)', next: input };
        const start = performance.now();
        try { await evaluateExpression('$eval(expr,next)', input, { timeoutMs: 40, maxDepth: 200 }); process.stdout.write('accepted'); }
        catch (e) { process.stdout.write(JSON.stringify({ length: e.message.length, ms: performance.now() - start })); }`;
      const result = spawnSync(
        process.execPath,
        ['--max-old-space-size=128', '--input-type=module', '-e', code],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          timeout: 10_000,
          windowsHide: true,
          encoding: 'utf8',
        },
      );
      expect(result.status).toBe(0);
      const outcome = JSON.parse(result.stdout) as { length: number; ms: number };
      expect(outcome.length).toBeLessThan(1100);
      expect(outcome.ms).toBeLessThan(500);
    },
    15_000,
  );

  it('ADV-007 review: nested $eval keeps the caller deadline', async () => {
    let input: unknown = { expr: '42' };
    for (let i = 0; i < 60; i += 1) input = { expr: '($nap();$eval(expr,next))', next: input };
    const started = performance.now();
    await expect(
      evaluateExpression('$eval(expr,next)', input, {
        maxDepth: 1000,
        timeoutMs: 40,
        bindings: { nap: () => new Promise((resolve) => setTimeout(() => resolve(null), 5)) },
      }),
    ).rejects.toThrow(/exceeded/);
    // Without a shared deadline each nested call restarts its own 40 ms (about 940 ms in total).
    expect(performance.now() - started).toBeLessThan(400);
  });

  it('ADV-007 review: $eval compiles its string through the same check', async () => {
    const expression = `$eval($join([${JSON.stringify('$match("aaaa!", /^(a')}, ${JSON.stringify('+)+$/)')}]))`;
    expect(checkExpression(expression)).toBeNull();
    await expect(evaluateExpression(expression, {})).rejects.toThrow(/can run without bound/);
    // Safe strings still evaluate, against the focus when one is given.
    expect(await evaluateExpression('$eval("a + 1")', { a: 1 })).toBe(2);
    expect(await evaluateExpression('$eval("x * 2", {"x": 5})', {})).toBe(10);
    expect(await evaluateExpression('$eval(missing)', {})).toBeUndefined();
    await expect(evaluateExpression('$eval(42)', {})).rejects.toThrow('$eval failed');
    // A string cannot become a regex any other way: $match rejects a string pattern.
    await expect(
      evaluateExpression('($p := $join(["^(a", "+)+$"]); $match("aaaa!", $p))', {}),
    ).rejects.toThrow(/Argument 2/);
  });

  it.each([
    ['nested-alternative', `$match("${'a'.repeat(42)}!", /^(?:(?:a|aa))+$/)`],
    ['runtime-eval', `$eval(${JSON.stringify(`$match("${'a'.repeat(32)}!", /^(a+)+$/)`)})`],
  ])(
    'ADV-007 review: %s is rejected in an isolated process',
    (_kind, expression) => {
      const module = new URL('./expression.ts', import.meta.url).href;
      const compiler = pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
      const code = `import ts from ${JSON.stringify(compiler)};
      import { readFileSync } from 'node:fs'; import { registerHooks } from 'node:module';
      registerHooks({ resolve(s,c,n) { return n(s.startsWith('.') && s.endsWith('.js') ? s.slice(0,-3)+'.ts' : s,c); },
        load(u,c,n) { return u.endsWith('.ts') ? {format:'module', shortCircuit:true, source:ts.transpile(readFileSync(new URL(u),'utf8'), {module:ts.ModuleKind.ESNext})} : n(u,c); } });
      const { evaluateExpression } = await import(${JSON.stringify(module)});
      try { await evaluateExpression(${JSON.stringify(expression)}, {}, { timeoutMs: 2_000 }); process.stdout.write('accepted'); }
      catch (e) { process.stdout.write('rejected:' + e.message); }`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        timeout: 10_000,
        windowsHide: true,
        encoding: 'utf8',
      });
      expect(result.stdout).toMatch(/^rejected:.*can run without bound/);
    },
    15_000,
  );

  it.each(['truncate', 'redact', 'replace'])(
    '11: %s on an empty thread preserves input',
    async (operation) => {
      const thread = { ...sampleThread(), messages: [], vars: {} };
      const mutation =
        operation === 'truncate'
          ? { op: operation, keep: { last: 1 } }
          : operation === 'redact'
            ? { op: operation, target: 'all', patterns: ['.*'] }
            : { op: operation, target: 'messages', pattern: '.*', replacement: '' };
      const result = await applyMutations(thread, [op(mutation)], ctx);
      expect(result.thread.messages).toEqual([]);
      expect(thread.messages).toEqual([]);
    },
  );
  it('11: out-of-range set fails, inject clamps, and redact handles no/all matches', async () => {
    const thread = { ...sampleThread(), messages: [], vars: { value: 'secret' } };
    await expect(
      applyMutations(
        thread,
        [op({ op: 'set', path: '/messages/8', value: { kind: 'literal', value: 'bad' } })],
        ctx,
      ),
    ).rejects.toThrow();
    const injected = await applyMutations(
      thread,
      [op({ op: 'inject', position: 100, messages: [{ role: 'user', content: 'secret' }] })],
      ctx,
    );
    expect(injected.thread.messages).toHaveLength(1);
    const unchanged = await applyMutations(
      thread,
      [op({ op: 'redact', target: 'all', patterns: ['not-present'] })],
      ctx,
    );
    expect(unchanged.patch).toEqual([]);
    const redacted = await applyMutations(
      thread,
      [op({ op: 'redact', target: 'all', patterns: ['.+'], replacement: 'X' })],
      ctx,
    );
    expect(redacted.thread.vars).toEqual({ value: 'X' });
  });
  it.each([
    '/run/id',
    '/invocation/source',
    '/counters/usage',
    '/vars-other/x',
    '',
    '/vars~1escape',
  ])('11: immutable boundary %s is rejected without changing input', async (path) => {
    const thread = sampleThread();
    const before = structuredClone(thread);
    await expect(
      applyMutations(
        thread,
        [
          op({ op: 'set', path: '/vars/ok', value: { kind: 'literal', value: true } }),
          op({ op: 'set', path, value: { kind: 'literal', value: null } }),
        ],
        ctx,
      ),
    ).rejects.toThrow();
    expect(thread).toEqual(before);
  });
  it('11: all declared mutable roots accept a no-op delete', async () => {
    for (const root of MUTABLE_REGIONS) {
      expect(
        await planMutation(sampleThread(), op({ op: 'delete', path: `${root}/absent` }), ctx),
      ).toEqual({ kind: 'patch', patch: [] });
    }
  });
});
