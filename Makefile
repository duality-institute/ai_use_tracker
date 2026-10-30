.DEFAULT_GOAL := help

.PHONY: help deps check build verify tarball publish-dry-run clean

help:
	@printf '%s\n' \
		'make deps             Install source dependencies (bun install)' \
		'make check            Type-check' \
		'make build            Build the OpenCode TUI plugin' \
		'make verify           Type-check, build, and verify package artifacts' \
		'make tarball          Verify and pack the plugin' \
		'make publish-dry-run  Show exactly what npm publish would upload' \
		'make clean            Remove dist/ and packed tarballs'

deps:
	bun install

check:
	bun run check

build:
	bun run build

verify:
	bun run verify

tarball: verify
	npm pack --ignore-scripts

publish-dry-run: verify
	npm publish --dry-run --ignore-scripts

clean:
	rm -rf dist *.tgz
