import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { Nodes } from 'mdast';

export type TextRange = { start: number; end: number };

export function markdownProse(text: string): { prose: string[]; ranges: TextRange[]; protectedText: string[] } {
	const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
	const ranges: TextRange[] = [];
	const protectedText: string[] = [];
	const ignored = new Set(['heading', 'code', 'inlineCode', 'html', 'definition', 'footnoteDefinition', 'table', 'image', 'imageReference']);
	function walk(node: Nodes): void {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (ignored.has(node.type)) {
			if (start !== undefined && end !== undefined) protectedText.push(text.slice(start, end));
			return;
		}
		if (node.type === 'link' || node.type === 'linkReference') {
			if (start !== undefined && end !== undefined) protectedText.push(text.slice(start, end));
			return;
		}
		if (node.type === 'text' && start !== undefined && end !== undefined) ranges.push({ start, end });
		if ('children' in node) for (const child of node.children) walk(child);
	}
	walk(tree);
	return { prose: ranges.flatMap(range => text.slice(range.start, range.end).split('\n')).filter(line => line.trim() !== ''), ranges, protectedText };
}
