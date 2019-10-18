import { cores } from '../utils/plugins.js'
import { GitRefManager } from '../managers/GitRefManager.js'

import { GitCommit } from '../models/GitCommit.js'
import { E, GitError } from '../models/GitError.js'
import { GitTree } from '../models/GitTree.js'
import { readObject } from '../storage/readObject.js'

import { join } from '../utils/join.js'
/**
 * Find the root git directory
 *
 * Starting at `filepath`, walks upward until it finds a directory that contains a subdirectory called '.git'.
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {GitTree} [args.tree] - The tree to start searching in.
 * @param {string} args.path - The file path to search for.
 *
 * @returns {Promise<string>} Resolves successfully with a root git directory path
 * @throws {GitRootNotFoundError}
 *
 * @example
 * let gitroot = await git.findRoot({
  *   filepath: '$input((/path/to/some/gitrepo/path/to/some/file.txt))'
  * })
  * console.log(gitroot) // '/path/to/some/gitrepo'
  *
  */
export async function getOidAtPath ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  tree = null,
  path
}) {
  if (typeof path === 'string') path = path.split('/')
  if (!tree) tree = await getHeadTree({ fs, gitdir })
  const dirname = path.shift()
  for (const entry of tree) {
    if (entry.path === dirname) {
      if (path.length === 0) {
        return entry.oid
      }
      const { type, object } = await readObject({
        fs,
        gitdir,
        oid: entry.oid
      })
      if (type === 'tree') {
        const tree = GitTree.from(object)
        return getOidAtPath({ fs, gitdir, tree, path })
      }
      if (type === 'blob') {
        throw new GitError(E.ObjectTypeAssertionInPathFail, {
          oid: entry.oid,
          path: path.join('/')
        })
      }
    }
  }
  return null
}

async function getHeadTree ({ fs, gitdir }) {
  // Get the tree from the HEAD commit.
  let oid
  try {
    oid = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' })
  } catch (e) {
    // Handle fresh branches with no commits
    if (e.code === E.ResolveRefError) {
      return []
    }
  }
  const { type, object } = await readObject({ fs, gitdir, oid })
  if (type !== 'commit') {
    throw new GitError(E.ResolveCommitError, { oid })
  }
  const commit = GitCommit.from(object)
  oid = commit.parseHeaders().tree
  return getTree({ fs, gitdir, oid })
}

async function getTree ({ fs, gitdir, oid }) {
  const { type, object } = await readObject({
    fs,
    gitdir,
    oid
  })
  if (type !== 'tree') {
    throw new GitError(E.ResolveTreeError, { oid })
  }
  const tree = GitTree.from(object).entries()
  return tree
}
