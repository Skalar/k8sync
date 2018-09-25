import TestContext from './lib/TestContext'

let testContext: TestContext

describe('k8sync', () => {
  beforeAll(async () => {
    testContext = new TestContext()
    await testContext.initialize()
  })

  test(
    'files added',
    async () => {
      await testContext.syncer.start()
      await testContext.podSynced

      await testContext.putLocalFiles({
        'subdir/file2': 'a',
      })

      await testContext.podSynced
      expect(await testContext.localAndRemoteDiff()).toBe(null)
    },
    20000
  )

  afterAll(async () => {
    await testContext.syncer.stop()
    await testContext.clean()
  })
})
