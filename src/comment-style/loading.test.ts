import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

// A disposable package beside src resolves this checkout's installed dependencies without links.
function fixture(grammars: string[], body: (root: string, env: NodeJS.ProcessEnv) => void): void {
	const root = mkdtempSync(fileURLToPath(new URL('../../.telegrapher-grammars-', import.meta.url)));
	try {
		cpSync(new URL('../', import.meta.url), join(root, 'src'), { recursive: true, filter: path => !path.endsWith('.test.ts') });
		cpSync(new URL('../../package.json', import.meta.url), join(root, 'package.json'));
		mkdirSync(join(root, 'vendor/grammars'), { recursive: true });
		for (const name of grammars) cpSync(new URL(`../../vendor/grammars/tree-sitter-${name}.wasm`, import.meta.url), join(root, `vendor/grammars/tree-sitter-${name}.wasm`));
		mkdirSync(join(root, 'home'));
		const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(root, 'home') };
		delete env.JEV_API_KEY;
		delete env.OPENROUTER_API_KEY;
		delete env.XDG_CONFIG_HOME;
		body(root, env);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const traceReads = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Parser, Language } from 'web-tree-sitter';
const reads = [];
const record = path => {
	const name = basename(path instanceof URL ? fileURLToPath(path) : String(path));
	if (/^tree-sitter-.*\\.wasm$/.test(name)) reads.push(name);
};
const readSync = fs.readFileSync;
fs.readFileSync = function(path, ...args) { record(path); return readSync.call(this, path, ...args); };
const readAsync = promises.readFile;
promises.readFile = function(path, ...args) { record(path); return readAsync.call(this, path, ...args); };
syncBuiltinESMExports();
let initializations = 0;
const init = Parser.init;
Parser.init = function(...args) { initializations++; return init.call(this, ...args); };
let loads = 0;
const loadSync = Language.loadSync;
Language.loadSync = function(module) { loads++; return loadSync.call(this, module); };
`;

function script(root: string, env: NodeJS.ProcessEnv, source: string): void {
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { cwd: root, env, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr + result.stdout);
}

test('Rust-only library calls load Rust once and never open missing unrelated grammars', () => {
	fixture(['rust'], (root, env) => {
		const module = pathToFileURL(join(root, 'src/comment-style/extract.ts')).href;
		script(root, env, `${traceReads}
const { findComments, extractComments, supported } = await import(${JSON.stringify(module)});
assert.equal(initializations, 1);
assert.deepEqual(reads, []);
assert.equal(supported('x.go'), true);
assert.equal(supported('x.ts'), true);
assert.throws(() => extractComments('x.py', '# Explanation.'), /Unsupported language/);
assert.deepEqual(reads, []);
for (let i = 0; i < 3; i++) {
	const comments = findComments('x.rs', '// Explains choice.\\nfn x() {}');
	assert.ok(Array.isArray(comments));
	assert.deepEqual(comments.map(comment => comment.text), [['Explains choice.']]);
}
assert.deepEqual(reads, ['tree-sitter-rust.wasm']);
assert.equal(loads, 1);
assert.equal(initializations, 1);
`);
	});
});

test('mixed requests load only their languages and reuse the TypeScript grammar across extensions', () => {
	fixture(['rust', 'typescript'], (root, env) => {
		const module = pathToFileURL(join(root, 'src/comment-style/check.ts')).href;
		script(root, env, `${traceReads}
const { readCommentStyle, runCommentStyle } = await import(${JSON.stringify(module)});
assert.deepEqual(reads, []);
for (const path of ['x.rs', 'x.ts', 'x.mts', 'x.cts']) {
	const request = readCommentStyle({ files: [path], draft: '// Explains choice.\\n' + (path.endsWith('.rs') ? 'fn x() {}' : 'function x() {}') });
	assert.equal(request.coverage[0].status, 'checked');
	assert.equal(request.comments.length, 1);
	assert.equal((await runCommentStyle(request, undefined)).exitCode, 0);
}
assert.deepEqual(reads, ['tree-sitter-rust.wasm', 'tree-sitter-typescript.wasm']);
assert.equal(loads, 2);
assert.equal(initializations, 1);
`);
	});
});

test('a failed needed grammar is cached without preventing other languages from being checked', () => {
	fixture(['typescript'], (root, env) => {
		const module = pathToFileURL(join(root, 'src/comment-style/check.ts')).href;
		script(root, env, `${traceReads}
