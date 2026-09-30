# comment-style

<!-- Draft README for a possible separate repo. Examples below are real
rewrites from angry-carp commit 8fec1ed (parent 411bdc8), in mql/.
Telegraphic examples are real rewrites from the pass after ac149d0. Keep Jev accuracy numbers out: TypeSafe's terms
forbid publishing benchmarks of the service. -->

Code comments a newcomer can read. Even lines, plain words, no filler.

`comment-style` finds comments in Go, TypeScript and JavaScript, and flags:

- **Code checks, free and exact:** semicolons joining two sentences, lines of very different length, links to internal docs.
- **Judgment checks, asked to Jev:** jargon a newcomer would need to look up, comments that only repeat the code, rollout status instead of lasting facts, sources without a reason.

It flags. You rewrite.

## Before and after

### Uneven lines and jargon become four even sentences

```diff
-// MQL truth values are CEL ints: 0 false, 1 true, 2 null.
-// MQL null logic differs from CEL null, so each operation is built from CEL's
-// own lazy conditionals rather than custom functions, which receive every
-// argument already evaluated. A false left operand of "and" therefore skips the right.
+// MQL truth values are stored as integers, where 0 is false, 1 is true and 2 is null.
+// MQL null logic differs from CEL's own, so each operation uses CEL's lazy if-then-else.
+// A custom function would get every argument already evaluated, so it could never skip one.
+// This way a false left side of "and" skips the right side entirely, as MQL requires.
 // https://docs.sublime.security/docs/null-handling
 import (
```

Before: lines of 58 to 87 characters, one sentence spread over three lines, "operand".
After: one sentence per line, 86 to 92 characters.

### Jargon becomes plain words

```diff
-// Diagnostic identifies a rejected construct in the original MQL, using a
-// zero-based byte offset and one-based line and Unicode column.
+// Diagnostic says why a rule was rejected and where in the original MQL text.
+// Offset counts bytes from zero, while Line and Column count characters from one.
 type Diagnostic struct {
```

```diff
-// Abort on the first error, before recovery can fabricate a usable expression
-// from an unsupported clause, including in a dead branch.
+// Stops at the first error, before error recovery can invent a usable expression.
+// This also covers unsupported clauses in branches that would never run.
 type syntaxListener struct {
```

### Semicolon splits into sentences

```diff
-// Logic evaluates the right operand only when the left does not decide the result.
-// For "and", false decides and true is neutral; "or" swaps them.
+// Logic evaluates the right side only when the left side does not decide the result.
+// For "and", false decides and true is neutral, and for "or" the two swap roles.
 func (b expressionBuilder) logic(op string, left, right ast.Expr) ast.Expr {
```

### Telegraphic: drop articles and filler

```diff
-// When explanation fails after a decided match, the match stands with no witnesses and a failure reason.
-// Missing witnesses then mean "not explained", never that no links were involved in the match.
+// Matched means rule condition is true. Witnesses name links behind match.
+// If explanation fails, match stands with no witnesses and failure reason.
+// Missing witnesses then mean "not explained", never "no links involved".
 type Matched struct {
```

Also fixes Go's rule that a doc comment starts with the name it documents.

Second pass, after the `not_telegraphic` check flagged the first example (real, angry-carp after `ac149d0`):

```diff
-// MQL truth values are stored as integers, where 0 is false, 1 is true and 2 is null.
-// MQL null logic differs from CEL's own, so each operation uses CEL's lazy if-then-else.
-// A custom function would get every argument already evaluated, so it could never skip one.
-// This way a false left side of "and" skips the right side entirely, as MQL requires.
+// MQL truth values are stored as integers: 0 false, 1 true and 2 null.
+// MQL null logic differs from CEL's, so operations use CEL's lazy if-then-else.
+// Custom functions get every argument already evaluated, so cannot skip one.
+// False left side of "and" thus skips right side entirely, as MQL requires.
 // https://docs.sublime.security/docs/null-handling
 import (
```

Flag was `own ×1, a ×2, the ×1`. Package overview, flagged `a ×6, the ×5`:

```diff
-// Package mql runs Sublime Security's email detection rules offline, one rule at a time.
-// Rules are written in MQL, Sublime's Message Query Language, as one condition per rule.
-// The engine parses a rule, translates it to CEL, Google's expression language, and runs it.
-// Input is evidence: email fields the caller already extracted, never the raw message.
-// A witness names the links that made a rule match, so a person can check the reason.
-// Results are match, no match, null, incomplete or evaluation error, never a phishing verdict.
+// Package mql runs Sublime Security's email detection rules offline, one by one.
+// Rules are written in MQL, Sublime's Message Query Language, one condition per rule.
+// Engine parses each rule, translates it to CEL, Google's expression language, and runs it.
+// Input is evidence: email fields caller already extracted, never raw email message.
+// Witness names links that made rule match, so people can verify why it matched.
+// Results are match, no match, null, incomplete or evaluation error, never phishing verdict.
 package mql
```

