# telegrapher

Code comments written like telegrams: every word pays its way.
Mechanical English. No articles, no connective filler, no jargon. Even lines.

telegrapher lists each problem comment by file and line, with broken rule and fix.
Coding agents such as Codex and Claude Code read that list and rewrite comments themselves.
Code checks: free, local. Jev: optional second opinion on jargon and restated code.
Checks only your changes. Adds nothing to repositories you contribute to.

<a href="#try-it"><img src="assets/icons/claude-code.svg" width="24" height="24" alt="" /> Claude Code</a> &nbsp;·&nbsp; <a href="#try-it"><img src="assets/icons/codex.svg" width="24" height="24" alt="" /> Codex</a> &nbsp;·&nbsp; <a href="#try-it">Other agents with a shell</a>

## What your agent receives

A real run with Jev on, against comments written the way people and models often write them:

```go
package client

import "time"

// maxTries is set to 5.
const maxTries = 5

// See https://github.com/cenkalti/backoff
var baseDelay = 100 * time.Millisecond

// Retry the request a few times; the server can still be starting up after a deploy.
// Give up after 5 tries. The wait doubles each time, so that we don't
// just hammer the server while it is busy, see docs/retries.md.
// Uses truncated exponential backoff with full jitter to avoid a thundering herd.
// https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
// Added in the last sprint and not yet enabled in production.
// Calls fetch in a loop and returns the error.
func fetchWithRetry(url string) error {
```

```text
comment-style: 2 of 3 comments need a look ($0.000084)

client.go:8  See https://github.com/cenkalti/backoff
  name_first: Start with baseDelay, the name this comment documents.
  status (Jev 87%): describes status or progress, not a lasting fact
  unexplained_source (Jev 73%): cites a source without saying what idea it takes

client.go:11  Retry the request a few times; the server can still be starting up after a deploy.
  wrapped_sentence: 1 sentence(s) continue on the next line. Keep each sentence on one line.
  semicolon: Semicolon joins two sentences. Split them.
  two_sentences: Two sentences share one line. Give each its own line.
  name_first: Start with fetchWithRetry, the name this comment documents.
  doc_path: Points to docs/retries.md. State the reason in the comment instead.
  too_long: 6 lines of text inside code, above 4. Links do not count.
  not_telegraphic: Drop where meaning survives: the ×6, a ×4, still ×1, just ×1.
  uneven_lines: Line lengths 82, 67, 61, 79, 59, 44 differ by more than 15%. Rebalance the sentences.
  jargon (Jev 81%): uses jargon where plain words would do. Jev does not say which word, and established technical terms are fine
  status (Jev 91%): describes status or progress, not a lasting fact
```

Agent rewrites, reruns and fixes what is left, until nothing is flagged:

```go
package client

import "time"

// maxTries caps attempts, so outage fails fast instead of hanging caller.
const maxTries = 5

// baseDelay is first wait between tries, doubled after each failed try.
// Doubling idea comes from cenkalti/backoff, widely used Go retry library.
// https://github.com/cenkalti/backoff
var baseDelay = 100 * time.Millisecond

// fetchWithRetry retries request up to maxTries times, since server may be starting.
// Wait between tries doubles each time, so busy server gets enough room to recover.
// Random extra wait, called jitter, keeps many clients from retrying together.
// https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
func fetchWithRetry(url string) error {
```

```text
comment-style: 0 of 3 comments need a look ($0.000083)
```

`maxTries is set to 5.` only repeats its code, yet Jev did not flag it in this run.
Jev answers with probabilities, so it misses some cases and flags some that are fine.
Code checks never vary. Treat Jev flags as leads, not verdicts.

## Before and after

