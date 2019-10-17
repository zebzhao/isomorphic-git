// import LockManager from 'travix-lock-manager'
import AsyncLock from 'async-lock'

import { GitIndex } from '../models/GitIndex.js'
import { DeepMap } from '../utils/DeepMap.js'
import { compareStats } from '../utils/compareStats.js'
import { flatFileListToDirectoryStructure } from '../utils/flatFileListToDirectoryStructure.js'
import { GitTree } from '../models/GitTree.js'
import { writeObject } from '../storage/writeObject.js'

// import Lock from '../utils.js'

// TODO: replace with an LRU cache?
const map = new DeepMap()
const stats = new DeepMap()
// const lm = new LockManager()
let lock = null

async function updateCachedIndexFile (fs, filepath) {
  const stat = await fs.lstat(filepath)
  const rawIndexFile = await fs.read(filepath)
  const index = GitIndex.from(rawIndexFile)
  // cache the GitIndex object so we don't need to re-read it
  // every time.
  map.set([fs, filepath], index)
  // Save the stat data for the index so we know whether
  // the cached file is stale (modified by an outside process).
  stats.set([fs, filepath], stat)
}

// Determine whether our copy of the index file is stale
async function isIndexStale (fs, filepath) {
  const savedStats = stats.get([fs, filepath])
  if (savedStats === undefined) return true
  const currStats = await fs.lstat(filepath)
  if (savedStats === null) return false
  if (currStats === null) return false
  return compareStats(savedStats, currStats)
}

export class GitIndexManager {
  static async acquire ({ fs, gitdir }, closure) {
    const filepath = `${gitdir}/index`
    if (lock === null) lock = new AsyncLock({ maxPending: Infinity })
    let result
    await lock.acquire(filepath, async function () {
      // Acquire a file lock while we're reading the index
      // to make sure other processes aren't writing to it
      // simultaneously, which could result in a corrupted index.
      // const fileLock = await Lock(filepath)
      if (await isIndexStale(fs, filepath)) {
        await updateCachedIndexFile(fs, filepath)
      }
      const index = map.get([fs, filepath])
      result = await closure(index)
      if (index._dirty) {
        // Acquire a file lock while we're writing the index file
        // let fileLock = await Lock(filepath)
        const buffer = index.toObject()
        await fs.write(filepath, buffer)
        // Update cached stat value
        stats.set([fs, filepath], await fs.lstat(filepath))
        index._dirty = false
      }
    })
    return result
  }

  static async constructTree ({ fs, gitdir, dryRun, index }) {
    const inodes = flatFileListToDirectoryStructure(index.entries)
    const inode = inodes.get('.')
    const tree = await constructTree({ fs, gitdir, inode, dryRun })
    return tree
  }
}

async function constructTree ({ fs, gitdir, inode, dryRun }) {
  // use depth first traversal
  const children = inode.children
  for (const inode of children) {
    if (inode.type === 'tree') {
      inode.metadata.mode = '040000'
      inode.metadata.oid = await constructTree({ fs, gitdir, inode, dryRun })
    }
  }
  const entries = children.map(inode => ({
    mode: inode.metadata.mode,
    path: inode.basename,
    oid: inode.metadata.oid,
    type: inode.type
  }))
  const tree = GitTree.from(entries)
  const oid = await writeObject({
    fs,
    gitdir,
    type: 'tree',
    object: tree.toObject(),
    dryRun
  })
  return oid
}
