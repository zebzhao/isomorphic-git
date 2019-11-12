// @ts-nocheck

import { join } from '../utils/join.js'
import { cores } from '../utils/plugins.js'

/**
 * Initialize a new repository
 *
 * @param {object} args
 * @param {string} [args.core = 'default'] - The plugin core identifier to use for plugin injection
 * @param {FileSystem} [args.fs] - [deprecated] The filesystem containing the git repo. Overrides the fs provided by the [plugin system](./plugin-fs.md.md).
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {boolean} [args.bare = false] - Initialize a bare repository
 * @param {import('events').EventEmitter} [args.emitter] - [deprecated] Overrides the emitter set via the ['emitter' plugin](./plugin_emitter.md)
 * @param {string} [args.emitterPrefix = ''] - Scope emitted events by prepending `emitterPrefix` to the event name
 * @param {boolean} [args.noOverwrite = false] - Detect if this is already a git repo and do not re-write `.git/config`
 * @returns {Promise<void>}  Resolves successfully when filesystem operations are complete
 *
 * @example
 * await git.init({ dir: '$input((/))' })
 * console.log('done')
 *
 */
export async function init ({
  core = 'default',
  bare = false,
  dir,
  gitdir = bare ? dir : join(dir, '.git'),
  emitter = cores.get(core).get('emitter'),
  emitterPrefix = '',
  fs = cores.get(core).get('fs'),
  noOverwrite = false
}) {
  try {
    let count = 0
    if (noOverwrite && (await fs.exists(gitdir + '/config'))) return
    let folders = [
      'hooks',
      'info',
      'objects/info',
      'objects/pack',
      'refs/heads',
      'refs/tags'
    ]
    const total = folders.length
    folders = folders.map(dir => gitdir + '/' + dir)
    if (emitter) {
      emitter.emit(`${emitterPrefix}progress`, {
        phase: 'Initializing repo',
        loaded: 0,
        total,
        lengthComputable: true
      })
    }
    for (const folder of folders) {
      await fs.mkdir(folder)
      if (emitter) {
        emitter.emit(`${emitterPrefix}progress`, {
          phase: 'Initializing repo',
          loaded: ++count,
          total,
          lengthComputable: true
        })
      }
    }
    await fs.write(
      gitdir + '/config',
      '[core]\n' +
        '\trepositoryformatversion = 0\n' +
        '\tfilemode = false\n' +
        `\tbare = ${bare}\n` +
        (bare ? '' : '\tlogallrefupdates = true\n') +
        '\tsymlinks = false\n' +
        '\tignorecase = true\n'
    )
    await fs.write(gitdir + '/HEAD', 'ref: refs/heads/master\n')
  } catch (err) {
    err.caller = 'git.init'
    throw err
  }
}