const { readCommentStyle, runCommentStyle } = await import(${JSON.stringify(module)});
for (let i = 0; i < 2; i++) {
	const request = readCommentStyle({ files: ['x.rs'], draft: '// Explains choice.\\nfn x() {}' });
	assert.equal(request.coverage[0].status, 'failed');
	assert.match(request.coverage[0].reason, /Cannot load rust grammar:.*ENOENT/s);
	assert.equal((await runCommentStyle(request, undefined)).exitCode, 2);
}
const request = readCommentStyle({ files: ['x.ts'], draft: '// Explains choice.\\nfunction x() {}' });
assert.equal(request.coverage[0].status, 'checked');
assert.equal((await runCommentStyle(request, undefined)).exitCode, 0);
assert.deepEqual(reads, ['tree-sitter-rust.wasm', 'tree-sitter-typescript.wasm']);
assert.equal(loads, 1);
`);
	});
});

for (const state of ['missing', 'invalid']) {
	test(`CLI returns failed coverage and exit 2 for ${state} required grammar WASM`, () => {
		fixture([], (root, env) => {
			if (state === 'invalid') writeFileSync(join(root, 'vendor/grammars/tree-sitter-rust.wasm'), 'invalid WASM');
			const main = join(root, 'src/main.ts');
			const result = spawnSync(process.execPath, [main, 'comment-style', '--local-only', '--no-config', '--stdin', '--file', 'x.rs', '--json'], { cwd: root, env, input: '// Explains choice.\nfn x() {}', encoding: 'utf8' });
			assert.equal(result.status, 2, result.stderr + result.stdout);
			assert.match(result.stdout, /"status": "failed"/);
			assert.match(result.stdout, /Cannot load rust grammar:/);
			assert.match(result.stdout, /"exitCode": 2/);
		});
	});
}

test('Rust-only CLI succeeds when every unrelated grammar is absent', () => {
	fixture(['rust'], (root, env) => {
		const main = join(root, 'src/main.ts');
		const result = spawnSync(process.execPath, [main, 'comment-style', '--local-only', '--no-config', '--stdin', '--file', 'x.rs', '--json'], { cwd: root, env, input: '// Explains choice.\nfn x() {}', encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr + result.stdout);
		assert.match(result.stdout, /"status": "checked"/);
		assert.match(result.stdout, /"exitCode": 0/);
	});
});

for (const state of ['missing', 'invalid']) {
	test(`CLI returns failed coverage and exit 2 for ${state} shared runtime WASM`, () => {
		fixture(['rust'], (root, env) => {
			const runtime = join(root, 'node_modules/web-tree-sitter');
			cpSync(new URL('../../node_modules/web-tree-sitter', import.meta.url), runtime, { recursive: true, filter: path => !path.endsWith('.wasm') });
			if (state === 'invalid') writeFileSync(join(runtime, 'web-tree-sitter.wasm'), 'invalid WASM');
			const result = spawnSync(process.execPath, [join(root, 'src/main.ts'), 'comment-style', '--local-only', '--no-config', '--stdin', '--file', 'x.rs', '--json'], { cwd: root, env, input: '// Explains choice.\nfn x() {}', encoding: 'utf8' });
			assert.equal(result.status, 2, result.stderr + result.stdout);
			assert.match(result.stdout, /"status": "failed"/);
			assert.match(result.stdout, /Cannot load rust grammar:/);
			assert.match(result.stdout, /"exitCode": 2/);
		});
	});
}
