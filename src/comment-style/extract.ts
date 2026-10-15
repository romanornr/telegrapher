import { extname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser, Language, type Node } from 'web-tree-sitter';
import { codeKey, safetyLabel, type CommentBlock } from './comments.ts';
import { markdownProse } from './markdown.ts';

// The language table adapts Vale's newLanguage using node-type lists and directive regexes instead of queries.
// https://github.com/vale-cli/vale/blob/cfb21a4ce87238bcfb44b90e8e0db9e0e91d6c09/internal/lint/code/lang.go
const languages = [
	{ name: 'go', extensions: ['.go'], nodes: ['comment'], directive: /^\/\/(?:nolint|line |extern |export |[a-z0-9]+:[a-z0-9])/ },
	{ name: 'typescript', extensions: ['.ts', '.mts', '.cts'], nodes: ['comment'], directive: /^\/[/*]\s*(?:oxlint|eslint|@ts-|#region|#endregion)/ },
	{ name: 'tsx', extensions: ['.tsx'], nodes: ['comment'], directive: /^\/[/*]\s*(?:oxlint|eslint|@ts-|#region|#endregion)/ },
	{ name: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], nodes: ['comment'], directive: /^\/[/*]\s*(?:oxlint|eslint|@ts-|#region|#endregion)/ },
	{ name: 'rust', extensions: ['.rs'], nodes: ['line_comment', 'block_comment'], directive: /^\/\/(?:@|~|ignore-tidy-)/ },
];
const grammars = new Map<string, Language | Error>();
let initializationError: string | null = null;
try { await Parser.init(); } catch (error) { initializationError = error instanceof Error ? error.message : String(error); }

// Demand loading follows Neovim's language.add. Failures also stay cached until process restart.
// The public loadSync API keeps extraction synchronous after the shared runtime initializes.
// https://github.com/neovim/neovim/blob/f505b0636e0e0010f0bc13de0cd6d0978033ccb3/runtime/lua/vim/treesitter/language.lua
function grammarFor(name: string): Language {
	let grammar = grammars.get(name);
	if (grammar === undefined) {
		try {
			if (initializationError !== null) throw new Error(initializationError);
			const path = fileURLToPath(new URL(`../../vendor/grammars/tree-sitter-${name}.wasm`, import.meta.url));
			grammar = Language.loadSync(new WebAssembly.Module(readFileSync(path)));
		} catch (error) {
			grammar = new Error(`Cannot load ${name} grammar: ${error instanceof Error ? error.message : String(error)}`);
		}
		grammars.set(name, grammar);
	}
	if (grammar instanceof Error) throw grammar;
	return grammar;
}

export function supported(path: string): boolean {
	return languages.some(language => language.extensions.includes(extname(path)));
}
export type Exclusion = { line: number; endLine: number; reason: string };
export type ParseWarning = { line: number; endLine: number; reason: string };
export type Extraction = { comments: CommentBlock[]; exclusions: Exclusion[]; parseError: boolean; commentError: boolean; warnings: ParseWarning[] };

function kindOf(node: Node, rust: boolean, trailing: boolean): CommentBlock['kind'] {
	if (trailing) return 'trailing';
	const raw = node.text;
	if (rust) {
		if (node.childForFieldName('inner')) return 'doc_inner';
		if (node.childForFieldName('outer')) return 'doc_outer';
	} else if (/^\/\*\*(?!\/)/.test(raw)) return 'doc';
	return raw.startsWith('//') ? 'line' : 'block';
}

function clean(raw: string, start: number, docOffset?: number): { text: string[]; sourceMap: number[] } {
	const text: string[] = [];
	const sourceMap: number[] = [];
	let offset = 0;
	const lineComment = raw.startsWith('//');
	const rawLines = raw.split('\n');
	for (const [index, original] of rawLines.entries()) {
		let left = 0;
		let right = original.replace(/\r$/, '').length;
		if (lineComment) left = /^\s*\/\/+(?:!)? ?/.exec(original)?.[0].length ?? 0;
		else {
			if (index === 0) left = /^\/\*(?:[*!])? ?/.exec(original)?.[0].length ?? 0;
			else left = /^\s*\*(?!\/) ?/.exec(original)?.[0].length ?? 0;
			if (index === rawLines.length - 1 && original.slice(0, right).endsWith('*/')) right -= 2;
		}
		if (index === 0 && docOffset !== undefined) left = docOffset + (original[docOffset] === ' ' ? 1 : 0);
		while (right > left && /\s/.test(original[right - 1] ?? '')) right--;
		if (text.length > 0) sourceMap.push(start + offset - 1);
		text.push(original.slice(left, Math.max(left, right)));
		for (let i = left; i < right; i++) sourceMap.push(start + offset + i);
		offset += original.length + 1;
	}
	while (text[0] === '') { text.shift(); sourceMap.splice(0, 1); }
	while (text.at(-1) === '') { text.pop(); sourceMap.pop(); }
	return { text, sourceMap };
}

