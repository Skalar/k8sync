import {Watch} from '@kubernetes/client-node'
import {EventEmitter} from 'events'
import {Client as WatchmanClient} from 'fb-watchman'
import {
  WatchmanSubscriptionResponse,
  TargetPod,
  SyncSpecification,
} from './types'
import {ClientRequest} from 'http'
import DaemonSetTunneler from './DaemonSetTunneler'
import * as request from 'request'
import Config from './Config'
import {join} from 'path'
import {spawn, ChildProcess} from 'child_process'

class PartialSync {
  paths: Set<string> = new Set()

  constructor(paths?: Set<string>) {
    if (paths) {
      this.paths = paths
    }
  }
}

class FullSync {
  delete = true
}

class Syncer extends EventEmitter {
  config: Config

  watchmanClient?: WatchmanClient
  podWatchRequest?: ClientRequest
  daemonSetTunneler?: DaemonSetTunneler

  targetPods: {[specName: string]: Set<TargetPod>} = {}
  syncQueue: {[podName: string]: PartialSync | FullSync} = {}
  syncLocks: {[podName: string]: number} = {}
  syncSpecs: {[name: string]: SyncSpecification} = {}
  initialSync: {[podName: string]: boolean} = {}

  constructor(config: Config, specNames?: string[]) {
    super()
    this.config = config

    for (const [specName, spec] of Object.entries(config.sync)) {
      if (specNames && specNames.length && !specNames.includes(specName)) {
        continue
      }
      this.syncSpecs[specName] = spec
      this.targetPods[specName] = new Set()
    }

    if (Object.keys(this.syncSpecs).length === 0) {
      throw new Error('No matching sync specs')
    }
  }

  async start() {
    this.watchmanClient = new WatchmanClient()
    this.watchmanClient.on('subscription', this.onFileChange.bind(this))

    this.daemonSetTunneler = new DaemonSetTunneler(this.config)

    await this.daemonSetTunneler.start()
    await Promise.all([this.watchFiles(), this.watchPods()])
    this.emit('started')
  }

  async stop() {
    this.emit('stopRequested')

    if (this.podWatchRequest) {
      this.podWatchRequest.abort()
      this.podWatchRequest = undefined
    }

    const promises = []

    if (this.watchmanClient) {
      this.watchmanClient.end()
      this.watchmanClient = undefined
    }

    if (this.daemonSetTunneler) {
      promises.push(this.daemonSetTunneler.stop())
      this.daemonSetTunneler = undefined
    }

    await Promise.all(promises)
    this.emit('stopped')
  }

  get status() {
    // we need
    return {
      test: {
        syncStatus: 'syncing',
        pods: [],
      },
    }
  }

  protected async watchPods() {
    for (const [specName, sync] of Object.entries(this.syncSpecs)) {
      const watch = new Watch(this.config.kubeConfig)
      this.podWatchRequest = watch.watch(
        `/api/v1/watch/namespaces/${this.config.namespace}/pods`,
        sync.podSelector,
        async (type, obj) => {
          if (!this.daemonSetTunneler) {
            return
          }

          if (['ADDED', 'MODIFIED'].includes(type)) {
            if (obj.status.phase === 'Running') {
              const nodeName = obj.spec.nodeName
              // FIXME verify that this selection is sane / support selecting by name
              const containerId = obj.status.containerStatuses[0].containerID.substr(
                9
              )
              const tunnel = await this.daemonSetTunneler.request(nodeName)

              const containerFsPath = (await new Promise((resolve, reject) => {
                request.get(
                  `http://localhost:${tunnel.apiPort}/${containerId}`,
                  (error, response, body) =>
                    error ? reject(error) : resolve(body)
                )
              })) as string
              const podName = obj.metadata.name
              const pod: TargetPod = {
                nodeName,
                name: podName,
                containerFsPath,
                sync,
                containerId,
              }
              this.targetPods[specName].add(pod)
              this.emit('podAdded', pod)
              this.syncQueue[podName] = new FullSync()
              this.syncTarget(pod)
            }
          } else if (type == 'DELETED') {
            const podName = obj.metadata.name
            const specPods = this.targetPods[specName]
            for (const specPod of specPods) {
              if (specPod.name === podName) {
                specPods.delete(specPod)
              }
            }
            delete this.initialSync[podName]
            this.emit('podDeleted', podName)
          } else {
            throw new Error(`Unknown type '${type}'`)
          }
        },
        err => {
          if (err) {
            console.dir({err})
          }
          throw new Error('Lost connection with cluster')
        }
      )
    }
  }

