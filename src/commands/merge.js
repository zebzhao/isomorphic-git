// @ts-check
import { GitRefManager } from '../managers/GitRefManager'
import { GitIndexManager } from '../managers/GitIndexManager'
import { E, GitError } from '../models/GitError'
import { join } from '../utils/join'
import { cores } from '../utils/plugins'
import { hashObject } from '../utils/hashObject.js'

import { checkout } from './checkout'
import { commit } from './commit'
import { currentBranch } from './currentBranch'
import { findChangedFiles } from './findChangedFiles'
import { findMergeBase } from './findMergeBase'
import { abbreviateRef } from '../utils/abbreviateRef'
import { mergeFile } from '../utils/mergeFile'

/**
 *
 * @typedef {Object} MergeReport - Returns an object with a schema like this:
 * @property {string} [oid] - The SHA-1 object id that is now at the head of the branch. Absent only if `dryRun` was specified and `mergeCommit` is true.
 * @property {boolean} [alreadyMerged] - True if the branch was already merged so no changes were made
 * @property {boolean} [fastForward] - True if it was a fast-forward merge
 * @property {boolean} [recursiveMerge] - True if merge will result in a merge commit
 * @property {boolean} [mergeCommit] - True if merge resulted in a merge commit and there is no conflict
 * @property {string} [tree] - The SHA-1 object id of the tree resulting from a merge commit
 *
 */

/**
 * Merge two branches
 *
 * ## Limitations
 *
 * Currently it does not support incomplete merges. That is, if there are merge conflicts it cannot solve
 * with the built in diff3 algorithm it will not modify the working dir, and will throw a [`MergeNotSupportedFail`](./errors.md#mergenotsupportedfail) error.
 *
 * Currently it will fail if multiple candidate merge bases are found. (It doesn't yet implement the recursive merge strategy.)
 *
 * Currently it does not support selecting alternative merge strategies.
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {import('../models/FileSystem').FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md).
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name.
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ourRef] - The branch receiving the merge. If undefined, defaults to the current branch.
 * @param {string} args.theirRef - The branch to be merged
 * @param {boolean} [args.fastForwardOnly = false] - If true, then non-fast-forward merges will throw an Error instead of performing a merge.
 * @param {boolean} [args.dryRun = false] - If true, simulates a merge so you can test whether it would succeed.
 * @param {boolean} [args.noUpdateBranch = false] - If true, does not update the branch pointer after creating the commit.
 * @param {boolean} [args.noCheckout = false] - If true, does not perform checkout after merge.
 * @param {string} [args.message] - Overrides the default auto-generated merge commit message
 * @param {Object} [args.author] - passed to [commit](commit.md) when creating a merge commit
 * @param {Object} [args.committer] - passed to [commit](commit.md) when creating a merge commit
 * @param {string} [args.signingKey] - passed to [commit](commit.md) when creating a merge commit
 * @param {boolean} [args.fast = false] - use fastCheckout instead of regular checkout
 *
 * @returns {Promise<MergeReport>} Resolves to a description of the merge operation
 * @see MergeReport
 *
 * @example
 * let m = await git.merge({ dir: '$input((/))', ours: '$input((master))', theirs: '$input((remotes/origin/master))' })
 * console.log(m)
 *
 */
