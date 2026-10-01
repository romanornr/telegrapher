import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { changedLines, codeIssues, findComments, rewriteIssues } from './comments.ts';

function rules(source: string): string[][] {
	return findComments('example.ts', source).map(block => codeIssues(block).map(issue => issue.rule));
}

test('passes an even, one-sentence-per-line comment inside code', () => {
	const source = [
		'const x = 1;',
		'// Compiles MQL any(list, condition) into CEL loop, which counts each loop step against cost limit.',
		'// Each nested any gets separate loop variable, keeping items apart, and each loop stops at first match.',
		'// Only top-level any over body.links reports matching links, as cel-go macro expansion does: https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/macro.go#L517-L525',
		'function lowerAny() {}',
	].join('\n');

	assert.deepEqual(rules(source), [[]]);
});

test('flags a sentence wrapped onto the next line', () => {
	const source = [
		'const x = 1;',
		'// Each MQL scope receives unique CEL binding. Evaluation stops at first true',
		'// element. Only outer loop produces witnesses.',
		'run();',
	].join('\n');

	assert.deepEqual(rules(source), [['wrapped_sentence']]);
});

test('allows lines that stay even, only grow or only shrink, and flags a zigzag', () => {
	const comment = (...lengths: number[]) => ['run();', ...lengths.map(length => `// ${'x'.repeat(length - 1)}.`), 'run();'].join('\n');
	assert.deepEqual(rules(comment(40, 60, 80)), [[]]);
	assert.deepEqual(rules(comment(80, 60, 40)), [[]]);
	assert.deepEqual(rules(comment(98, 102, 100)), [[]]);
	assert.deepEqual(rules(comment(60, 80, 40)), [['uneven_lines']]);
	assert.deepEqual(rules(comment(102, 114, 67)), [['uneven_lines']]);
	assert.deepEqual(rules(comment(99, 103, 23)), [['uneven_lines']]);
});

test('measures a line that carries a link without the link, so text crammed before it still counts', () => {
	const crammed = ['run();', '// ntpReplyChecks adds reply checks that beevik lacks, without replacing its parser.', `// Unlike beevik, it returns kiss-o'-death replies even with empty timestamps, and rejects missing receive timestamps, unlike any version so far: https://github.com/beevik/ntp/blob/953b636/ntp4.go`, '// It rejects old versions: https://github.com/systemd/systemd/blob/885fe07/timesyncd.c', 'run();'].join('\n');
	assert.deepEqual(rules(crammed), [['link_mismatch', 'too_wide', 'not_telegraphic', 'uneven_lines']]);
});

test('leaves lines that carry a link out of line balance', () => {
	const source = [
		'const x = 1;',
		'// Several reasons may appear together, and none is presented as sole cause.',
		'// Report refusals and rate limits as separate reasons, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb4/src.rs#L715',
		'run();',
	].join('\n');

	assert.deepEqual(rules(source), [[]]);
});

test('allows a link on its own line only under one or two lines of text', () => {
	const short = ['const x = 1;', '// Waits for callback, as Go context example does:', '// https://github.com/golang/go/blob/go1.27.0/src/context/example_test.go', 'run();'].join('\n');
	assert.deepEqual(rules(short), [[]]);
	const long = ['const x = 1;', '// Closing socket on cancel unblocks pending read of NTP library.', '// Library could overwrite deadline set here after dialer returns.', '// Closing via callback follows Go context example for connections.', '// https://github.com/golang/go/blob/go1.27.0/src/context/example_test.go', 'run();'].join('\n');
	assert.deepEqual(rules(long), [['link_line']]);
	assert.deepEqual(rules('run();\n// https://example.com/spec\nrun();'), [['link_line']]);
	assert.deepEqual(rules('run();\n// Reply parsing follows beevik and systemd:\n// https://github.com/beevik/ntp/blob/953b636/ntp4.go\n// https://github.com/systemd/systemd/blob/885fe07/timesyncd.c\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Reject stale replies.\n// Clock policy follows example sources:\n// https://example.com/a\n// https://example.com/b\nrun();'), [['link_line', 'uneven_lines']]);
});