Three passes on one comment, so the README can show the whole path:

```diff
 // 1. Original: uneven, one sentence over three lines, "operand"
 // 2. Plain words, one sentence per line, even lengths
 // 3. Telegraphic: articles and filler dropped
```

## All rewrites in that commit

Every comment-only change in `mql/` between angry-carp `411bdc8` and `8fec1ed`, as `git diff` shows it.

<details>
<summary>31 rewrites</summary>

#### `mql/base64.go`

```diff
 
-// Sublime's default scanner uses standard, padded Base64 with ASCII/UTF-8
-// output and multiline joining. Candidate selection is an independent
-// implementation checked against the synthetic upstream fixtures in testdata.
-// Go's maintained encoding/base64 owns decoding, including padding validation.
+// Sublime's default Base64 scanner uses the standard padded alphabet and joins lines first.
+// Finding candidates is our own code, checked against Sublime's answers for synthetic messages.
+// Go's standard encoding/base64 package does the decoding, including checking the padding.
 // https://docs.sublime.security/docs/strings-module#scan_base64
```

#### `mql/cel_functions.go`

```diff
 
-// MQL truth values are CEL ints: 0 false, 1 true, 2 null.
-// MQL null logic differs from CEL null, so each operation is built from CEL's
-// own lazy conditionals rather than custom functions, which receive every
-// argument already evaluated. A false left operand of "and" therefore skips the right.
+// MQL truth values are stored as integers, where 0 is false, 1 is true and 2 is null.
+// MQL null logic differs from CEL's own, so each operation uses CEL's lazy if-then-else.
+// A custom function would get every argument already evaluated, so it could never skip one.
+// This way a false left side of "and" skips the right side entirely, as MQL requires.
 // https://docs.sublime.security/docs/null-handling
```

#### `mql/cel_functions.go`

```diff
 
-// Bind evaluates init once and names it within body, as CEL's cel.bind macro does.
+// Bind evaluates init once and names the value inside body, like CEL's cel.bind macro.
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/ext/bindings.go#L170-L190
-// Body receives a constructor so each use of the name is its own expression node.
+// Body gets a constructor, so each use of the name becomes its own expression.
 func (b expressionBuilder) bind(name string, init ast.Expr, body func(func() ast.Expr) ast.Expr) ast.Expr {
```

#### `mql/cel_functions.go`

```diff
 
-// Logic evaluates the right operand only when the left does not decide the result.
-// For "and", false decides and true is neutral; "or" swaps them.
+// Logic evaluates the right side only when the left side does not decide the result.
+// For "and", false decides and true is neutral, and for "or" the two swap roles.
 func (b expressionBuilder) logic(op string, left, right ast.Expr) ast.Expr {
```

#### `mql/cel_functions.go`

```diff
 
-// Exists stops at the first true predicate, following CEL's exists macro.
-// Null predicate results count as false, as Sublime's API does for any.
+// Exists stops at the first item whose condition is true, like CEL's exists macro.
+// A null condition counts as false, as Sublime's analyzer does for any().
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/macro.go#L578-L583
```

#### `mql/cmd/mql-engine/coverage.go`

```diff
 
-// Groups the parser's first error for display. Parsers stop at their first error, so later blockers stay hidden.
-// It reads ANTLR's English messages, so the labels are presentation, not stable machine codes.
+// Groups the parser's first error for display, since later errors stay hidden behind it.
+// It reads ANTLR's English messages, so these labels are for people, not stable codes.
 func blockerGroup(d *mql.Diagnostic) string {
```

#### `mql/cmd/mql-engine/main.go`

```diff
 
-// A close cannot interrupt every inherited stdin descriptor. Keep cancellation
-// independent of the read; main exits even when the OS leaves that read blocked.
+// Closing stdin cannot interrupt every read, so cancellation never waits for the read.
+// main exits even when the operating system leaves that stdin read blocked forever.
 func readEvidence(ctx context.Context, input io.ReadCloser) ([]byte, error) {
```

#### `mql/collections.go`

```diff
 
-// Compiles MQL any(list, condition) into CEL loop, which counts each loop step against cost limit.
-// Each nested any gets own loop variable, so items never mix, and each loop stops at first match.
-// Only top-level any over body.links reports matching links, found by second pass over every link.
+// Turns MQL any(list, condition) into a loop, and each loop step counts against the cost limit.
+// Each nested any gets its own loop variable, and each loop stops at the first matching item.
+// Only a top-level any over body.links reports matching links, found by a second pass over them.
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/macro.go#L517-L525
```

