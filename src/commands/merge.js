import { merge as d3merge } from 'node-diff3'
import { GitRefManager } from '../managers/GitRefManager'
import { GitIndexManager } from '../managers/GitIndexManager'
import { FileSystem } from '../models/FileSystem'
import { E, GitError } from '../models/GitError'
import { join } from '../utils/join'
import { cores } from '../utils/plugins'
import { hashObject } from '../utils/hashObject.js'

import { checkout } from './checkout'
import { currentBranch } from './currentBranch'
import { findChangedFiles } from './findChangedFiles'
import { findMergeBase } from './findMergeBase'

/**
 * Merge one or more branches (Currently, only fast-forward merges are implemented.)
 *
 * @link https://isomorphic-git.github.io/docs/merge.html
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
  fastForwardOnly
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
    let ourOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: ourRef
    })
    let theirOid = await GitRefManager.resolve({
      fs,
      gitdir,
      ref: theirRef
    })
    // find most recent common ancestor of ref a and ref b (if there's more than 1, pick 1)
    let baseOid = (await findMergeBase({ gitdir, fs, oids: [ourOid, theirOid] }))[0]
    // handle fast-forward case
    if (!baseOid) {
      throw new GitError(E.MergeNoCommonAncestryError, { theirRef, ourRef })
    } else if (baseOid === theirOid) {
      return {
        oid: ourOid,
        alreadyMerged: true
      }
    } else if (baseOid === ourOid) {
      await GitRefManager.writeRef({ fs, gitdir, ref: ourRef, value: theirOid })
      await checkout({
        dir,
        gitdir,
        fs,
        ref: ourRef,
        emitter,
        emitterPrefix
      })
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

                let merged = await d3merge(ours.content, base.content, theirs.content)
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
