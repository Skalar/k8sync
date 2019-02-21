import chalk from 'chalk'
import {circleDotted, play, tick, warning} from 'figures'
import * as logUpdate from 'log-update'
import Syncer from '../Syncer'

class SyncerUI {
  public syncer: Syncer

  constructor(syncer: Syncer) {
    this.syncer = syncer
  }

  public start() {
    this.renderInitScreen()

    for (const event of [
      'running',
      'syncStarted',
      'syncCompleted',
      'syncError',
      'podAdded',
      'podDeleted',
    ]) {
      this.syncer.on(event as any, this.renderSyncScreen)
    }
    this.syncer.on('stopping', this.renderShutdownScreen)
    this.syncer.on('stopped', this.stop)
    this.syncer.on('error', error => {
      logUpdate.stderr(error.toString())
    })
  }

  public stop = () => {
    for (const event of [
      'running',
      'syncStarted',
      'syncCompleted',
      'syncError',
      'podAdded',
      'podDeleted',
    ]) {
      this.syncer.off(event as any, this.renderSyncScreen)
    }
    this.syncer.off('stopping', this.renderShutdownScreen)
    this.syncer.off('stopped', this.stop)

    logUpdate.clear()
  }

  protected eventListeners(remove = false) {
    const fn = remove ? this.syncer.off : this.syncer.on
    for (const event of [
      'running',
      'syncStarted',
      'syncCompleted',
      'syncError',
      'podAdded',
      'podDeleted',
    ]) {
      fn(event as any, this.renderSyncScreen)
    }
    fn('stopping', this.renderShutdownScreen)
    fn('stopped', this.stop)
  }

  protected renderInitScreen = () => {
    logUpdate(`${chalk.yellow('Initializing..')}\n`)
  }

  protected renderSyncScreen = () => {
    const lines = []

    for (const targetName of Object.keys(this.syncer.syncSpecs)) {
      const pods = Array.from(this.syncer.targetPods[targetName])
      lines.push(` ${chalk[pods.length ? 'blue' : 'grey'].bold(targetName)}`)

      for (const pod of pods) {
        const podDescription = `${pod.podName} [${pod.containerName}]`

        if (pod.activeSync || pod.pendingSync) {
          lines.push(chalk.yellowBright(`  ${play} ${podDescription}`))
        } else if (pod.previousSync) {
          if (pod.previousSync.error) {
            lines.push(
              chalk.red(
                `  ${warning} ${podDescription}: ${pod.previousSync.error}`
              )
            )
          } else {
            lines.push(' ' + chalk.green(`${tick} ${podDescription}`))
          }
        } else {
          lines.push('  ' + chalk.grey(`${circleDotted} ${podDescription}`))
        }
      }
      lines.push(null)
    }

    logUpdate('\n' + lines.join('\n'))
  }

  protected renderShutdownScreen = () => {
    logUpdate(`Stopping...`)
  }
}

export default SyncerUI