#### `mql/collections.go`

```diff
 
-// Supported collection operations retain their element types. Empty query maps
-// become empty arrays, so length is zero and any is false. Arbitrary JSON and
-// recursively heterogeneous arrays remain outside the imported subset.
+// Supported collection operations keep the type of their elements.
+// Empty query maps become empty arrays, so length is 0 and any is false.
+// Arbitrary JSON and arrays that mix element types are not supported.
 func (c *compiler) lowerCollection(n call, iterator *iteration, depth int) (lowered, *Diagnostic) {
```

#### `mql/compile.go`

```diff
 		}
-		// Checking mutates expressions. Give each executable its own tree and IDs,
-		// retaining locations when a source expression occurs in more than one place.
+		// Checking changes expressions in place, so each program gets its own copy of the tree.
+		// Copies keep source locations, even when one rule expression appears in several places.
 		// https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/cel/optimizer.go#L80-L129
```

#### `mql/evaluate.go`

```diff
 
-// Outcome is a closed set of engine results. A match is not a phishing verdict.
-// The structured result design follows Protovalidate's IDs and separate failures:
+// Outcome is one of five engine results, and a match is never a phishing verdict.
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
+// Matched means rule condition is true. Witnesses name links behind match.
+// If explanation fails, match stands with no witnesses and failure reason.
+// Missing witnesses then mean "not explained", never "no links involved".
 type Matched struct {
```

#### `mql/evaluate.go`

```diff
 
-// Evaluate requires complete extraction for every referenced field, including
-// every link's referenced fields. This conservative precondition applies before
-// boolean short-circuiting and is separate from MQL's null semantics.
+// Evaluate needs every field the rule reads, including each link's fields, before it starts.
+// A missing field makes the result incomplete, even in a branch that would never run.
+// This check is stricter than MQL null, which covers values the caller did supply.
 func (p *Program) Evaluate(ctx context.Context, message Evidence) Result {
```

#### `mql/evidence.go`

```diff
 
-// The evidence boundary keeps unavailable extraction distinct from an established
-// missing value. The latter is MQL null; the former prevents evaluation. No
-// provenance supplied here is independently authenticated by this evaluator.
+// Evidence separates a missing value from a value the caller could not extract.
+// A missing value is MQL null, and the rule still runs with that null value.
+// A value the caller could not extract stops evaluation, which reports incomplete.
+// This package does not verify where any of the caller's evidence came from.
 
```

#### `mql/evidence.go`

```diff
 
-// Every MQL path accepted by evidence protocol version 1, with its value kind.
-// Decoding, translation, and evaluation all read these tables.
+// Fields the evidence may contain, with the kind of value each one holds.
+// Decoding, translation and evaluation all read these same two tables.
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
+// Reject duplicate keys, keys that can be spelled more than one way, and deeply nested data.
 // encoding/json alone keeps the last duplicate, which loses evidence ambiguity.
```

#### `mql/import.go`

```diff
 
+// MaxRuleBytes limits one rule document, the YAML file as published upstream.
 const MaxRuleBytes = 128 * 1024
 
-// ImportYAML reads one unchanged upstream detection document. Other metadata is
-// allowed, but non-detection documents are rejected rather than executed as rules.
+// ImportYAML reads one detection rule document, exactly as published upstream.
+// Extra metadata is allowed, but documents that are not detection rules are rejected.
 // The digest covers the original YAML bytes, including metadata and comments.
```

#### `mql/needs.go`

```diff
 
-// Needs lists what a rule references, read from MQL tokens even when grammar cannot parse the rule.
-// It is a lexical inventory for planning, not a dependency analysis or a compatibility claim.
+// Needs lists what a rule refers to, read from its words even when the parser rejects it.
+// It helps plan engine work, and it does not prove the engine can run the rule.
 type Needs struct {
```

#### `mql/needs.go`

```diff
 
-// Families whose functions depend on data or processing beyond the message fields themselves.
-// Prefixes are heuristics over Sublime function names, not a statement of where computation runs.
+// Function name prefixes for rules that need more than the email, such as sender history.
+// Matching by prefix is a heuristic, and says nothing about where that work would run.
 var capabilityPrefixes = []struct{ prefix, capability string }{
```

#### `mql/needs.go`

```diff
 			case name == "of" && call:
-				// Quorum, as in "2 of (a, b, c)": an operator, not a function.
+				// Quorum, as in "2 of (a, b, c)", is true when at least two conditions hold, so it is no function.
 				constructs["quorum_of"] = true
```

