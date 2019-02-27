/* eslint-env node, browser, jasmine */
const { makeFixture } = require('./__helpers__/FixtureFS.js')

const { E, merge, resolveRef, log } = require('isomorphic-git')

describe('merge', () => {
  it('merge master into master', async () => {
    // Setup
    const { gitdir, dir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    const m = await merge({
      gitdir,
      dir,
      ourRef: 'master',
      theirRef: 'master',
      fastForwardOnly: true
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeTruthy()
    expect(m.fastForward).toBeFalsy()
    const oid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge medium into master', async () => {
    // Setup
    const { dir, gitdir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      gitdir,
      ref: 'medium'
    })
    const m = await merge({
      gitdir,
      dir,
      ourRef: 'master',
      theirRef: 'medium',
      fastForwardOnly: true
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeTruthy()
    expect(m.fastForward).toBeFalsy()
    const oid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge oldest into master', async () => {
    // Setup
    const { dir, gitdir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    const m = await merge({
      dir,
      gitdir,
      ourRef: 'master',
      theirRef: 'oldest',
      fastForwardOnly: true
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeTruthy()
    expect(m.fastForward).toBeFalsy()
    const oid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge newest into master', async () => {
    // Setup
    const { dir, gitdir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      gitdir,
      ref: 'newest'
    })
    const m = await merge({
      dir,
      gitdir,
      ourRef: 'master',
      theirRef: 'newest',
      fastForwardOnly: true
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeFalsy()
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge newest into master --dryRun (no author needed since fastForward)', async () => {
    // Setup
    const { dir, gitdir } = await makeFixture('test-merge')
    // Test
    const originalOid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    const desiredOid = await resolveRef({
      gitdir,
      ref: 'newest'
    })
    const m = await merge({
      dir,
      gitdir,
      ourRef: 'master',
      theirRef: 'newest',
      fastForwardOnly: true,
      dryRun: true
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeFalsy()
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    expect(oid).toEqual(originalOid)
  })

  it('merge newest into master --noUpdateBranch', async () => {
    // Setup
    const { dir,gitdir } = await makeFixture('test-merge')
    // Test
    const originalOid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    const desiredOid = await resolveRef({
      gitdir,
      ref: 'newest'
    })
    const m = await merge({
      dir,
      gitdir,
      ourRef: 'master',
      theirRef: 'newest',
      fastForwardOnly: true,
      dryRun: true
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeFalsy()
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      gitdir,
      ref: 'master'
    })
    expect(oid).toEqual(originalOid)
  })

  it("merge 'add-files' and 'remove-files'", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    const commit = (await log({
      fs,
      gitdir,
      depth: 1,
      ref: 'add-files-merge-remove-files'
    }))[0]
    // Test
    const report = await merge({
      fs,
      dir,
      gitdir,
      ourRef: 'add-files',
      theirRef: 'remove-files',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0
      }
    })
    const mergeCommit = (await log({ gitdir, ref: 'add-files', depth: 1 }))[0]
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge 'remove-files' and 'add-files'", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    const commit = (await log({
      fs,
      gitdir,
      depth: 1,
      ref: 'remove-files-merge-add-files'
    }))[0]
    // TestTest
    const report = await merge({
      fs,
      dir,
      gitdir,
      ourRef: 'remove-files',
      theirRef: 'add-files',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0
      }
    })
    const mergeCommit = (await log({
      gitdir,
      ref: 'remove-files',
      depth: 1
    }))[0]
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge 'delete-first-half' and 'delete-second-half' (dryRun, missing author)", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    // Test
    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ourRef: 'delete-first-half',
        theirRef: 'delete-second-half',
        dryRun: true
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBe(null)
    expect(error.code).toBe(E.MissingAuthorError)
  })

  it("merge 'delete-first-half' and 'delete-second-half' (dryRun)", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    const commit = (await log({
      gitdir,
      depth: 1,
      ref: 'delete-first-half-merge-delete-second-half'
    }))[0]
    const originalCommit = (await log({
      gitdir,
      ref: 'delete-first-half',
      depth: 1
    }))[0]
    // Test
    const report = await merge({
      fs,
      dir,
      gitdir,
      ourRef: 'delete-first-half',
      theirRef: 'delete-second-half',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0
      },
      dryRun: true
    })
    expect(report.tree).toBe(commit.tree)
    // make sure branch hasn't been moved
    const notMergeCommit = (await log({
      gitdir,
      ref: 'delete-first-half',
      depth: 1
    }))[0]
    expect(notMergeCommit.oid).toEqual(originalCommit.oid)
    // make sure no commit object was created
    expect(
      await fs.exists(
        `${gitdir}/objects/${report.oid.slice(0, 2)}/${report.oid.slice(2)}`
      )
    ).toBe(false)
  })

  it("merge 'delete-first-half' and 'delete-second-half' (noUpdateBranch)", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    const commit = (await log({
      gitdir,
      depth: 1,
      ref: 'delete-first-half-merge-delete-second-half'
    }))[0]
    const originalCommit = (await log({
      gitdir,
      ref: 'delete-first-half',
      depth: 1
    }))[0]
    // Test
    const report = await merge({
      fs,
      dir,
      gitdir,
      ourRef: 'delete-first-half',
      theirRef: 'delete-second-half',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0
      },
      noUpdateBranch: true
    })
    expect(report.tree).toBe(commit.tree)
    // make sure branch hasn't been moved
    const notMergeCommit = (await log({
      gitdir,
      ref: 'delete-first-half',
      depth: 1
    }))[0]
    expect(notMergeCommit.oid).toEqual(originalCommit.oid)
    // but make sure the commit object exists
    expect(
      await fs.exists(
        `${gitdir}/objects/${report.oid.slice(0, 2)}/${report.oid.slice(2)}`
      )
    ).toBe(true)
  })

  it("merge 'delete-first-half' and 'delete-second-half'", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    const commit = (await log({
      gitdir,
      depth: 1,
      ref: 'delete-first-half-merge-delete-second-half'
    }))[0]
    // Test
    const report = await merge({
      fs,
      dir,
      gitdir,
      ourRef: 'delete-first-half',
      theirRef: 'delete-second-half',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0
      }
    })
    const mergeCommit = (await log({
      gitdir,
      ref: 'delete-first-half',
      depth: 1
    }))[0]
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge 'a-file' and 'a-folder'", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    // Test
    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ourRef: 'a-file',
        theirRef: 'a-folder',
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0
        }
      })
    } catch (e) {
      error = e
    }
    expect(error).toBeNull()
  })

  it("merge two branches that modified the same file (no conflict)'", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    const commit = (await log({
      gitdir,
      depth: 1,
      ref: 'a-merge-b'
    }))[0]
    // Test
    const report = await merge({
      fs,
      dir,
      gitdir,
      ourRef: 'a',
      theirRef: 'b',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0
      }
    })
    const mergeCommit = (await log({
      gitdir,
      ref: 'a',
      depth: 1
    }))[0]
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge two branches where one modified file and the other modified file mode'", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    const commit = (await log({
      gitdir,
      depth: 1,
      ref: 'a-merge-d'
    }))[0]
    // Test
    const report = await merge({
      fs,
      dir,
      gitdir,
      ourRef: 'a',
      theirRef: 'd',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0
      }
    })
    const mergeCommit = (await log({
      gitdir,
      ref: 'a',
      depth: 1
    }))[0]
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge two branches that modified the same file (should conflict)'", async () => {
    // Setup
    const { fs, dir, gitdir } = await makeFixture('test-merge')
    // Test
    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ourRef: 'a',
        theirRef: 'c',
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0
        }
      })
    } catch (e) {
      error = e
    }
    expect(error).toBeNull()
  })
})
