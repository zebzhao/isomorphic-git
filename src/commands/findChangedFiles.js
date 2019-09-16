import { FileSystem } from '../models/FileSystem.js'
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'

import { TREE } from './TREE.js'
import { walkBeta1 } from './walkBeta1.js'

/**
 * Find diff of files between two trees with a common ancestor.
 *
 */
export async function findChangedFiles ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourOid,
  theirOid,
  baseOid
}) {
  // Adapted from: http://gitlet.maryrosecook.com/docs/gitlet.html#section-220
  try {
    const fs = new FileSystem(_fs)
    let count = 0
    return await walkBeta1({
      fs,
      dir,
      gitdir,
      trees: [
        TREE({ fs, gitdir, ref: ourOid }),
        TREE({ fs, gitdir, ref: theirOid }),
        TREE({ fs, gitdir, ref: baseOid })
      ],
      map: async function ([ours, theirs, base]) {
        if (ours.fullpath === '.') return

        await Promise.all([
          base.exists && base.populateStat(),
          theirs.exists && theirs.populateStat(),
          ours.exists && ours.populateStat()
        ])

        if ((base.exists && base.type !== 'blob') ||
            (ours.exists && ours.type !== 'blob') ||
            (theirs.exists && theirs.type !== 'blob')) return

        if (emitter) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: 'Counting changes',
            loaded: ++count,
            lengthComputable: false
          })
        }

        return {
          status: await fileStatus(ours, theirs, base),
          ours: ours,
          theirs: theirs,
          base: base
        }
      }
    })
  } catch (err) {
    err.caller = 'git.findChangedFiles'
    throw err
  }
}

export async function fileStatus (receiver, giver, base) {
  const receiverPresent = receiver.exists
  const basePresent = base.exists
  const giverPresent = giver.exists

  if ((!receiverPresent && !basePresent && giverPresent) ||
    (receiverPresent && !basePresent && !giverPresent)) {
    return 'added'
  } else if ((receiverPresent && basePresent && !giverPresent) ||
    (!receiverPresent && basePresent && giverPresent)) {
    return 'deleted'
  } else {
    await Promise.all([
      receiverPresent && receiver.populateHash(),
      giverPresent && giver.populateHash()
    ])
    if (receiver.oid === giver.oid) {
      if (receiver.mode === giver.mode) {
        return 'unmodified'
      } else {
        return 'modified'
      }
    } else {
      if (basePresent) await base.populateHash()
      if (receiverPresent && giverPresent && receiver.oid !== giver.oid) {
        if (receiver.oid !== base.oid && giver.oid !== base.oid) {
          return 'conflict'
        } else {
          return 'modified'
        }
      }
    }
  }
}