test('flags a link that does not end its line, or follows text without a colon', () => {
	assert.deepEqual(rules('run();\n// Follow https://example.com/spec when replies arrive.\nrun();'), [['link_last', 'link_colon', 'link_mismatch']]);
	assert.deepEqual(rules('run();\n// Reject stale replies, as spec asks https://example.com/spec\nrun();'), [['link_colon']]);
	assert.deepEqual(rules('run();\n// Reject stale replies, as spec asks: https://example.com/spec.\nrun();'), [[]]);
});

test('counts whole links, and leaves words inside links out of other checks', () => {
	assert.deepEqual(rules('run();\n// Login follows OpenRouter: https://openrouter.ai/auth?next=https://openrouter.ai/the/a/done\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Reject stale replies, as spec asks: https://example.com/spec;v=2\nrun();'), [[]]);
});

test('a line ending in a link ends its sentence', () => {
	const source = ['run();', '// Back off on RATE replies, as RFC 5905 asks: https://www.rfc-editor.org/rfc/rfc5905#section-7.4', '// ntpd-rs backs off on RATE replies same way: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb4d5b6cb24f814f5543d85b9138afb4cba/ntp-proto/src/source.rs#L715', 'run();'].join('\n');
	assert.deepEqual(rules(source), [[]]);
});

test('an unclosed fence hides nothing', () => {
	assert.deepEqual(rules('run();\n// ```\n// Flags, not counts; several apply.\nrun();'), [['semicolon']]);
});

test('flags a link followed by more text, but not a tail of source lines', () => {
	const middle = ['const x = 1;', '// Separating results from alarms follows sfptpd: https://github.com/Xilinx-CNS/sfptpd/blob/5ac5b58/src/sfptpd_engine.c#L2032', '// Previous clock error stays open across unknown results, which never count as recovery.', 'run();'].join('\n');
	assert.deepEqual(rules(middle), [['link_last', 'uneven_lines']]);
	const tail = ['const x = 1;', '// Login flow is adapted from pi: https://github.com/earendil-works/pi/blob/8ce69e9/openrouter.ts', '// Callback server is adapted from pi too: https://github.com/earendil-works/pi/blob/8ce69e9/callback-server.ts', 'run();'].join('\n');
	assert.deepEqual(rules(tail), [[]]);
});

test('flags semicolons outside code spans, doc paths and ADR numbers', () => {
	assert.deepEqual(rules('run();\n// Flags, not counts; several apply.\nrun();'), [['semicolon']]);
	assert.deepEqual(rules('run();\n// Flags, not counts;several apply.\nrun();'), [['semicolon']]);
	assert.deepEqual(rules('run();\n// Rejects input containing "x; y".\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Joins with `a; b` inside code.\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// See docs/adr/0013-route.md for policy.\nrun();'), [['doc_path']]);
	assert.deepEqual(rules('run();\n// ADR 0013 explains this.\nrun();'), [['doc_path']]);
});

test('limits comments inside code to three lines of text, but not overviews or doc comments', () => {
	const three = ['// One line of text here.', '// Two lines of text here.', '// Tri lines of text here.'].join('\n');
	const four = [three, '// Four line of text here.'].join('\n');

	assert.deepEqual(rules(`run();\n${three}\nrun();`), [[]]);
	assert.deepEqual(rules(`run();\n${four}\nrun();`), [['too_long']]);
	assert.deepEqual(rules(`${four}\nrun();`), [[]]);
	assert.deepEqual(rules(`run();\n/**\n${four.replaceAll('//', ' *')}\n */\nrun();`), [[]]);
});

test('flags two links on one line, but not one link per sentence at the end', () => {
	const shared = ['const x = 1;', '// Rejects old versions and parses replies: https://github.com/systemd/systemd/blob/885fe07/timesyncd.c https://github.com/beevik/ntp/blob/953b636/ntp4.go', 'run();'].join('\n');
	assert.deepEqual(rules(shared), [['link_mismatch', 'link_count']]);
	const each = ['const x = 1;', '// Parsing stays in beevik, which lacks these checks: https://github.com/beevik/ntp/blob/953b636/ntp4.go', '// Rejects old NTP versions, as systemd-timesyncd does: https://github.com/systemd/systemd/blob/885fe07/timesyncd.c', 'run();'].join('\n');
	assert.deepEqual(rules(each), [[]]);
});

