// @ts-check

import { GitWalkerRepo } from '../models/GitWalkerRepo.js'
import { GitWalkerRepo2 } from '../models/GitWalkerRepo2.js'
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'
import { GitWalkBeta1Symbol, GitWalkBeta2Symbol } from '../utils/symbols.js'

/**
 *
 * @typedef Walker
 * @property {Symbol} Symbol('GitWalkerSymbol')
 */

/**
 * Get a git commit `Walker`
 *
 * See [walkBeta2](./walkBeta2.md)
 *
 * @param {object} args
 * @param {string} [args.ref='HEAD'] - The commit to walk
 * @param {import('../models/FileSystem').FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 *
 * @returns {Walker} Returns a git commit Walker
 *
 */
export function TREE ({
  ref = 'HEAD',
  // @ts-ignore
  core = 'default',
  // @ts-ignore
  dir,
  gitdir,
  fs = cores.get(core).get('fs')
}) {
  const o = Object.create(null)
  Object.defineProperty(o, GitWalkBeta1Symbol, {
    value: function () {
      gitdir = gitdir || join(dir, '.git')
      return new GitWalkerRepo({ fs, gitdir, ref })
    }
  })
  Object.defineProperty(o, GitWalkBeta2Symbol, {
    value: function ({ fs, gitdir }) {
      return new GitWalkerRepo2({ fs, gitdir, ref })
    }
  })
  Object.freeze(o)
  return o
}
