// @ts-check

import globrex from 'globrex'

import { GitIndexManager } from '../managers/GitIndexManager.js'
import { GitRefManager } from '../managers/GitRefManager.js'
import { GitIgnoreManager } from '../managers/GitIgnoreManager.js'

import { E, GitError } from '../models/GitError.js'
import { join } from '../utils/join.js'
import { patternRoot } from '../utils/patternRoot.js'
import { cores } from '../utils/plugins.js'
import { worthWalking } from '../utils/worthWalking.js'

import { TREE } from './TREE.js'
import { WORKDIR } from './WORKDIR'
import { config } from './config'
import { walkBeta2 } from './walkBeta2.js'
import { STAGE } from './STAGE.js'

const ALLOW_ALL = ['.']

/**
 * Checkout a branch
 *
 * If the branch already exists it will check out that branch. Otherwise, it will create a new remote tracking branch set to track the remote branch of that name.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {import('../models/FileSystem').FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md)
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name
 * @param {string} args.ref - Which branch to checkout
 * @param {string[]} [args.filepaths = ['.']] - Limit the checkout to the given files and directories
 * @param {string} [args.pattern = null] - Only checkout the files that match a glob pattern. (Pattern is relative to `filepaths` if `filepaths` is provided.)
 * @param {string} [args.remote = 'origin'] - Which remote repository to use
 * @param {boolean} [args.noCheckout = false] - If true, will update HEAD but won't update the working directory
 *
 * @returns {Promise<void>} Resolves successfully when filesystem operations are complete
 *
 * @example
 * // checkout the master branch
 * await git.checkout({ dir: '$input((/))', ref: '$input((master))' })
 * console.log('done')
 *
 * @example
 * // checkout only JSON and Markdown files from master branch
 * await git.checkout({ dir: '$input((/))', ref: '$input((master))', pattern: '$input((**\/*.{json,md}))' })
 * console.log('done')
 *
 */