test('flags a line over 120 characters of text, not counting links', () => {
	assert.deepEqual(rules(`run();\n// ${'x'.repeat(120)}.\nrun();`), [['too_wide']]);
	assert.deepEqual(rules(`run();\n// beevik ${'x'.repeat(93)}: https://github.com/beevik/ntp/blob/953b63646f5273d44de88b68e5862ad155ed4660/ntp4.go#L262\nrun();`), [[]]);
});

test('with a link, lines must widen toward the link line, measured with the link', () => {
	const url = 'https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb4d5b6cb24f814f5543d85b9138afb4cba/ntp-proto/src/source.rs#L715';
	const good = ['run();', '// Report rate-limit requests and refusals as separate reasons, as ntpd-rs', '// Several reasons may appear together, and none is presented as sole cause', `// ${url}`, 'run();'].join('\n');
	const bad = ['run();', '// Report rate-limit requests and refusals as separate reasons, as ntpd-rs does', '// Several reasons may appear together, and none is presented as sole cause', `// ${url}`, 'run();'].join('\n');
	assert.deepEqual(rules(good), [[]]);
	assert.deepEqual(rules(bad), [['uneven_lines']]);
});

test('flags a colon touching a link', () => {
	assert.deepEqual(rules('run();\n// Checks are missing from beevik v1.6.0:https://github.com/beevik/ntp\nrun();'), [['link_space']]);
	assert.deepEqual(rules('run();\n// Checks are missing from beevik v1.6.0: https://github.com/beevik/ntp\nrun();'), [[]]);
});

test('marks comments before code as overviews, allowing a Go package clause', () => {
	const blocks = findComments('example.go', '// Package overview.\npackage mql\n\nimport "fmt"\n\n// Inside code.\nfunc x() {}');

	assert.deepEqual(blocks.map(block => [block.line, block.overview]), [[1, true], [6, false]]);
});

test('skips tool directives and licence notices', () => {
	assert.deepEqual(findComments('example.ts', '// oxlint-disable-next-line no-console\nrun();\n// Licensed under the Apache License, Version 2.0.\nrun();'), []);
});

test('maps zero-context diff hunks to the new file line numbers', () => {
	const diff = ['+++ b/tools/a.ts', '@@ -3,0 +4,2 @@', '+x', '+y', '@@ -10 +12 @@', '+z', '+++ /dev/null', '@@ -1 +0,0 @@'].join('\n');

	assert.deepEqual([...changedLines(diff)].map(([path, lines]) => [path, [...lines]]), [['tools/a.ts', [4, 5, 12]]]);
	assert.deepEqual([...changedLines(['+++ b/x.go', '@@ -5 +4,0 @@'].join('\n'))].map(([path, lines]) => [path, [...lines]]), [['x.go', [4, 5]]]);
});

// Stays free of imports, so the rules can move to their own package without Jev or git.
test('comment rules import nothing', async () => {
	const source = await readFile(new URL('comments.ts', import.meta.url), 'utf8');

	assert.doesNotMatch(source, /^import /m);
});

