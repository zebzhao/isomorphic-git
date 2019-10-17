// @ts-check
import { GitIndexManager } from '../managers/GitIndexManager.js'
import { GitRefManager } from '../managers/GitRefManager.js'

import { GitCommit } from '../models/GitCommit.js'
import { E, GitError } from '../models/GitError.js'
import { writeObject } from '../storage/writeObject.js'
import { join } from '../utils/join.js'
import { normalizeAuthorObject } from '../utils/normalizeAuthorObject.js'
import { cores } from '../utils/plugins.js'

/**
 * Create a new commit
 *
 * @param {Object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.message - The commit message to use.
 * @param {Object} [args.author] - The details about the author.
 * @param {string} [args.author.name] - Default is `user.name` config.
 * @param {string} [args.author.email] - Default is `user.email` config.
 * @param {string} [args.author.date] - Set the author timestamp field. Default is the current date.
 * @param {string} [args.author.timestamp] - Set the author timestamp field. This is an alternative to using `date` using an integer number of seconds since the Unix epoch instead of a JavaScript date object.
 * @param {string} [args.author.timezoneOffset] - Set the author timezone offset field. This is the difference, in minutes, from the current timezone to UTC. Default is `(new Date()).getTimezoneOffset()`.
 * @param {Object} [args.committer = author] - The details about the commit committer, in the same format as the author parameter. If not specified, the author details are used.
 * @param {string} [args.signingKey] - Sign the tag object using this private PGP key.
 * @param {boolean} [args.dryRun = false] - If true, simulates making a commit so you can test whether it would succeed. Implies `noUpdateBranch`.
 * @param {boolean} [args.noUpdateBranch = false] - If true, does not update the branch pointer after creating the commit.
 * @param {string} [args.ref] - The fully expanded name of the branch to commit to. Default is the current branch pointed to by HEAD. (TODO: fix it so it can expand branch names without throwing if the branch doesn't exist yet.)
 * @param {string[]} [args.parent] - The SHA-1 object ids of the commits to use as parents. If not specified, the commit pointed to by `ref` is used.
 * @param {string} [args.tree] - The SHA-1 object id of the tree to use. If not specified, a new tree object is created from the current git index.
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md)
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name
 *
 * @returns {Promise<string>} Resolves successfully with the SHA-1 object id of the newly created commit.
 *
 * @example
 * let sha = await git.commit({
 *   dir: '$input((/))',
 *   author: {
 *     name: '$input((Mr. Test))',
 *     email: '$input((mrtest@example.com))'
 *   },
 *   message: '$input((Added the a.txt file))'
 * })
 * console.log(sha)
 *
 */
export async function commit ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  message,
  author,
  committer,
  signingKey,
  dryRun = false,
  noUpdateBranch = false,
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ref,
  parent,
  tree
}) {
  try {
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Creating commit',
        loaded: 0,
        lengthComputable: false
      })
    }
    if (!ref) {
      ref = await GitRefManager.resolve({
        fs,
        gitdir,
        ref: 'HEAD',
        depth: 2
      })
    }

    if (message === undefined) {
      throw new GitError(E.MissingRequiredParameterError, {
        function: 'commit',
        parameter: 'message'
      })
    }

    // Fill in missing arguments with default values
    author = await normalizeAuthorObject({ fs, gitdir, author })
    if (author === undefined) {
      throw new GitError(E.MissingAuthorError)
    }

    committer = Object.assign({}, committer || author)
    // Match committer's date to author's one, if omitted
    committer.date = committer.date || author.date
    committer = await normalizeAuthorObject({ fs, gitdir, author: committer })
    if (committer === undefined) {
      throw new GitError(E.MissingCommitterError)
    }

    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Creating commit tree',
        loaded: 0,
        lengthComputable: false
      })
    }

    return GitIndexManager.acquire({ fs, gitdir }, async function (index) {
      if (!parent) {
        try {
          parent = [
            await GitRefManager.resolve({
              fs,
              gitdir,
              ref
            })
          ]
        } catch (err) {
          // Probably an initial commit
          parent = []
        }
      }

      let mergeHash
      try {
        mergeHash = await GitRefManager.resolve({ fs, gitdir, ref: 'MERGE_HEAD' })
      } catch (err) {
        // No merge hash
      }

      if (mergeHash) {
        const conflictedPaths = index.conflictedPaths
        if (conflictedPaths.length > 0) {
          throw new GitError(E.CommitUnmergedConflictsFail, { paths: conflictedPaths })
        }
        if (parent.length) {
          if (!parent.includes(mergeHash)) parent.push(mergeHash)
        } else {
          throw new GitError(E.NoHeadCommitError, { noun: 'merge commit', ref: mergeHash })
        }
      }

      if (!tree) {
        tree = await GitIndexManager.constructTree({ fs, gitdir, dryRun, index })
      }

      if (emitter) {
        emitter.emit(`${emitterPrefix}progress`, {
          phase: 'Writing commit',
          loaded: 0,
          lengthComputable: false
        })
      }

      let comm = GitCommit.from({
        tree,
        parent,
        author,
        committer,
        message
      })
      if (signingKey) {
        const pgp = cores.get(core).get('pgp')
        comm = await GitCommit.sign(comm, pgp, signingKey)
      }
      const oid = await writeObject({
        fs,
        gitdir,
        type: 'commit',
        object: comm.toObject(),
        dryRun
      })
      if (!noUpdateBranch && !dryRun) {
        // Update branch pointer
        await GitRefManager.writeRef({
          fs,
          gitdir,
          ref,
          value: oid
        })
        if (mergeHash) {
          await GitRefManager.deleteRef({ fs, gitdir, ref: 'MERGE_HEAD' })
          await fs.rm(join(gitdir, 'MERGE_MSG'))
        }
      }
      return oid
    })
  } catch (err) {
    err.caller = 'git.commit'
    throw err
  }
}
