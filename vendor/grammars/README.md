# Vendored Tree-sitter grammars

These WASM files are extracted unchanged from official Tree-sitter npm release tarballs. `manifest.json` records each package version, its npm `gitHead` source commit, tarball URL and integrity, WASM SHA-256, and licence file. The runtime is pinned separately in `package.json` and `package-lock.json`.

The shipped set is Rust 0.24.0, Go 0.25.0, TypeScript and TSX 0.23.2, and JavaScript 0.25.0. Each is MIT licensed. The grammar packages themselves are not runtime dependencies because they have native `node-gyp-build` install hooks. The package includes these files at `vendor/grammars/`, and both source and built extraction modules resolve that directory relative to their own location.

## Update the assets

1. Inspect the official grammar repository's source, corpus tests, licence, and release changes. Identify the published version and full source commit. Inspect the runtime's supported grammar ABI versions before choosing a release.
2. Download the versioned npm tarball named by registry metadata. Verify its `dist.integrity` digest before extracting anything. Do not install the grammar package or run its hooks.
3. Extract only the `.wasm` assets and licence text. Replace the corresponding vendored files. For TypeScript, update TSX and TypeScript together.
4. Record the version, full `gitHead`, tarball URL, integrity, SHA-256 of each WASM file, and licence path in `manifest.json`. Preserve the upstream licence text.
5. Run `npm test`, `npm run check:types`, and `npm run build` on Node 24. The tests check all five grammar loads, exact extraction cases, and asset checksums.
6. Run `npm pack --ignore-scripts` into a throwaway directory. Install the resulting archive in a fresh throwaway project and check a Rust fixture with `--local-only`, an empty home, and both API key variables unset. Confirm the archive includes every grammar and licence and works without native hooks.
7. Review the manifest and binary changes together. Record the reviewed source changes and validation before committing the update.

The current release tarballs and copied WASM digests were verified during the Rust support build. The Node 24 smoke tests cover compatibility with `web-tree-sitter` 0.27.1, including the older TypeScript grammar ABI. No persistent parser cache is used.

SHA-256 checks run in the repository tests rather than at runtime. npm package integrity protects a distributed archive; in a source checkout, the reviewed files and checksum tests provide the integrity check. Runtime loading detects missing or invalid WASM but does not verify valid substituted bytes against the manifest.