  protected async watchFiles() {
    await new Promise((resolve, reject) => {
      this.watchmanClient!.capabilityCheck(
        {optional: [], required: []},
        (err: any, res: any) => (err ? reject(err) : resolve(res))
      )
    })

    const {watch, warning} = await this.watchmanCommand([
      'watch',
      this.config.rootPath,
    ])

    const {clock: startedAt} = await this.watchmanCommand(['clock', watch])

    for (const [specName, spec] of Object.entries(this.syncSpecs)) {
      await this.watchmanCommand([
        'subscribe',
        watch,
        specName,
        {
          expression: spec.watchmanExpression || [
            'allof',
            ...(spec.excludeDirs || []).map(dir => ['not', ['dirname', dir]]),
          ],

          fields: ['name', 'size', 'mtime_ms', 'exists', 'type'],
          since: startedAt,
          ...(spec.localPath && {relative_root: spec.localPath}),
        },
      ])
    }
  }

  protected async onFileChange(data: WatchmanSubscriptionResponse) {
    const {subscription: specName, files} = data
    for (const pod of this.targetPods[specName]) {
      if (!this.syncQueue[pod.name]) {
        this.syncQueue[pod.name] = new PartialSync()
      }

      const sync = this.syncQueue[pod.name]

      if (sync instanceof PartialSync) {
        if (
          sync.paths.size + files.length >
          this.config.maxFilesForPartialSync
        ) {
          this.syncQueue[pod.name] = new FullSync()
        } else {
          for (const file of files) {
            sync.paths.add(file.name)
          }
        }
      }

      this.syncTarget(pod)
    }
  }

  protected async syncTarget(targetPod: TargetPod) {
    if (!this.daemonSetTunneler) {
      return
    }

    this.emit('podSyncStart', targetPod)

    const {nodeOverlay2Path} = this.config

    if (this.syncLocks[targetPod.name]) return

    this.syncLocks[targetPod.name] = Date.now()

    try {
      const sync = this.syncQueue[targetPod.name]
      if (!sync) return

      delete this.syncQueue[targetPod.name]

      const tunnel = await this.daemonSetTunneler.request(targetPod.nodeName)

      const rsyncSource = targetPod.sync.localPath
        ? targetPod.sync.localPath + '/'
        : '.'

      const relativeRsyncTargetPath = join(
        targetPod.containerFsPath.split(`${nodeOverlay2Path}/`)[1],
        targetPod.sync.containerPath
      )
      1
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
      ]

      for (const dir of targetPod.sync.excludeDirs) {
        rsyncArgs.push('--exclude')
        rsyncArgs.push(dir)
      }

      let rsyncProcess: ChildProcess

      if (sync instanceof FullSync) {
        rsyncProcess = spawn(
          this.config.rsyncPath,
          [...rsyncArgs, rsyncSource, rsyncTarget],
          {cwd: this.config.rootPath}
        )
      } else if (sync instanceof PartialSync) {
        rsyncProcess = spawn(
          this.config.rsyncPath,
          [
            ...rsyncArgs,
            '--delete-missing-args',
            '--files-from=-',
            rsyncSource,
            rsyncTarget,
          ],
          {cwd: this.config.rootPath}
        )
        rsyncProcess.stdin.write(Array.from(sync.paths).join('\n'))
        rsyncProcess.stdin.end()
      }

      await new Promise((resolve, reject) => {
        rsyncProcess.on('close', code => {
          if (code) {
            return reject(new Error(`rsync exited with code ${code}`))
          }
          resolve()
        })
      })

      const restartContainer = () =>
        new Promise((resolve, reject) => {
          request.delete(
            `http://localhost:${tunnel.apiPort}/${targetPod.containerId}`,
            (error, response, body) => (error ? reject(error) : resolve(body))
          )
        })

      let isInitialSync = !this.initialSync[targetPod.name]

      if (isInitialSync) {
        this.initialSync[targetPod.name] = true
      }

      if (
        targetPod.sync.restartAfterSync ||
        (targetPod.sync.restartAfterInitialSync && isInitialSync)
      ) {
        try {
          await restartContainer()
        } catch (error) {
          // Ignore? FIXME
        }
      }
    } finally {
      delete this.syncLocks[targetPod.name]

      this.emit('podSyncComplete', targetPod)

      if (this.syncQueue[targetPod.name]) {
        this.syncTarget(targetPod)
      }
    }
  }

  protected watchmanCommand(args: any): any {
    if (!this.watchmanClient) {
      throw new Error('Watchman command when no watchman client')
    }
    return new Promise((resolve, reject) => {
      this.watchmanClient!.command(
        args,
        (err: any, res: any) => (err ? reject(err) : resolve(res))
      )
    })
  }
}

export default Syncer
