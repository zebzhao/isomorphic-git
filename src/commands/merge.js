// @ts-check
// import diff3 from 'node-diff3'
import { GitRefManager } from '../managers/GitRefManager.js'
import { FileSystem } from '../models/FileSystem.js'
import { E, GitError } from '../models/GitError.js'
import { abbreviateRef } from '../utils/abbreviateRef.js'
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'

import { _applyTreePatch } from './_applyTreePatch.js'
import { _diffTree } from './_diffTree.js'
import { _mergeTreePatches } from './_mergeTreePatches.js'
import { commit } from './commit'
import { currentBranch } from './currentBranch.js'
import { findMergeBase } from './findMergeBase.js'

/**
 *
 * @typedef {Object} MergeReport - Returns an object with a schema like this:
 * @property {string} [oid] - The SHA-1 object id that is now at the head of the branch. Absent only if `dryRun` was specified and `mergeCommit` is true.
 * @property {boolean} [alreadyMerged] - True if the branch was already merged so no changes were made
 * @property {boolean} [fastForward] - True if it was a fast-forward merge
 * @property {boolean} [mergeCommit] - True if merge resulted in a merge commit
 * @property {string} [tree] - The SHA-1 object id of the tree resulting from a merge commit
 *
 */

/**
 * Merge one or more branches *(Currently, only very simple cases are handled.)*
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin_fs.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.ours] - The branch receiving the merge. If undefined, defaults to the current branch.
 * @param {string} args.theirs - The branch to be merged
 * @param {boolean} [args.fastForwardOnly = false] - If true, then non-fast-forward merges will throw an Error instead of performing a merge.
 * @param {boolean} [args.dryRun = false] - If true, simulates a merge so you can test whether it would succeed.
 * @param {string} [args.message] - Overrides the default auto-generated merge commit message
 * @param {Object} [args.author] - passed to [commit](commit.md) when creating a merge commit
 * @param {Object} [args.committer] - passed to [commit](commit.md) when creating a merge commit
 * @param {string} [args.signingKey] - passed to [commit](commit.md) when creating a merge commit
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
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourRef,
  theirRef,
  fastForwardOnly = false,
  dryRun = false,
  message,
  author,
  committer,
  signingKey
}) {
  try {
    const fs = new FileSystem(_fs)
    if (ourRef === undefined) {
      ourRef = await currentBranch({ fs, gitdir, fullname: true })
    }
    ourRef = await GitRefManager.expand({
      fs,
      gitdir,
      ref: ourRef
    })
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
    if (baseOids.length !== 1) {
      throw new GitError(E.MergeNotSupportedFail)
    }
    const baseOid = baseOids[0]
    // handle fast-forward case
    if (baseOid === theirOid) {
      return {
        oid: ourOid,
        alreadyMerged: true
      }
    }
    if (baseOid === ourOid) {
      if (!dryRun) {
        await GitRefManager.writeRef({ fs, gitdir, ref: ours, value: theirOid })
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

      await GitRefManager.writeRef({ fs, gitdir, ref: 'MERGE_HEAD', value: theirOid })

      // for each file, determine whether it is present or absent or modified (see http://gitlet.maryrosecook.com/docs/gitlet.html#section-217)
      let mergeDiff = await findChangedFiles({
        fs,
        gitdir,
        dir,
        emitter,
        emitterPrefix,
        ourOid,
        theirOid,
        baseOid
      })

      await fs.write(join(gitdir, 'MERGE_MSG'), mergeMessage(ourRef, theirRef, mergeDiff), 'utf8')

      await GitIndexManager.acquire(
        { fs, filepath: `${gitdir}/index` },
        async function (index) {
          const total = mergeDiff.length
          let count = 0

          for (let diff of mergeDiff) {
            let { ours, theirs, base } = diff
            // for simple cases of add, remove, or modify files
            switch (diff.status) {
              case 'added':
                let added = ours.exists ? ours : theirs
                await added.populateHash()
                await added.populateStat()
                await added.populateContent()
                const { fullpath, stats, contents, oid } = added
                index.insert({ filepath: fullpath, stats, oid })
                await fs.write(`${dir}/${fullpath}`, contents)
                break
              case 'deleted':
                index.delete({ filepath: base.fullpath })
                await fs.rm(`${dir}/${base.fullpath}`)
                break
              case 'modified':
                if (theirs.oid !== base.oid) {
                  await theirs.populateStat()
                  await theirs.populateContent()
                  let { fullpath, stats, contents, oid } = theirs
                  index.insert({ filepath: fullpath, stats, oid })
                  await fs.write(`${dir}/${fullpath}`, contents)
                }
                break
              case 'conflict':
                await ours.populateContent()
                await theirs.populateContent()
                await base.populateContent()
                await base.populateStat()

                let merged = await diff3.merge(ours.content, base.content, theirs.content)
                let { baseFullpath, baseOid, baseStats } = base
                let mergedText = merged.result.join('\n')

                if (merged.conflict) {
                  index.writeConflict({
                    filepath: baseFullpath,
                    stats: baseStats,
                    ourOid: ours.oid,
                    theirOid: theirs.oid,
                    baseOid
                  })
                  emitter.emit(`${emitterPrefix}conflict`, {
                    filepath: baseFullpath,
                    ourOid: ours.oid,
                    theirOid: theirs.oid,
                    baseOid
                  })
                } else {
                  let oid = await hashObject({
                    gitdir,
                    type: 'blob',
                    object: mergedText
                  })
                  index.insert({ filepath: baseFullpath, stats, oid })
                }
                await fs.write(`${dir}/${baseFullpath}`, mergedText)
                break
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
        }
      )
    }
  } catch (err) {
    err.caller = 'git.merge'
    throw err
  }
}

async function mergeMessage ({ ourRef, theirRef, mergeDiff }) {
  let msg = `Merge ${theirRef} into ${ourRef}`
  let conflicts = mergeDiff.filter(function (d) { return d.status === 'conflict' })
  if (conflicts.length > 0) {
    msg += '\nConflicts:\n' + conflicts.join('\n')
  }
  return msg
}
async function basicMerge ({ fs, gitdir, ours, theirs, base }) {
  const diff1 = await _diffTree({ gitdir, before: base, after: ours })
  const diff2 = await _diffTree({ gitdir, before: base, after: theirs })
  const { treePatch, hasConflicts } = await _mergeTreePatches({
    treePatches: [diff1, diff2]
  })
  if (hasConflicts) throw new GitError(E.MergeNotSupportedFail)
  return _applyTreePatch({
    fs,
    gitdir,
    base,
    treePatch
  })
}
