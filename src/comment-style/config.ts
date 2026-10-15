import { configDirectory } from '../credentials.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { ruleNames, type Issue, type LeveledIssue, type Profile } from './comments.ts';

export type Level = 'off' | 'warning' | 'error';
export type Configuration = { profile: Profile; rules: Map<string, Level>; source: string | null };
const validRuleNames: ReadonlySet<string> = new Set(ruleNames);

export function loadConfiguration(options: { cwd?: string; home?: string; config?: string; noConfig?: boolean; profile?: string; env?: NodeJS.ProcessEnv } = {}): Configuration {
	let source: string | null = null;
	if (!options.noConfig) {
		if (options.config) source = resolve(options.cwd ?? process.cwd(), options.config);
		else {
			let directory = resolve(options.cwd ?? process.cwd());
			while (true) {
				const path = join(directory, '.telegrapher.toml');
				if (existsSync(path)) { source = path; break; }
				const parent = dirname(directory);
				if (parent === directory) break;
				directory = parent;
			}
			const home = join(configDirectory(options.env ?? process.env, options.home), 'config.toml');
			if (!source && existsSync(home)) source = home;
		}
	}
	const data = source ? parse(readFileSync(source, 'utf8')) : {};
	for (const key of Object.keys(data)) if (!['profile', 'rules'].includes(key)) throw new Error(`Unknown configuration key: ${key}`);
	const profile = options.profile ?? data.profile ?? 'general';
	if (profile !== 'general' && profile !== 'telegram') throw new Error('Profile must be general or telegram');
	const rules = new Map<string, Level>();
	if (data.rules !== undefined) {
		if (typeof data.rules !== 'object' || data.rules === null || Array.isArray(data.rules) || ![null, Object.prototype].includes(Object.getPrototypeOf(data.rules))) throw new Error('rules must be a TOML table');
		for (const [rule, level] of Object.entries(data.rules)) {
			if (!validRuleNames.has(rule)) throw new Error(`Unknown rule: ${rule}`);
			if (level !== 'off' && level !== 'warning' && level !== 'error') throw new Error(`Invalid level for ${rule}`);
			rules.set(rule, level);
		}
	}
	return { profile, rules, source };
}

export type ConfiguredIssue = LeveledIssue;

export function configuredIssues(issues: Issue[], config: Configuration, safety = false): ConfiguredIssue[] {
	return issues.flatMap(issue => {
		const level = config.rules.get(issue.rule) ?? issue.severity ?? 'error';
		return level === 'off' ? [] : [{ ...issue, severity: safety && issue.rule === 'semicolon' ? 'warning' : level }];
	});
}
