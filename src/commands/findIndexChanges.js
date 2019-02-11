import { GitIndexManager } from '../managers/GitIndexManager.js'
import { GitRefManager } from '../managers/GitRefManager.js'
import { FileSystem } from '../models/FileSystem.js'
import { GitIndex } from '../models/GitIndex'
import { TREE } from '../models/GitWalkerRepo'
import { WORKDIR } from '../models/GitWalkerFs'
import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'

import { walkBeta1 } from './walkBeta1'

/**
 * Find changes between working index and tree.
 *
 */
export async function findIndexChanges ({
  core = 'default',
  dir,
  gitdir = join(dir, '.git'),
  fs: _fs = cores.get(core).get('fs'),
  ref = 'HEAD'
}) {
  try {
    const fs = new FileSystem(_fs)
    // Resolve commit
    let oid = await GitRefManager.resolve({ fs, gitdir, ref })
    let changes = []
    await GitIndexManager.acquire(
      { fs, filepath: `${gitdir}/index` },
      async function (index) {
        await walkBeta1({
          fs,
          dir,
          gitdir,
          trees: [
            TREE({ fs, gitdir, ref: oid }),
            WORKDIR({ fs, dir, gitdir })
          ],
          map: async function ([head, workdir]) {
            if (head.fullpath === '.') return
            if (head.exists && !workdir.exists) {
              changes.push(head.fullpath)
            } else if (workdir.exists) {
              let stage = index.entriesMap.get(GitIndex.key(workdir.fullpath, 0))
              // if file is staged, compare it with head copy
              if (stage) {
                if (!head.exists) {
                  changes.push(stage.fullpath)
                } else {
                  await head.populateHash()
                  if (stage.oid !== head.oid) {
                    changes.push(stage.fullpath)
                  }
                }
              }
            }
          }
        })
      }
    )
    return changes
  } catch (err) {
    err.caller = 'git.findIndexChanges'
    throw err
  }
}
