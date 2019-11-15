
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'

import { TREE } from './TREE.js'
import { walkBeta2 } from './walkBeta2.js'

/**
 * Find diff of files between two trees with a common ancestor.
 *
 */
export async function findChangedFiles ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs = cores.get(core).get('fs'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  ourOid,
  theirOid,
  baseOid
}) {
  // Adapted from: http://gitlet.maryrosecook.com/docs/gitlet.html#section-220
  try {
    let count = 0
    return await walkBeta2({
      fs,
      dir,
      gitdir,
      trees: [
        TREE({ ref: ourOid }),
        TREE({ ref: theirOid }),
        TREE({ ref: baseOid })
      ],
      map: async function (filepath, [ours, theirs, base]) {
        if (filepath === '.') return

        if ((base && (await base.type()) !== 'blob') ||
            (ours && (await ours.type()) !== 'blob') ||
            (theirs && (await theirs.type()) !== 'blob')) return

        if (emitter) {
          emitter.emit(`${emitterPrefix}progress`, {
            phase: 'Counting changes',
            loaded: ++count,
            lengthComputable: false
          })
        }

        return {
          status: await fileStatus(ours, theirs, base),
          filepath,
          ours,
          theirs,
          base
        }
      }
    })
  } catch (err) {
    err.caller = 'git.findChangedFiles'
    throw err
  }
}

export async function fileStatus (receiver, giver, base) {
  if ((!receiver && !base && giver) ||
    (receiver && !base && !giver)) {
    return 'added'
  } else if ((receiver && base && !giver) ||
    (!receiver && base && giver)) {
    return 'deleted'
  } else {
    const [receiverOid, giverOid, baseOid] = await Promise.all([
      receiver && receiver.oid(),
      giver && giver.oid(),
      base && base.oid()
    ])
    if (receiverOid === giverOid) {
      if ((await receiver.mode()) === (await giver.mode())) {
        return 'unmodified'
      } else {
        return 'modified'
      }
    } else {
      if (receiver && giver && receiverOid !== giverOid) {
        if (receiverOid !== baseOid && giverOid !== baseOid) {
          return 'conflict'
        } else {
          return 'modified'
        }
      }
    }
  }
}
