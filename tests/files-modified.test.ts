import TestContext from './lib/TestContext'

let testContext: TestContext

describe('k8sync', () => {
  beforeAll(async () => {
    testContext = new TestContext()
    await testContext.initialize()
  })

  test(
    'files modified',
    async () => {
      await testContext.putLocalFiles({file1: 'a'})
      await testContext.syncer.start()
      await testContext.podSynced

      await testContext.putLocalFiles({
        file1: 'updated',
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
