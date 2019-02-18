import {ChildProcess, spawn} from 'child_process'
import {join} from 'path'
import Config from './Config'
import {NodeTunnel, SyncType, TargetPod} from './types'

class Sync {
  public type: SyncType
  public paths: Set<string> = new Set()
  public targetPod: TargetPod
  public error?: Error

  constructor(type: SyncType, targetPod: TargetPod) {
    this.type = type
    this.targetPod = targetPod
  }

  public execute(config: Config, tunnel: NodeTunnel) {
    const {targetPod} = this
    if (!targetPod.containerFsPath) {
      return Promise.reject(
        new Error('Tried to sync pod with unresolved containerFsPath')
      )
    }

    const rsyncSource = targetPod.syncSpec.localPath
      ? targetPod.syncSpec.localPath + '/'
      : '.'
    const relativeRsyncTargetPath = join(
      targetPod.containerFsPath.split(`${config.nodeOverlay2Path}/`)[1],
      targetPod.syncSpec.containerPath
    )
    const rsyncTarget = `rsync://localhost:${
      tunnel.rsyncPort
    }/overlay2/${relativeRsyncTargetPath}/`

    const rsyncArgs = [
      '--recursive',
      '--links',
      '--executability',
      '--times',
      '--compress',
      '--delete-after',
      ...(targetPod.syncSpec.rsyncArgs ? targetPod.syncSpec.rsyncArgs : []),
    ]

    for (const dir of targetPod.syncSpec.excludeDirs) {
      rsyncArgs.push('--exclude')
      rsyncArgs.push(dir)
    }

    let rsyncProcess: ChildProcess
    let stderr = ''

    if (this.type === SyncType.Full) {
      rsyncProcess = spawn(
        config.rsyncPath,
        [...rsyncArgs, rsyncSource, rsyncTarget],
        {cwd: config.rootPath}
      )
      rsyncProcess.stderr.on('data', data => (stderr += data.toString()))
    } else if (this.type === SyncType.Partial) {
      rsyncProcess = spawn(
        config.rsyncPath,
        [
          ...rsyncArgs,
          '--delete-missing-args',
          '--files-from=-',
          rsyncSource,
          rsyncTarget,
        ],
        {cwd: config.rootPath}
      )
      rsyncProcess.stderr.on('data', data => (stderr += data.toString()))
      rsyncProcess.stdin.write(Array.from(this.paths).join('\n'))
      rsyncProcess.stdin.end()
    }

    return new Promise((resolve, reject) => {
      rsyncProcess.on('close', code => {
        if (code) {
          const error = new Error(`(${code}): ${stderr}`)
          this.error = error
        }

        resolve()
      })
    })
  }
}

export default Sync
