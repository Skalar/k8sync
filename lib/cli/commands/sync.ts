import Syncer from '../../Syncer'
import Config from '../../Config'
import SyncStatusGui from '../SyncStatusGui'
import {CliCommand} from '../../types'

const sync: CliCommand = {
  description: 'Watch and sync local files to kubernetes pods',
  args: '[name …]',

  async handler(config, args, params) {
    const syncer = new Syncer(config, args)
    const gui = new SyncStatusGui(syncer)

    syncer.on('error', error => {
      console.error(error)
    })

    process.on('SIGINT', async () => {
      await syncer.stop()
      process.exit(0)
    })

    gui.start()
    await syncer.start()
  },
}

export default sync
