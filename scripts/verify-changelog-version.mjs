#!/usr/bin/env node
/**
 * Verify that package.json `version` matches the topmost `## x.y.z` heading in
 * CHANGELOG.md. A release bumps both; a mismatch means one was forgotten
 * (e.g. releasing without adding the changelog entry). Run in CI.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')

const heading = changelog.match(/^## (\d+\.\d+\.\d+)/m)
if (!heading) {
  console.error('verify-changelog-version: no `## x.y.z` heading found in CHANGELOG.md')
  process.exit(1)
}

const changelogVersion = heading[1]
if (changelogVersion !== pkg.version) {
  console.error(
    `verify-changelog-version: package.json version ${pkg.version} does not match ` +
    `the topmost CHANGELOG.md entry ${changelogVersion}. Add the changelog entry ` +
    `(or bump the version) before releasing.`,
  )
  process.exit(1)
}

console.log(`verify-changelog-version: ok (${pkg.version} matches CHANGELOG.md)`)
