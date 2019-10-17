const path = require('path')

const { cores, plugins } = require('isomorphic-git')
const { FileSystem } = require('isomorphic-git/internal-apis')

let i = 0

async function makeNodeFixture (fixture) {
  const fs = new FileSystem(Object.assign({}, require('fs')))
  const core = `core-node-${i++}`
  cores.create(core).set('fs', fs)
  plugins.set('fs', fs) // deprecated

  const {
    getFixturePath,
    createTempDir,
    copyFixtureIntoTempDir
  } = require('jest-fixtures')

  const testsDir = path.resolve(__dirname, '..')

  const dir = (await getFixturePath(testsDir, fixture))
    ? await copyFixtureIntoTempDir(testsDir, fixture)
    : await createTempDir()

  const gitdir = (await getFixturePath(testsDir, `${fixture}.git`))
    ? await copyFixtureIntoTempDir(testsDir, `${fixture}.git`)
    : await createTempDir()

  return { fs, dir, gitdir, core }
}

module.exports.makeNodeFixture = makeNodeFixture