Real rewrites from the [angry-carp](https://github.com/romanornr/angry-carp) MQL engine: 44 comments in one pass.
Each `-` block is the original comment. Each `+` block is the final version, which passes every check.

### Jargon becomes plain words, and the comment starts with its name

```diff
 
-// Abort on the first error, before recovery can fabricate a usable expression
-// from an unsupported clause, including in a dead branch.
+// syntaxListener stops at first error, before error recovery can invent usable expression.
+// This also covers unsupported clauses inside branches that evaluation would never reach.
 type syntaxListener struct {
```

## Try it

Needs Node 24 or newer. Run it straight from GitHub, inside any repository, with nothing to install:

```sh
npx github:romanornr/telegrapher comment-style --diff origin/main..HEAD
```

Or install the `telegrapher` command once:

```sh
npm i -g github:romanornr/telegrapher
telegrapher comment-style --diff origin/main..HEAD # comments in your commits only
telegrapher comment-style                          # comments touched by staged changes
telegrapher comment-style --file internal/foo.go   # one whole file
```

`--diff` checks only comments you added or changed, so their existing code stays their business.

### With a coding agent

Paste this into Claude Code, Codex or another agent with a shell, inside the project you are working on:

```text
Check the code comments in my changes with telegrapher.
1. From this project, run: npx github:romanornr/telegrapher comment-style --diff origin/main..HEAD
2. Rewrite each flagged comment to pass the rule it names. Keep the meaning, and never make it cryptic.
3. Run it again until nothing is flagged. Show me the comment diff before committing.
Never ask me for the Jev key or read it. If it is not set, run code checks only.
```

Give telegrapher your Jev key yourself, never through a prompt.
Run `npx github:romanornr/telegrapher auth` once in your own terminal, or set `JEV_API_KEY` in your shell profile.
If an agent wants to sign in for you, it must ask first and then run `telegrapher auth --browser`.
That opens OpenRouter in your browser, so the key goes straight to telegrapher and the agent never sees it.

## Set up a Jev key

Code checks need no key. Jev checks take one from TypeSafe or OpenRouter, saved once for every project.

```sh
telegrapher auth                                       # paste a key, or press Enter to sign in with OpenRouter
telegrapher auth --browser                             # sign in with OpenRouter in your browser
telegrapher auth --no-browser                          # SSH or container: OpenRouter shows a code to paste
pass show openrouter | telegrapher auth --stdin        # from a password manager, never typed or printed
```

Browser sign-in creates a key named `telegrapher`, which you can find and revoke in your OpenRouter dashboard.
Before it opens, telegrapher prints "Approve only if you started this", since an agent may have started it.
It never accepts a key as an argument, because arguments end up in shell history and agent transcripts.

telegrapher looks for a key in this order and names the one it uses, never the key itself:

1. `JEV_API_KEY`, to override for one run or in CI.
2. The saved key in `~/.config/telegrapher/credentials`, readable only by you.
3. `OPENROUTER_API_KEY`, which other tools share, so it never replaces a key you saved for telegrapher.

### Keep the key from Claude Code

An agent runs as you, so it can read the saved key like any of your files.
Claude Code's sandbox can mask the file: commands see a placeholder, and the real key only reaches Jev's hosts.
Add this to `~/.claude/settings.json`, since Claude Code ignores masks in a project's settings:

```json
{
  "sandbox": {
    "enabled": true,
    "network": {
      "tlsTerminate": {},
      "allowedDomains": ["openrouter.ai", "api.typesafe.ai"]
    },
    "credentials": {
      "files": [
        {
          "path": "~/.config/telegrapher/credentials",
          "mode": "mask",
          "injectHosts": ["openrouter.ai", "api.typesafe.ai"]
        }
      ]
    }
  }
}
```

On Linux and WSL2, Jev checks keep working inside the sandbox.
On macOS, Claude Code blocks the file instead, so only code checks run there.
See [Claude Code's sandbox docs](https://code.claude.com/docs/en/sandboxing#mask-credential-files).

## What it checks

It reads comments in Go, TypeScript and JavaScript. It flags. You rewrite.

Code checks run locally, free, with no account or key:

- `wrapped_sentence`: a sentence continues on the next line.
- `two_sentences`: two sentences share one line.
- `semicolon`: a semicolon joins two sentences.
- `uneven_lines`: line lengths differ by more than 15%.
- `too_long`: more than 4 lines of text inside code.
- `not_telegraphic`: two or more filler words such as "the", "a" or "just". It names them, and you decide.
- `doc_path`: points to an internal document instead of stating the reason.
- `name_first`: a Go comment does not start with the name it documents.
- `link_line`: a link sits on its own line. End the sentence it supports with a colon, then the link.

Judgment checks run only with a Jev key, from TypeSafe or OpenRouter.
See [Set up a Jev key](#set-up-a-jev-key).
[Jev](https://typesafe.ai) is TypeSafe's decision model. It answers fixed questions, never writes text.
Each answer is yes or no with a probability, so telegrapher flags only answers at 65% or above.
It is a separate model from whatever agent wrote the comment, so it does not grade its own work.
Jev is a paid service, used directly from TypeSafe or through OpenRouter, and costs a fraction of a cent per comment.
Only the comments, files and diff you pass are sent, so never pass secrets or private code.

- `jargon`: in-house shorthand or vague wording where plain words would do. Established technical terms, such as RFC 8252 or a protocol's own terms, are fine.
- `restates_code`: only repeats what the code does.
- `status`: describes rollout progress instead of a lasting fact.
- `unexplained_source`: cites a source without saying which idea it takes.

## More examples

### Uneven lines become even, one sentence per line

```diff
 
-// Diagnostic identifies a rejected construct in the original MQL, using a
-// zero-based byte offset and one-based line and Unicode column.
+// Diagnostic says why rule was rejected and where in original MQL text.
+// Offset counts bytes from zero, while Line and Column count characters from one.
 type Diagnostic struct {
```

### Semicolon splits, filler drops, name comes first

```diff
 
-// Logic evaluates the right operand only when the left does not decide the result.
-// For "and", false decides and true is neutral; "or" swaps them.
+// logic evaluates right side only when left side does not decide result.
+// For "and", false decides and true is neutral, and "or" swaps both roles.
 func (b expressionBuilder) logic(op string, left, right ast.Expr) ast.Expr {
```

### One sentence over three lines becomes four short, even ones

```diff
 
-// MQL truth values are CEL ints: 0 false, 1 true, 2 null.
-// MQL null logic differs from CEL null, so each operation is built from CEL's
-// own lazy conditionals rather than custom functions, which receive every
-// argument already evaluated. A false left operand of "and" therefore skips the right.
+// MQL truth values are stored as integers: 0 false, 1 true and 2 null.
+// MQL null logic differs from CEL's, so operations use CEL's lazy if-then-else.
+// Custom functions get every argument already evaluated, so cannot skip one.
+// False left side of "and" thus skips right side entirely, as MQL requires.
 // https://docs.sublime.security/docs/null-handling
```

### Articles and filler drop, meaning stays

```diff
 
-// Evaluate requires complete extraction for every referenced field, including
-// every link's referenced fields. This conservative precondition applies before
-// boolean short-circuiting and is separate from MQL's null semantics.
+// Evaluate needs every field rule reads, including each link's fields, before starting.
+// Missing field makes result incomplete, even in branch that would never run.
+// This check is stricter than MQL null, which covers values caller did supply.
 func (p *Program) Evaluate(ctx context.Context, message Evidence) Result {
```

## All rewrites in that pass

Every comment-only change in the engine, original against final, as `git diff` shows it.

<details>
<summary>44 rewrites</summary>

#### `mql/base64.go`

```diff
 
-// Sublime's default scanner uses standard, padded Base64 with ASCII/UTF-8
-// output and multiline joining. Candidate selection is an independent
-// implementation checked against the synthetic upstream fixtures in testdata.
-// Go's maintained encoding/base64 owns decoding, including padding validation.
+// base64Candidates finds text like Sublime's default scanner: padded alphabet, lines joined.
+// Candidate search is original code, checked against Sublime's answers on synthetic mail.
+// Go's standard encoding/base64 package decodes candidates, including padding checks.
 // https://docs.sublime.security/docs/strings-module#scan_base64
```

#### `mql/cel_functions.go`

```diff
 
-// MQL truth values are CEL ints: 0 false, 1 true, 2 null.
-// MQL null logic differs from CEL null, so each operation is built from CEL's
-// own lazy conditionals rather than custom functions, which receive every
-// argument already evaluated. A false left operand of "and" therefore skips the right.
+// MQL truth values are stored as integers: 0 false, 1 true and 2 null.
+// MQL null logic differs from CEL's, so operations use CEL's lazy if-then-else.
+// Custom functions get every argument already evaluated, so cannot skip one.
+// False left side of "and" thus skips right side entirely, as MQL requires.
 // https://docs.sublime.security/docs/null-handling
```

#### `mql/cel_functions.go`

```diff
 
-// Bind evaluates init once and names it within body, as CEL's cel.bind macro does.
+// bind evaluates init once and names value inside body, like CEL's cel.bind macro.
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/ext/bindings.go#L170-L190
-// Body receives a constructor so each use of the name is its own expression node.
+// Body gets constructor, so each use of name becomes separate expression.
 func (b expressionBuilder) bind(name string, init ast.Expr, body func(func() ast.Expr) ast.Expr) ast.Expr {
```

#### `mql/cel_functions.go`

```diff
 
-// Logic evaluates the right operand only when the left does not decide the result.
-// For "and", false decides and true is neutral; "or" swaps them.
+// logic evaluates right side only when left side does not decide result.
+// For "and", false decides and true is neutral, and "or" swaps both roles.
 func (b expressionBuilder) logic(op string, left, right ast.Expr) ast.Expr {
```

#### `mql/cel_functions.go`

```diff
 
-// Truth tables indexed by operand, so each operand appears once in the tree.
+// not uses truth table indexed by operand, so each operand appears once in tree.
 func (b expressionBuilder) not(value ast.Expr) ast.Expr {
```

#### `mql/cel_functions.go`

```diff
 
-// Exists stops at the first true predicate, following CEL's exists macro.
-// Null predicate results count as false, as Sublime's API does for any.
+// exists stops at first item whose condition is true, like CEL's exists macro.
+// Null condition counts as false, as Sublime's analyzer does for any().
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/macro.go#L578-L583
```

#### `mql/cmd/mql-engine/coverage.go`

```diff
 
-// Coverage says, per rule, whether it imports, what first stopped the parser, and what it references.
-// Gaps and completions are lexical predictions for planning. Re-importing after a change is the proof.
+// coverageReport says per rule whether it imports, what first stopped parser, and what it references.
+// Gaps and completions are lexical predictions for planning, and re-importing after changes proves them.
 type coverageReport struct {
```

#### `mql/cmd/mql-engine/coverage.go`

```diff
 
-// Both counts should stay near zero. Otherwise the gap model is missing something the compiler knows.
+// predictionMiss counts should stay near zero, or else gap model misses something compiler knows.
 type predictionMiss struct {
```

#### `mql/cmd/mql-engine/coverage.go`

```diff
 
-// Groups the parser's first error for display. Parsers stop at their first error, so later blockers stay hidden.
-// It reads ANTLR's English messages, so the labels are presentation, not stable machine codes.
+// blockerGroup labels parser's first error for display, since later errors stay hidden behind it.
+// It reads ANTLR's English messages, so these labels are for people, not stable codes.
 func blockerGroup(d *mql.Diagnostic) string {
```

#### `mql/cmd/mql-engine/main.go`

```diff
 
-// A close cannot interrupt every inherited stdin descriptor. Keep cancellation
-// independent of the read; main exits even when the OS leaves that read blocked.
+// readEvidence never makes cancellation wait, since closing stdin cannot interrupt every read.
+// main then exits even when operating system leaves that stdin read blocked forever.
 func readEvidence(ctx context.Context, input io.ReadCloser) ([]byte, error) {
```

#### `mql/collections.go`

```diff
 
-// Compiles MQL any(list, condition) into CEL loop, which counts each loop step against cost limit.
-// Each nested any gets own loop variable, so items never mix, and each loop stops at first match.
-// Only top-level any over body.links reports matching links, found by second pass over every link.
+// lowerAny turns MQL any(list, condition) into loop, and each step counts against cost limit.
+// Each nested any gets separate loop variable, and each loop stops at first matching item.
+// Only top-level any over body.links reports matching links, found by second pass over them.
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/macro.go#L517-L525
```

#### `mql/collections.go`

```diff
 
-// Supported collection operations retain their element types. Empty query maps
-// become empty arrays, so length is zero and any is false. Arbitrary JSON and
-// recursively heterogeneous arrays remain outside the imported subset.
+// lowerCollection supports collection operations that keep their element type.
+// Empty query maps become empty arrays, so length is 0 and any is false.
+// Arbitrary JSON, and arrays that mix element types, remain unsupported.
 func (c *compiler) lowerCollection(n call, iterator *iteration, depth int) (lowered, *Diagnostic) {
```

#### `mql/compile.go`

```diff
 
-// Compile rejects the whole rule if any part falls outside the supported subset.
+// Compile rejects whole rule if any part falls outside supported subset.
 func Compile(rule Rule) (*Program, *Diagnostic) {
```

#### `mql/compile.go`

```diff
 		}
-		// Checking mutates expressions. Give each executable its own tree and IDs,
-		// retaining locations when a source expression occurs in more than one place.
+		// Checking changes expressions in place, so each program gets separate copy of tree.
+		// Copies keep source locations, even when one rule expression appears in several places.
 		// https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/cel/optimizer.go#L80-L129
```

#### `mql/evaluate.go`

```diff
 
-// Outcome is a closed set of engine results. A match is not a phishing verdict.
-// The structured result design follows Protovalidate's IDs and separate failures:
+// Outcome is one of five engine results, and match is never phishing verdict.
+// Separate types for results and failures follow Protovalidate's validator design.
 // https://github.com/bufbuild/protovalidate-go/blob/8a2ad0560bc96cec15ab69092616b0e2c85733d7/validator.go#L45-L52
 type Outcome interface {
+	// Kind names the result in JSON: match, no_match, null, incomplete or evaluation_error.
 	Kind() string
```

#### `mql/evaluate.go`

```diff
 
-// When explanation fails after a decided match, the match stands with no witnesses and a failure reason.
-// Missing witnesses then mean "not explained", never that no links were involved in the match.
+// Matched means rule condition is true, and witnesses name links behind match.
+// If explanation fails, match stands with no witnesses and failure reason.
+// Missing witnesses then mean "not explained", never "no links involved".
 type Matched struct {
```

#### `mql/evaluate.go`

```diff
 
-// Outcome returns the evaluation outcome, or nil for an uninitialized result.
+// Outcome returns evaluation outcome, or nil for uninitialized result.
 func (r Result) Outcome() Outcome { return r.outcome }
 
+// MarshalJSON writes outcome with its kind, so readers can tell five results apart.
 func (r Result) MarshalJSON() ([]byte, error) {
```

#### `mql/evaluate.go`

```diff
 
-// Evaluate requires complete extraction for every referenced field, including
-// every link's referenced fields. This conservative precondition applies before
-// boolean short-circuiting and is separate from MQL's null semantics.
+// Evaluate needs every field rule reads, including each link's fields, before starting.
+// Missing field makes result incomplete, even in branch that would never run.
+// This check is stricter than MQL null, which covers values caller did supply.
 func (p *Program) Evaluate(ctx context.Context, message Evidence) Result {
```

#### `mql/evidence.go`

```diff
 
-// The evidence boundary keeps unavailable extraction distinct from an established
-// missing value. The latter is MQL null; the former prevents evaluation. No
-// provenance supplied here is independently authenticated by this evaluator.
+// Evidence separates missing value from value caller could not extract.
+// Missing value is MQL null, and rule runs anyway with that null value.
+// Value caller could not extract stops evaluation, which reports incomplete.
+// This package does not verify where any caller evidence came from.
 
```

#### `mql/evidence.go`

```diff
 
-// Every MQL path accepted by evidence protocol version 1, with its value kind.
-// Decoding, translation, and evaluation all read these tables.
+// rootFields lists fields evidence may contain, with kind of value each one holds.
+// Decoding, translation and evaluation all read this table and linkFields.
 var rootFields = map[string]valueKind{
```

#### `mql/evidence.go`

```diff
 
-// Evidence is immutable after DecodeEvidence. Its zero value has no available
-// fields; it never asserts that missing input means an absent email field.
+// Evidence holds one message's fields, and it is read-only after DecodeEvidence.
+// Its zero value supplies no fields, so every rule that reads a field is incomplete.
 type Evidence struct{ fields map[string]inputField }
```

#### `mql/evidence.go`

```diff
 
-// Reject duplicate keys, noncanonical key spelling, and deep structures.
-// encoding/json alone keeps the last duplicate, which loses evidence ambiguity.
+// checkJSON rejects duplicate keys, keys with several spellings, and deeply nested data.
+// encoding/json alone keeps last duplicate, which would hide ambiguous evidence from rules.
 func checkJSON(data []byte) error {
```

#### `mql/import.go`

```diff
 
+// MaxRuleBytes limits one rule document, the YAML file as published upstream.
 const MaxRuleBytes = 128 * 1024
 
-// ImportYAML reads one unchanged upstream detection document. Other metadata is
-// allowed, but non-detection documents are rejected rather than executed as rules.
-// The digest covers the original YAML bytes, including metadata and comments.
+// ImportYAML reads one detection rule document, exactly as published upstream.
+// Extra metadata is allowed, but documents that are not detection rules are rejected.
+// Digest covers original YAML bytes, including all metadata and YAML comments.
 func ImportYAML(data []byte, revision, path string) (*Program, string, *Diagnostic) {
```

#### `mql/import.go`

```diff
 
-// Import and coverage share this, so both read exactly one detection document by the same rules.
+// decodeRule serves import and coverage, so both accept exactly same detection documents.
 func decodeRule(data []byte) (ruleDocument, error) {
```

#### `mql/needs.go`

```diff
 
-// Needs lists what a rule references, read from MQL tokens even when grammar cannot parse the rule.
-// It is a lexical inventory for planning, not a dependency analysis or a compatibility claim.
+// Needs lists what rule refers to, read from its words even when parser rejects it.
+// It helps plan engine work, and does not prove engine can run that rule.
 type Needs struct {
```

#### `mql/needs.go`

```diff
 
-// Families whose functions depend on data or processing beyond the message fields themselves.
-// Prefixes are heuristics over Sublime function names, not a statement of where computation runs.
+// capabilityPrefixes marks rules needing more than email, such as sender history.
+// Matching by prefix is heuristic, and says nothing about where that work would run.
 var capabilityPrefixes = []struct{ prefix, capability string }{
```

#### `mql/needs.go`

```diff
 
-// Text the grammar cannot read, mapped to the documented MQL construct it belongs to.
-// Unlisted text stays in Unreadable only, since naming it would be a guess.
+// constructText maps text grammar cannot read to documented MQL construct it belongs to.
+// Unlisted text stays in Unreadable only, since naming it would be guessing.
 var constructText = map[string]string{
```

#### `mql/needs.go`

```diff
 
-// ScanNeeds inventories one MQL source. Sources larger than a rule document are refused, not truncated.
-// Unreadable text is whatever the lexer skipped between tokens, so no error message is parsed.
+// ScanNeeds inventories one MQL source, and refuses oversized sources rather than truncating.
+// Unreadable text is whatever lexer skipped between tokens, so no error message is parsed.
 func ScanNeeds(source string) (Needs, error) {
```

#### `mql/needs.go`

```diff
 			case name == "of" && call:
-				// Quorum, as in "2 of (a, b, c)": an operator, not a function.
+				// Quorum, as in "2 of (a, b, c)", is true when at least two conditions hold, so it is no function.
 				constructs["quorum_of"] = true
```

#### `mql/needs.go`

```diff
 			case name == ".":
-				// The current item of the enclosing loop, not a field.
+				// Current item of enclosing loop, not field.
 			default:
```

#### `mql/needs.go`

```diff
 
-// Skipped comments sit in the gaps between tokens too, and are not unreadable text.
+// uncommented drops skipped comments from gaps between tokens, since they are not unreadable text.
 func uncommented(gap string) string {
```

#### `mql/needs.go`

```diff
 
-// ScanYAMLNeeds scans one rule document's source. Unreadable documents return an error, never empty needs.
+// ScanYAMLNeeds scans one rule document's source, and unreadable documents return error, never empty needs.
 func ScanYAMLNeeds(data []byte) (Needs, error) {
```

#### `mql/needs.go`

```diff
 
-// Functions and fields this engine version implements, used only to predict coverage gaps.
-// Compilation stays the authority. A test compiles an example of every function listed here.
+// supportedFunctions lists functions this engine version implements, used only to predict coverage gaps.
+// Compilation stays authoritative, and tests compile an example of every function listed here.
 var supportedFunctions = set{
```

#### `mql/needs.go`

```diff
 
-// Relative paths are read inside body.links, or after recipients.to[0].
+// supportedRelativeFields are read inside body.links, or after recipients.to[0].
 var supportedRelativeFields = set{".email.email": true, ".email.domain.valid": true}
```

#### `mql/parser.go`

```diff
 
-// Diagnostic identifies a rejected construct in the original MQL, using a
-// zero-based byte offset and one-based line and Unicode column.
+// Diagnostic says why rule was rejected and where in original MQL text.
+// Offset counts bytes from zero, while Line and Column count characters from one.
 type Diagnostic struct {
```

#### `mql/parser.go`

```diff
 
-// Each invocation owns its lexer, token stream, parse tree, and diagnostics.
-// Only deliberate boundary failures are recovered; programming faults propagate.
+// parse gives each call its own lexer, token stream, parse tree and diagnostics.
+// Only expected rule failures are recovered, while programming faults panic.
 func parse(source string) (root expression, failure *Diagnostic) {
```

#### `mql/parser.go`

```diff
 
-// Abort on the first error, before recovery can fabricate a usable expression
-// from an unsupported clause, including in a dead branch.
+// syntaxListener stops at first error, before error recovery can invent usable expression.
+// This also covers unsupported clauses inside branches that evaluation would never reach.
 type syntaxListener struct {
```

#### `mql/parser.go`

```diff
 
-// Count active expression entries as CEL-Go counts active grammar rules:
+// nestingListener limits nesting depth, counted in same way as CEL-Go counts it:
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/parser.go#L201-L240
-// A single counter suffices for this non-left-recursive grammar. Parentheses,
-// calls, and repeated NOT all reenter negation before leaving the parent.
+// One counter suffices, since no grammar rule starts by referring to itself.
+// Parentheses, calls and each repeated not add one more level of nesting.
 type nestingListener struct {
```

#### `mql/parser.go`

```diff
 
-// MQL's escaped strings are not JSON or Go literals. The lexer validates the
-// escape forms; the decoder checks Unicode scalar values before constructing text.
+// stringValue decodes MQL string escapes, which differ from JSON and Go escapes.
+// Lexer checks each escape form, and this decoder rejects invalid characters.
 // https://docs.sublime.security/docs/syntax#escape-sequences
```

#### `mql/substring.go`

```diff
 
-// Dynamic needles retain the same RE2 folding as literal strings.icontains.
-// MQL's null-pattern rule is documented at:
+// lowerDynamicIContains ignores case for evidence patterns, same way as for literal patterns.
+// MQL's rule for null patterns, from Sublime's strings module docs, is linked below:
 // https://docs.sublime.security/docs/strings-module#contains--icontains
```

#### `mql/substring.go`

```diff
 
-// A quoted literal compiles to at most one rune instruction per input byte,
-// plus fixed overhead. Include compilation work as well as the input scan.
+// dynamicSubstringCost assumes one regex step per pattern byte, plus fixed amount.
+// Cost covers compiling pattern as well as scanning every byte of input text once.
 func dynamicSubstringCost(source, pattern types.String) uint64 {
```

#### `mql/syntax_tree.go`

```diff
 
-// The translator consumes only these supported syntax forms. ANTLR owns the
-// parse tree; this tree keeps MQL positions and values independent of its runtime.
+// expression is one MQL form defined here, and translator rejects every other form.
+// ANTLR, parser generator, owns raw parse tree, and this tree stays independent of it.
 type expression interface{ position() int }
```

#### `mql/translate.go`

```diff
 
-// Translate MQL syntax into CEL's own expression representation. The factory,
-// copying, ID traversal, source metadata, and checker are dependency APIs, not
-// local versions of CEL's compiler. The same APIs underpin CEL-Go policy composition:
+// Translates MQL syntax into CEL's expression tree using CEL-Go's public building blocks.
+// Those same public building blocks also power policy composer inside CEL-Go itself:
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/common/ast/factory.go#L20-L103
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/policy/composer.go#L158-L180
-// The MQL translation below is original code, not a port of Sublime's compiler.
+// MQL translation below is original code, written without any Sublime compiler source.
 import (
```

#### `mql/translate.go`

```diff
 
-// Each builder tags generated expressions with their original MQL location.
-// CEL offsets count Unicode code points; MQL diagnostics retain UTF-8 byte offsets.
+// expressionBuilder tags generated expressions with their place in original MQL text.
+// CEL counts that place in characters, while MQL diagnostics count it in bytes.
 type expressionBuilder struct {
```

</details>

## Rules

1. Newcomer first: everyday words, then why, then any technical term once.
2. One sentence per line. No semicolons.
3. Lines of similar length. A short last line reads as an afterthought.
4. Telegraphic: drop articles and filler where meaning survives. Terse, not cryptic.
5. Durable facts only. Rollout status belongs in the PR.
6. Go comments start with the name they document. `name_first` checks every declaration, and revive's `exported` rule covers exported names.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