export function extractComments(path: string, content: string): Extraction {
	const language = languages.find(language => language.extensions.includes(extname(path)));
	if (!language) throw new Error(`Unsupported language: ${path}`);
	const grammar = grammarFor(language.name);
	const parser = new Parser();
	try {
		parser.setLanguage(grammar);
		const tree = parser.parse(content);
		if (!tree) throw new Error(`Parser produced no tree for ${path}`);
		try {
			const lines = content.split('\n');
			const following: string[][] = [];
			const keys: string[][] = [];
			following[lines.length] = [];
			keys[lines.length] = [];
			for (let index = lines.length - 1; index >= 0; index--) {
				const line = lines[index];
				following[index] = line.trim() === '' ? following[index + 1] : [line, ...following[index + 1]].slice(0, 12);
				const key = codeKey([line]);
				keys[index] = key.length === 0 ? keys[index + 1] : [...key, ...keys[index + 1]].slice(0, 40);
			}
			const firstCode = tree.rootNode.namedChildren.find(node => !language.nodes.includes(node.type) && !['package_clause', 'shebang', 'hash_bang_line'].includes(node.type));
			const nodes = tree.rootNode.descendantsOfType(language.nodes).filter(node => !node.parent || !language.nodes.includes(node.parent.type));
			// Grouping adapts Vale's coalesce, requiring the same Rust kind and containing syntax.
			// https://github.com/vale-cli/vale/blob/cfb21a4ce87238bcfb44b90e8e0db9e0e91d6c09/internal/lint/code/comments.go
			const groups: { node: Node; end: number; kind: CommentBlock['kind']; attachment: string; column: number; reason: string | null; endRow: number }[] = [];
			for (const node of nodes) {
				const raw = node.text.replace(/\r?\n$/, '');
				const end = node.startIndex + raw.length;
				const endRow = node.startPosition.row + raw.split('\n').length - 1;
				const column = node.startPosition.column;
				const trailing = (lines[node.startPosition.row] ?? '').slice(0, column).trim() !== '';
				const kind = kindOf(node, language.name === 'rust', trailing);
				const reason = trailing ? 'trailing comment' : language.directive.test(raw) ? 'tool directive' : /Licensed under|SPDX-License-Identifier/.test(raw) ? 'licence notice' : null;
				const attachment = `${node.parent?.type ?? 'root'}:${node.parent?.startIndex ?? 0}`;
				const previous = groups.at(-1);
				if (previous && raw.startsWith('//') && previous.node.text.startsWith('//') && kind !== 'trailing' && previous.kind === kind && previous.attachment === attachment && previous.column === column && previous.reason === reason && previous.endRow + 1 === node.startPosition.row) { previous.end = end; previous.endRow = endRow; }
				else groups.push({ node, end, kind, attachment, column, reason, endRow });
			}
			const comments: CommentBlock[] = [];
			const exclusions: Exclusion[] = [];
			for (const group of groups) {
				const start = group.node.startIndex;
				const raw = content.slice(start, group.end);
				const line = group.node.startPosition.row + 1;
				const endLine = line + raw.split('\n').length - 1;
				const doc = language.name === 'rust' ? group.node.childForFieldName('doc') : null;
				const cleaned = clean(raw, start, doc ? doc.startIndex - start : undefined);
				const reason = group.reason ?? (cleaned.text.length === 0 ? 'empty comment' : null);
				if (reason) { exclusions.push({ line, endLine, reason }); continue; }
				const rustdoc = language.name === 'rust' && (group.kind === 'doc_outer' || group.kind === 'doc_inner');
				const markdown = rustdoc ? markdownProse(cleaned.text.join('\n')) : { prose: cleaned.text, ranges: [], protectedText: [] };
				const seenCode = firstCode !== undefined && firstCode.startIndex < start;

				comments.push({ path, line, endLine, kind: group.kind, overview: !seenCode, goName: language.name === 'go' ? /^(?:func (?:\([^)]*\) )?|type |const |var )([\p{L}_][\p{L}\p{N}_]*)/u.exec(lines[endLine]?.trim() ?? '')?.[1] ?? null : null,
					text: cleaned.text, size: endLine - line + 1, codeAfter: following[endLine].join('\n'), codeKey: keys[endLine], folder: path.split('/').at(-2) ?? '',
					raw, startIndex: start, endIndex: group.end, sourceMap: cleaned.sourceMap, attachment: group.attachment, rustdoc, safety: language.name === 'rust' && safetyLabel(cleaned.text) !== undefined, prose: markdown.prose,
					proseRanges: markdown.ranges.map(range => ({ start: cleaned.sourceMap[range.start] ?? start, end: (cleaned.sourceMap[range.end - 1] ?? start) + 1 })), protectedText: markdown.protectedText });
			}
			if (language.name === 'rust') for (const node of tree.rootNode.descendantsOfType(['attribute_item', 'inner_attribute_item'])) {
				const literalRanges = node.descendantsOfType(['string_literal', 'raw_string_literal', 'char_literal']);
				const syntax = node.text.split('');
				for (const literal of literalRanges) for (let index = literal.startIndex - node.startIndex; index < literal.endIndex - node.startIndex; index++) syntax[index] = ' ';
				if (/\bdoc\s*=/.test(syntax.join(''))) exclusions.push({ line: node.startPosition.row + 1, endLine: node.endPosition.row + 1, reason: 'attribute-based documentation is not supported' });
			}
			const errors: Node[] = [];
			if (tree.rootNode.hasError) {
				const pending = [tree.rootNode];
				while (pending.length > 0) {
					const node = pending.pop();
					if (!node) break;
					if (node.isError || node.isMissing) errors.push(node);
					for (const child of node.children) if (child.hasError || child.isMissing) pending.push(child);
				}
			}
			const commentError = errors.some(error => nodes.some(node => error.startIndex < node.endIndex && error.endIndex > node.startIndex));
			const warnings = errors.map(node => ({ line: node.startPosition.row + 1, endLine: node.endPosition.row + 1, reason: 'Source syntax recovered outside comment ranges' }));
			return { comments, exclusions, parseError: tree.rootNode.hasError, commentError, warnings };
		} finally {
			tree.delete();
		}
	} finally {
		parser.delete();
	}
}

export function findComments(path: string, content: string): CommentBlock[] {
	return extractComments(path, content).comments;
}
