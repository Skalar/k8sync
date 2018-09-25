import * as logUpdate from 'log-update'
import Syncer from '../Syncer'
import {tick, play, circleDotted} from 'figures'
import chalk from 'chalk'

class SyncStatusGui {
  syncer: Syncer

  constructor(syncer: Syncer) {
    this.syncer = syncer
  }

  start() {
    this.renderInitScreen()

    for (const event of [
      'started',
      'podSyncStart',
      'podSyncComplete',
      'podAdded',
      'podDeleted',
    ]) {
      this.syncer.on(event, () => this.renderSyncScreen())
    }

    this.syncer.on('stopRequested', () => this.renderShutdownScreen())
    this.syncer.on('stopped', () => this.stop())
  }

  stop() {
    logUpdate.clear()
  }

  get tasks() {
    return Object.keys(this.syncer.syncSpecs).map(specName => {
      this.syncer.syncQueue
    })
  }

  renderSyncScreen() {
    let text = '\n'
    const {syncer} = this

    for (const [specName, spec] of Object.entries(syncer.syncSpecs)) {
      const pods = this.syncer.targetPods[specName]
      const podNames = Array.from(pods).map(pod => pod.name)

      let statusColor: string

      if (pods.size === 0) {
        text += chalk.grey(` ${circleDotted}  ${specName}\n`)
      } else {
        if (
          podNames.find(
            podName =>
              typeof syncer.syncLocks[podName] !== 'undefined' ||
              typeof syncer.syncQueue[podName] !== 'undefined'
          )
        ) {
          text += chalk.bold.yellowBright(` ${play}  ${specName}\n`)
        } else {
          text += chalk.bold.green(` ${tick}  ${specName}\n`)
        }
      }
    }
    logUpdate(text)
  }

  renderInitScreen() {
    logUpdate(`${chalk.yellow('initializing..')}\n`)
  }

  renderShutdownScreen() {
    logUpdate(`Stopping...`)
  }
}

export default SyncStatusGui