test('flags articles and filler for telegraphic style, ignoring code spans and quotes', () => {
	assert.deepEqual(rules('run();\n// Evaluates the right side only when the left side does not decide.\nrun();'), [['not_telegraphic']]);
	assert.deepEqual(rules('run();\n// Evaluates right side only when left side does not decide.\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Returns `the a` or "the an", never empty string.\nrun();'), [[]]);
	const [block] = findComments('x.ts', 'run();\n// The cost of the search is just a guess.\nrun();');
	assert.equal(block === undefined ? '' : codeIssues(block).find(issue => issue.rule === 'not_telegraphic')?.detail, 'Drop where meaning survives: the ×2, just ×1, a ×1.');
	const [phrases] = findComments('x.ts', 'run();\n// Retry at once, for example after timeout, so callers can see it.\nrun();');
	assert.equal(phrases === undefined ? '' : codeIssues(phrases).find(issue => issue.rule === 'not_telegraphic')?.detail, 'Drop where meaning survives: at once ×1, for example ×1, so ×1, can ×1.');
	assert.deepEqual(rules('run();\n// Just retry.\nrun();'), [['not_telegraphic']]);
	assert.deepEqual(rules('run();\n// Wait for reply.\nrun();'), [[]]);
});

test('allows two sentences on one line when that evens out shape', () => {
	const source = ['run();', '// Treat RATE, DENY and RSTR replies as refusals from one server, never as evidence about local clock.', '// Other servers keep voting: one refusing server lowers agreement count, never shifts clock offset. Retry next check.', 'run();'].join('\n');
	assert.deepEqual(rules(source), [[]]);
});

test('Go comments start with the name declared below them', () => {
	const source = 'package mql\n\n// Turns any into loop.\nfunc lowerAny() {}\n\n// lowerAll turns all into loop.\nfunc lowerAll() {}\n\n// Kind returns match.\nfunc (Matched) Kind() string { return "" }\n\n// Groups of values.\nconst (\n\tx = 1\n)\n';
	assert.deepEqual(findComments('x.go', source).map(block => codeIssues(block).map(issue => issue.rule)), [['name_first'], [], [], []]);
	assert.deepEqual(findComments('x.ts', '// Turns any into loop.\nfunction lowerAny() {}\n').map(block => block.goName), [null]);
	assert.deepEqual(findComments('x.go', 'package x\n\n/* Work handles requests. */\nfunc Work() {}\n').map(block => codeIssues(block).map(issue => issue.rule)), [[]]);
});

test('doc_path leaves out the period that ends the sentence', () => {
	const [block] = findComments('x.ts', 'run();\n// Retries are explained in docs/retries.md.\nrun();');
	assert.equal(block === undefined ? '' : codeIssues(block).find(issue => issue.rule === 'doc_path')?.detail, 'Points to docs/retries.md. State the reason in the comment instead.');
});

test('compares a rewrite with its committed version for added or dropped links and extra lines', () => {
	const before = ['Rate limits stay separate reasons, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715'];
	const rule = (text: string[]) => rewriteIssues(text, before).map(issue => issue.rule);

	assert.deepEqual(rule(['Rate limits and refusals stay separate, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715.']), []);
	assert.deepEqual(rule(['Rate limits stay separate reasons.']), ['link_dropped']);
	assert.deepEqual(rule(['Rate limits stay separate, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715', 'See RFC 8633: https://www.rfc-editor.org/rfc/rfc8633']), ['link_added', 'grew']);
	assert.deepEqual(rule(['Rate limits stay separate reasons, as ntpd-rs does: <https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715>']), []);
	assert.deepEqual(rule(['Rate limits stay', '', 'separate reasons, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715']), ['grew', 'summary_moved']);
	assert.deepEqual(rewriteIssues(['Rate limits stay separate.'], ['Rate limits stay separate.'], new Set(), { now: 3, before: 1 }).map(issue => issue.rule), ['grew']);
	assert.deepEqual(rule(['Rate limits: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715', 'Stay separate reasons, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715']), ['link_added', 'grew', 'summary_moved']);
});

test('lets a rewrite add only the lines that give each shared link its own line', () => {
	const before = ['Back off on RATE replies as RFC 5905 and ntpd-rs do: https://www.rfc-editor.org/rfc/rfc5905#section-7.4 https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715'];
	const split = ['Back off on RATE replies, as RFC 5905 asks: https://www.rfc-editor.org/rfc/rfc5905#section-7.4', 'ntpd-rs backs off on RATE replies same way: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715'];
	assert.deepEqual(rewriteIssues(split, before).map(issue => issue.rule), []);
	assert.deepEqual(rewriteIssues([...split, 'Retry next check.'], before).map(issue => issue.rule), ['grew']);
});