export async function checkout ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  remote = 'origin',
  ref,
  filepaths = ALLOW_ALL,
  pattern = null,
  noCheckout = false
}) {
  try {
    if (ref === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'checkout',
        parameter: 'ref'
      })
    }
    if (emitter) {
      await emitter.emit(`${emitterPrefix}progress`, {
        phase: `Checking out ${remote}/${ref}`,
        loaded: 0,
        lengthComputable: false
      })
    }
    let patternPart = ''
    let patternGlobrex
    if (pattern) {
      patternPart = patternRoot(pattern)
      if (patternPart) {
        pattern = pattern.replace(patternPart + '/', '')
      }
      patternGlobrex = globrex(pattern, { globstar: true, extended: true })
    }
    const bases = filepaths.map(filepath => join(filepath, patternPart))
    const allowAll = filepaths === ALLOW_ALL
    // Get tree oid
    let oid
    try {
      oid = await GitRefManager.resolve({ fs, gitdir, ref })
      // TODO: Figure out what to do if both 'ref' and 'remote' are specified, ref already exists,
      // and is configured to track a different remote.
    } catch (err) {
      // If `ref` doesn't exist, create a new remote tracking branch
      // Figure out the commit to checkout
      const remoteRef = `${remote}/${ref}`
      oid = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: remoteRef
      })
      // Set up remote tracking branch
      await config({
        gitdir,
        fs,
        path: `branch.${ref}.remote`,
        value: `${remote}`
      })
      await config({
        gitdir,
        fs,
        path: `branch.${ref}.merge`,
        value: `refs/heads/${ref}`
      })
      // Create a new branch that points at that same commit
      await fs.write(`${gitdir}/refs/heads/${ref}`, oid + '\n')
    }
    if (!noCheckout) {
      let count = 0
      const indexEntries = []
      // Instead of deleting and rewriting everything, only delete files
      // that are not present in the new branch, and only write files that
      // are not in the index or are in the index but have the wrong SHA.
      try {
        await walkBeta2({
          fs,
          dir,
          gitdir,
          trees: [TREE({ ref }), WORKDIR(), STAGE()],
          map: async function (fullpath, [head, workdir, stage]) {
            if (fullpath === '.') return
            if (!head && !stage && workdir) {
              if (
                await GitIgnoreManager.isIgnored({
                  fs,
                  dir,
                  filepath: fullpath
                })
              ) {
                return null
              }
            }
            if (!allowAll && !bases.some(base => worthWalking(fullpath, base))) { // match against base paths
              return null
            }
            // Late filter against file names
            if (patternGlobrex) {
              let match = false
              for (const base of bases) {
                const partToMatch = fullpath.replace(base + '/', '')
                if (patternGlobrex.regex.test(partToMatch)) {
                  match = true
                  break
                }
              }
              if (!match) return
            }
            if (!head) {
              // if file is not staged, ignore it
              if (stage && workdir) {
                await fs.rm(join(dir, fullpath))
                if (emitter) {
                  await emitter.emit(`${emitterPrefix}progress`, {
                    phase: 'Updating workdir',
                    loaded: ++count,
                    lengthComputable: false
                  })
                }
              }
              return null
            }
            const filepath = `${dir}/${fullpath}`
            switch (await head.type()) {
              case 'tree': {
                // ignore directories for now
                if (!workdir) await fs.mkdir(filepath)
                break
              }
              case 'commit': {
                // gitlinks
                console.log(
                  new GitError(E.NotImplementedFail, {
                    thing: 'submodule support'
                  })
                )
                break
              }
              case 'blob': {
                const oid = await head.oid()
                if (!stage || !workdir || (await stage.oid()) !== oid) {
                  const content = await head.content()
                  const mode = await head.mode()
                  switch (mode) {
                    case 0o100644:
                      // regular file
                      await fs.write(filepath, content)
                      break
                    case 0o100755:
                      // executable file
                      await fs.write(filepath, content, { mode: 0o777 })
                      break
                    case 0o120000:
                      // symlink
                      await fs.writelink(filepath, content)
                      break
                    default:
                      throw new GitError(E.InternalFail, {
                        message: `Invalid mode "${mode}" detected in blob ${oid}`
                      })
                  }
                  const stats = await fs.lstat(filepath)
                  // We can't trust the executable bit returned by lstat on Windows,
                  // so we need to preserve this value from the TREE.
                  // TODO: Figure out how git handles this internally.
                  if (mode === 0o100755) {
                    stats.mode = 0o100755
                  }
                  indexEntries.push({
                    filepath: fullpath,
                    stats,
                    oid
                  })
                  if (emitter) {
                    await emitter.emit(`${emitterPrefix}progress`, {
                      phase: 'Updating workdir',
                      loaded: ++count,
                      lengthComputable: false
                    })
                  }
                }
                break
              }
              default: {
                throw new GitError(E.ObjectTypeAssertionInTreeFail, {
                  type: await head.type(),
                  oid: await head.oid(),
                  entrypath: fullpath
                })
              }
            }
          }
        })
        // Acquire a lock on the index
        await GitIndexManager.acquire({ fs, gitdir }, async function (index) {
          index.clear()
          for (const entry of indexEntries) {
            index.insert(entry)
          }
        })
      } catch (err) {
        // Throw a more helpful error message for this common mistake.
        if (err.code === E.ReadObjectFail && err.data.oid === oid) {
          throw new GitError(E.CommitNotFetchedError, { ref, oid })
        } else {
          throw err
        }
      }
    }
    // Update HEAD
    const fullRef = await GitRefManager.expand({ fs, gitdir, ref })
    const content = fullRef.startsWith('refs/heads') ? `ref: ${fullRef}` : oid
    await fs.write(`${gitdir}/HEAD`, `${content}\n`)
  } catch (err) {
    err.caller = 'git.checkout'
    throw err
  }
}
