import TestContext from './lib/TestContext'

let testContext: TestContext

describe('k8sync', () => {
  beforeAll(async () => {
    testContext = new TestContext()
    await testContext.initialize()
  })

  test(
    'start-stop-start',
    async () => {
      await testContext.putLocalFiles({file1: 'a'})
      await testContext.syncer.start()
      await testContext.podSynced
      await testContext.syncer.stop()
      await testContext.putLocalFiles({file1: 'b'})
      await testContext.syncer.start()
      await testContext.putLocalFiles({file1: 'c'})
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