test('flags a rewrite that moves the summary line down', () => {
	const before = ['Report rate limits and refusals as separate reasons, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715', 'Several reasons may appear together.'];
	const moved = ['Several reasons may appear together.', 'Report rate limits and refusals as separate reasons, as ntpd-rs does: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715'];
	assert.deepEqual(rewriteIssues(moved, before).map(issue => issue.rule), ['summary_moved']);
	const linkMoved = ['Report rate limits and refusals as separate reasons, as ntpd-rs does', 'Several reasons may appear together: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/source.rs#L715'];
	assert.deepEqual(rewriteIssues(linkMoved, before).map(issue => issue.rule), []);
});

test('flags a link ending a sentence that never names its source', () => {
	const wrong = ['run();', "// One query per server every 15 minutes respects NIST's 4-second spacing", "// NICT's 20 queries an hour: https://tf.nist.gov/tf-cgi/servers.cgi", 'run();'].join('\n');
	assert.deepEqual(rules(wrong).flat().includes('link_mismatch'), true);
	const right = ['run();', "// One query per server every 15 minutes respects NIST's 4-second spacing: https://tf.nist.gov/tf-cgi/servers.cgi", "// Same pace also stays far below NICT's stated limit of 20 queries per hour: https://www.nict.go.jp/en/sts/ntp_faq.html", 'run();'].join('\n');
	assert.deepEqual(rules(right), [[]]);
	assert.deepEqual(rules('run();\n// Back off on RATE replies, as RFC 5905 asks: https://www.rfc-editor.org/rfc/rfc5905#section-7.4\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Back off on RATE replies, as RFC 5905 asks: https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb/ntp-proto/src/source.rs#L715\nrun();'), [['link_mismatch']]);
	const bare = ['run();', '// Report rate-limit requests and refusals as separate reasons, as ntpd-rs', '// Several reasons may appear together, and none is presented as sole cause', '// https://github.com/pendulum-project/ntpd-rs/blob/46ec9bb4d5b6cb24f814f5543d85b9138afb4cba/ntp-proto/src/source.rs#L715', 'run();'].join('\n');
	assert.deepEqual(rules(bare), [[]]);
	assert.deepEqual(rules("run();\n// NTP Pool's once-an-hour rule is about replacing servers: https://www.ntppool.org/en/vendors.html\nrun();"), [[]]);
});

test('second review: crowded lines, autolinks, char literals, reworded summaries and unsplit links', () => {
	assert.deepEqual(rules('run();\n// Retry twice. Wait briefly. Reject failures.\nrun();'), [['crowded_line']]);
	assert.deepEqual(rules('run();\n// Retry twice. Reject failures.\nrun();'), [[]]);
	assert.deepEqual(rules('run();\n// Match RFC 5905 protocol: <https://www.rfc-editor.org/rfc/rfc5905>\nrun();'), [[]]);
	assert.deepEqual(rules("run();\n// Delimiter is ';'.\nrun();"), [[]]);

	const before = ['shouldOpenBrowser guesses whether browser can open here, so SSH and CI get code to paste.', 'Copied from gemini-cli, which adapted it from Google Cloud SDK.'];
	const reworded = ['Copied from gemini-cli, which adapted it from Google Cloud SDK.', 'shouldOpenBrowser guesses whether browser opens here, giving SSH and CI users code to paste'];
	assert.deepEqual(rewriteIssues(reworded, before).map(issue => issue.rule), ['summary_moved']);

	const shared = ['Back off as RFC 5905 and ntpd-rs do: https://www.rfc-editor.org/rfc/rfc5905 https://github.com/pendulum-project/ntpd-rs'];
	const unsplit = ['Back off as RFC 5905 and ntpd-rs do.', 'Both agree: https://www.rfc-editor.org/rfc/rfc5905 https://github.com/pendulum-project/ntpd-rs'];
	assert.deepEqual(rewriteIssues(unsplit, shared).map(issue => issue.rule), ['grew']);
});