#### `mql/parser.go`

```diff
 
-// Diagnostic identifies a rejected construct in the original MQL, using a
-// zero-based byte offset and one-based line and Unicode column.
+// Diagnostic says why a rule was rejected and where in the original MQL text.
+// Offset counts bytes from zero, while Line and Column count characters from one.
 type Diagnostic struct {
```

#### `mql/parser.go`

```diff
 
-// Each invocation owns its lexer, token stream, parse tree, and diagnostics.
-// Only deliberate boundary failures are recovered; programming faults propagate.
+// Each call owns its lexer, token stream, parse tree and diagnostics.
+// Only expected rule failures are recovered, and programming faults still panic.
 func parse(source string) (root expression, failure *Diagnostic) {
```

#### `mql/parser.go`

```diff
 
-// Abort on the first error, before recovery can fabricate a usable expression
-// from an unsupported clause, including in a dead branch.
+// Stops at the first error, before error recovery can invent a usable expression.
+// This also covers unsupported clauses in branches that would never run.
 type syntaxListener struct {
```

#### `mql/parser.go`

```diff
 
-// Count active expression entries as CEL-Go counts active grammar rules:
+// Limits nesting depth, counted in the same way that CEL-Go counts it:
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/parser/parser.go#L201-L240
-// A single counter suffices for this non-left-recursive grammar. Parentheses,
-// calls, and repeated NOT all reenter negation before leaving the parent.
+// One counter is enough, since this grammar never refers to itself on the left.
+// Parentheses, calls and repeated not each count as one more level of nesting.
 type nestingListener struct {
```

#### `mql/parser.go`

```diff
 
-// MQL's escaped strings are not JSON or Go literals. The lexer validates the
-// escape forms; the decoder checks Unicode scalar values before constructing text.
+// Escapes in MQL strings differ from both JSON escapes and Go string escapes.
+// The lexer checks each escape form, and this decoder rejects invalid characters.
 // https://docs.sublime.security/docs/syntax#escape-sequences
```

#### `mql/substring.go`

```diff
 
-// Dynamic needles retain the same RE2 folding as literal strings.icontains.
-// MQL's null-pattern rule is documented at:
+// Patterns taken from evidence fields ignore case the same way literal patterns do.
+// MQL's rule for null patterns is documented at the Sublime link below:
 // https://docs.sublime.security/docs/strings-module#contains--icontains
```

#### `mql/substring.go`

```diff
 
-// A quoted literal compiles to at most one rune instruction per input byte,
-// plus fixed overhead. Include compilation work as well as the input scan.
+// A quoted literal compiles to at most one regex step per input byte, plus a fixed amount.
+// The cost covers compiling the pattern as well as scanning all of the input text.
 func dynamicSubstringCost(source, pattern types.String) uint64 {
```

#### `mql/syntax_tree.go`

```diff
 
-// The translator consumes only these supported syntax forms. ANTLR owns the
-// parse tree; this tree keeps MQL positions and values independent of its runtime.
+// The translator reads only the MQL forms defined here, and rejects every other form.
+// ANTLR, the parser generator, owns the raw parse tree, and this tree stays independent of it.
 type expression interface{ position() int }
```

#### `mql/translate.go`

```diff
 
-// Translate MQL syntax into CEL's own expression representation. The factory,
-// copying, ID traversal, source metadata, and checker are dependency APIs, not
-// local versions of CEL's compiler. The same APIs underpin CEL-Go policy composition:
+// Translates MQL syntax into CEL's own expression tree with CEL-Go's public building blocks.
+// Those same public building blocks also power the policy composer inside CEL-Go itself:
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/common/ast/factory.go#L20-L103
 // https://github.com/cel-expr/cel-go/blob/f2039bc647bca407d882d90436fc8b91bab1ae62/policy/composer.go#L158-L180
-// The MQL translation below is original code, not a port of Sublime's compiler.
+// The MQL translation below is original code, not a port of Sublime's own compiler.
 import (
```

#### `mql/translate.go`

```diff
 
-// Each builder tags generated expressions with their original MQL location.
-// CEL offsets count Unicode code points; MQL diagnostics retain UTF-8 byte offsets.
+// Each builder tags generated expressions with their place in the original MQL text.
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
6. Go doc comments start with the name (checked by revive's `exported` rule, not by this tool).

## Setup

Needs a TypeSafe key through OpenRouter for the judgment checks, in `JEV_API_KEY`.
Code checks run without it.

```sh
comment-style                          # comments touched by staged changes
comment-style --diff main~3..main      # comments touched by a commit range
comment-style --file internal/foo.go   # one file
```

Only the files and diff you pass are sent. Never pass secrets or private data.
