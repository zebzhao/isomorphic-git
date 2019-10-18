/* eslint-env node, browser, jasmine */

const { makeLightningFS } = require('./FixtureFS/makeLightningFS.js')
const { makeNodeFixture } = require('./FixtureFS/makeNodeFixture.js')
const setTestTimeout = require('./set-test-timeout')
setTestTimeout(60000)

async function makeFixture (dir) {
  return process.browser ? makeBrowserFixture(dir) : makeNodeFixture(dir)
}

async function makeBrowserFixture (dir) {
  // enable / disable console.log statements
  // window.localStorage.debug = 'isomorphic-git'
  return makeLightningFS(dir)
}

module.exports.makeFixture = makeFixture
