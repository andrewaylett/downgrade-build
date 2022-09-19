# Downgrade Build

Duplicates your project, locking your dependencies to their minimums, and tries
to build it.

## Usage

Adding this package to your `devDependencies` will give you access to a
`downgrade-build` binary, which you can call from any npm script.

It will duplicate your project, with mutated dependencies, and run
`npm install`, then `npm run` with whatever parameters you passed to the script.
For many projects, you'll either want to run `downgrade-build build` or
`downgrade-build test`.
If you need to run more than one script, chain them together in a new script.

## Motivation

With any kind of open version specification for dependencies, we risk breaking
when we use features that only exist in new versions but don't bump our spec.

This utility will attempt to install and build your package with the lowest
versions that are compatible, helping you to keep as wide as possible a
dependency spec.

## Implementation

We use [ignore](https://www.npmjs.com/package/ignore) to avoid copying files
that aren't part of your repository, and also don't copy `node_modules`, `.git`,
or `package-lock.json`, even if they're not found at top level.

Unfortunately, none of the globbing libraries I could find actually manage to
work with `.gitignore` files in superdirectories or subdirectories.
So I wrote my own, which exposes an async generator.

Once we have a clean project in a temporary directory, we can run `npm install`
on it.
