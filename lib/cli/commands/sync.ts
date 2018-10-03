import Syncer from '../../Syncer'
import {CliCommand} from '../../types'
import SyncStatusGui from '../SyncerUI'

const sync: CliCommand = {
  description: 'Watch and sync local files to kubernetes pods',
  args: '[name …]',

  async handler(config, args, params) {
    const syncer = new Syncer(config, args)
    const gui = new SyncStatusGui(syncer)

    process.on('SIGINT', async () => {
      await syncer.stop()
      process.exit(0)
    })

    gui.start()
    await syncer.start()
  },
}

export default sync