export async function merge ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourRef,
  theirRef,
  fastForwardOnly = false,
  dryRun = false,
  noUpdateBranch = false,
  noCheckout = false,
  message,
  author,
  committer,
  signingKey
}) {
  try {
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Merging repo',
        loaded: 0,
        lengthComputable: false
      })
    }
    const currentRef = await currentBranch({ fs, gitdir, fullname: true })
    if (ourRef === undefined) {
      ourRef = currentRef
    } else {
      ourRef = await GitRefManager.expand({
        fs,
        gitdir,
        ref: ourRef
      })
    }
    theirRef = await GitRefManager.expand({
      fs,
      gitdir,
      ref: theirRef
    })
    const ourOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: ourRef
    })
    const theirOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: theirRef
    })
    // find most recent common ancestor of ref a and ref b
    const baseOids = await findMergeBase({
      core,
      dir,
      gitdir,
      fs,
      oids: [ourOid, theirOid]
    })
    const baseOid = baseOids[0]
    // handle fast-forward case
    if (!baseOid) {
      throw new GitError(E.MergeNoCommonAncestryError, { theirRef, ourRef })
    } else if (baseOid === theirOid) {
      return {
        oid: ourOid,
        alreadyMerged: true
      }
    } else if (baseOid === ourOid) {
      if (!dryRun && !noUpdateBranch) {
        await GitRefManager.writeRef({ fs, gitdir, ref: ourRef, value: theirOid })
      }
      if (!noCheckout) {
        await checkout({
          dir,
          gitdir,
          fs,
          ref: ourRef,
          emitter,
          emitterPrefix
        })
      }
      return {
        oid: theirOid,
        fastForward: true
      }
    } else {
      // not a simple fast-forward
      if (fastForwardOnly) {
        throw new GitError(E.FastForwardFail)
      }

      if (currentRef !== ourRef) {
        // checkout our branch to begin non-fast-forward merge (needed for tests)
        await checkout({
          dir,
          gitdir,
          fs,
          ref: ourRef,
          emitter,
          emitterPrefix,
          dryRun
        })
      }

      await GitRefManager.writeRef({ fs, gitdir, ref: 'MERGE_HEAD', value: theirOid })

      // for each file, determine whether it is present or absent or modified (see http://gitlet.maryrosecook.com/docs/gitlet.html#section-217)
      const mergeDiff = await findChangedFiles({
        fs,
        gitdir,
        dir,
        emitter,
        emitterPrefix,
        ourOid,
        theirOid,
        baseOid
      })
      const total = mergeDiff.length

      const added = []
      const deleted = []
      const conflicts = []
      let count = 0
      for (const diff of mergeDiff) {
        const { ours, theirs, base, filepath } = diff
        // for simple cases of add, remove, or modify files
        switch (diff.status) {
          case 'added': {
            added.push(await processAdded({ ours, theirs, fs, dir, filepath }))
            break
          }
          case 'deleted': {
            await fs.rm(`${dir}/${filepath}`)
            deleted.push({ filepath })
            break
          }
          case 'modified': {
            added.push(await processModified({ ours, theirs, base, fs, dir, filepath }))
            break
          }
          case 'conflict': {
            const { conflict, added } = await processConflict({ ours, theirs, base, fs, filepath, dir, gitdir })
            if (conflict) {
              conflicts.push(conflict)
              if (emitter) {
                emitter.emit(`${emitterPrefix}conflict`, {
                  filepath,
                  ourOid: conflict.ourOid,
                  theirOid: conflict.theirOid,
                  baseOid: conflict.baseOid
                })
              }
            } else if (added) {
              added.push(added)
            }
            break
          }
        }

        if (emitter) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: 'Applying changes',
            loaded: ++count,
            total,
            lengthComputable: true
          })
        }
      }

      let tree
      await GitIndexManager.acquire({ fs, filepath: `${gitdir}/index` },
        async function (index) {
          for (const obj of added) {
            index.insert(obj)
          }
          for (const obj of deleted) {
            index.delete(obj)
          }
          for (const obj of conflicts) {
            index.writeConflict(obj)
          }
          tree = await GitIndexManager.constructTree({ fs, gitdir, dryRun, index })
          console.log({tree, added, deleted, conflicts: conflicts.map(c => c.filepath), entries: index.entriesMap.keys() })
        }
      )

      if (!message) {
        message = `Merge branch '${abbreviateRef(theirRef)}' into ${abbreviateRef(ourRef)}`
      }

      let oid
      if (conflicts.length === 0) {
        oid = await commit({
          fs,
          gitdir,
          message,
          ref: ourRef,
          tree,
          parent: [ourOid], // theirOid should be handled by MERGE_HASH in commit
          author,
          committer,
          signingKey,
          dryRun,
          noUpdateBranch
        })
      } else {
        await fs.write(join(gitdir, 'MERGE_MSG'), message, 'utf8')
      }
      return {
        oid,
        tree,
        recursiveMerge: true,
        mergeCommit: conflicts.length === 0
      }
    }
  } catch (err) {
    err.caller = 'git.merge'
    throw err
  }
}

async function processAdded ({ filepath, ours, theirs, fs, dir }) {
  const added = ours || theirs
  const workingPath = `${dir}/${filepath}`
  await fs.write(workingPath, await added.content())
  const stats = await fs.lstat(workingPath)
  return { filepath, stats, oid: await added.oid() }
}

async function processModified ({ ours, theirs, base, fs, dir, filepath }) {
  const modified = (await base.oid()) === (await ours.oid()) ? theirs : ours
  const workingPath = `${dir}/${filepath}`
  await fs.write(
    workingPath,
    await modified.content(),
    { mode: (await modified.mode()) }
  )
  const stats = await fs.lstat(workingPath)
  return { filepath, stats, oid: await modified.oid() }
}

async function processConflict ({ ours, theirs, base, fs, dir, gitdir, filepath }) {
  const [ourContent, theirContent, baseContent] = await Promise.all([
    ours.content(),
    theirs.content(),
    base.content()
  ])

  const merged = await mergeFile({
    ourContent: ourContent.toString('utf8'),
    baseContent: baseContent.toString('utf8'),
    theirContent: theirContent.toString('utf8')
  })

  const modified = (await base.oid()) === (await ours.oid()) ? theirs : ours
  const workingPath = `${dir}/${filepath}`
  await fs.write(
    workingPath,
    merged.mergedText,
    { mode: (await modified.mode()) }
  )

  const stats = await fs.lstat(workingPath)

  if (!merged.cleanMerge) {
    return {
      conflict: {
        filepath,
        stats,
        ourOid: await ours.oid(),
        theirOid: await theirs.oid(),
        baseOid: await base.oid()
      }
    }
  } else {
    const oid = await hashObject({
      gitdir,
      type: 'blob',
      object: merged.mergedText
    })
    return { added: { filepath, stats, oid } }
  }
}
