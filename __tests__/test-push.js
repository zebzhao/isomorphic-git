/* eslint-env node, browser, jasmine */
const { makeFixture } = require('./__helpers__/FixtureFS.js')
const snapshots = require('./__snapshots__/test-push.js.snap')
const registerSnapshots = require('./__helpers__/jasmine-snapshots')
const EventEmitter = require('events')

const { plugins, push } = require('isomorphic-git')

describe('push', () => {
  beforeAll(() => {
    registerSnapshots(snapshots)
  })
  it('push', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    let output = []
    plugins.set(
      'emitter',
      new EventEmitter().on('push.message', output.push.bind(output))
    )
    // Test
    let res = await push({
      gitdir,
      emitterPrefix: 'push.',
      remote: 'karma',
      ref: 'refs/heads/master'
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/heads/master')
    expect(output).toMatchSnapshot()
  })
  it('push without ref', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let res = await push({
      gitdir,
      remote: 'karma'
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/heads/master')
  })
  it('push with ref !== remoteRef', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let res = await push({
      gitdir,
      remote: 'karma',
      ref: 'master',
      remoteRef: 'foobar'
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/heads/foobar')
  })
  it('push with lightweight tag', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let res = await push({
      gitdir,
      remote: 'karma',
      ref: 'lightweight-tag'
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/tags/lightweight-tag')
  })
  it('push with annotated tag', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let res = await push({
      gitdir,
      remote: 'karma',
      ref: 'annotated-tag'
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/tags/annotated-tag')
  })

  it('push with Basic Auth', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let res = await push({
      gitdir,
      username: 'testuser',
      password: 'testpassword',
      remote: 'auth',
      ref: 'master'
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/heads/master')
  })
  it('push with Basic Auth credentials in the URL', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let res = await push({
      gitdir,
      remote: 'url',
      ref: 'master'
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/heads/master')
  })
  it('throws an Error if no credentials supplied', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let error = null
    try {
      await push({
        gitdir,
        remote: 'auth',
        ref: 'master'
      })
    } catch (err) {
      error = err.message
    }
    expect(error).toContain('401')
  })
  it('throws an Error if invalid credentials supplied', async () => {
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let error = null
    try {
      await push({
        gitdir,
        username: 'test',
        password: 'test',
        remote: 'auth',
        ref: 'master'
      })
    } catch (err) {
      error = err.message
    }
    expect(error).toContain('401')
  })
  it('push to Github using token', async () => {
    // This Personal OAuth token is for a test account (https://github.com/isomorphic-git-test-push)
    // with "public_repo" access. The only repo it has write access to is
    // https://github.com/isomorphic-git/test.empty
    // It is stored reversed to avoid Github's auto-revoking feature.
    const token = 'e8df25b340c98b7eec57a4976bd9074b93a7dc1c'
      .split('')
      .reverse()
      .join('')
    // Setup
    let { gitdir } = await makeFixture('test-push')
    // Test
    let res = await push({
      gitdir,
      corsProxy: process.browser ? 'http://localhost:9999' : undefined,
      token: token,
      remote: 'origin',
      ref: 'master',
      force: true
    })
    expect(res).toBeTruthy()
    expect(res.ok).toBeTruthy()
    expect(res.ok[0]).toBe('unpack')
    expect(res.ok[1]).toBe('refs/heads/master')
  })
})
