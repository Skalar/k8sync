import {V1Pod, Watch} from '@kubernetes/client-node'
import {EventEmitter} from 'events'
import {Client as WatchmanClient} from 'fb-watchman'
import {ClientRequest} from 'http'
import * as request from 'request'
import StrictEventEmitter from 'strict-event-emitter-types'
import Config from './Config'
import NodeTunneler from './NodeTunneler'
import Sync from './Sync'
import {
  SyncerEvents,
  SyncerState,
  SyncSpecification,
  SyncType,
  TargetPod,
  WatchmanSubscriptionResponse,
} from './types'

type SyncerEmitter = StrictEventEmitter<EventEmitter, SyncerEvents>

class Syncer extends (EventEmitter as {new (): SyncerEmitter}) {
  public config: Config

  /**
   * Synchronization specification, by targetName
   */
  public syncSpecs: {[targetName: string]: SyncSpecification} = {}

  /**
   * Pods to keep in sync, by target
   */
  public targetPods: {[targetName: string]: Set<TargetPod>} = {}

  /**
   * The current state of the syncer
   */
  public state: SyncerState = SyncerState.Stopped

  protected watchmanClient?: WatchmanClient
  protected targetPodWatchRequests: {[targetName: string]: ClientRequest} = {}
  protected nodeTunneler?: NodeTunneler

  constructor(config: Config, specNames?: string[]) {
    super()
    this.config = config

    for (const [specName, spec] of Object.entries(config.sync)) {
      if (specNames && specNames.length && !specNames.includes(specName)) {
        continue
      }
      this.syncSpecs[specName] = spec
    }

    if (Object.keys(this.syncSpecs).length === 0) {
      throw new Error('No matching sync specs')
    }
  }

  public async start() {
    this.state = SyncerState.Starting
    this.emit('starting')
    this.watchmanClient = new WatchmanClient()
    this.watchmanClient.on('subscription', this.onFileChange.bind(this))
    this.nodeTunneler = new NodeTunneler(this.config)

    await this.nodeTunneler.start()

    const promises = []

    for (const [specName, syncSpec] of Object.entries(this.syncSpecs)) {
      promises.push(this.watchTargetPods(specName, syncSpec))
    }

    promises.push(this.watchFiles())
    await Promise.all(promises)
    this.once('error', () => this.stop())
    this.state = SyncerState.Running
    this.emit('running')
  }

  public async stop() {
    this.state = SyncerState.Stopping
    this.emit('stopping')

    const promises = []

    // Clean up pod watch requests
    for (const [targetName, watchRequest] of Object.entries(
      this.targetPodWatchRequests
    )) {
      watchRequest.abort()
      delete this.targetPodWatchRequests[targetName]
    }

    // Clean up file watching
    if (this.watchmanClient) {
      this.watchmanClient.end()
      this.watchmanClient = undefined
    }

    // Clean up node tunneler
    if (this.nodeTunneler) {
      promises.push(this.nodeTunneler.stop())
      this.nodeTunneler = undefined
    }

    await Promise.all(promises)

    this.state = SyncerState.Stopped
    this.emit('stopped')
  }

  protected async watchTargetPods(
    targetName: string,
    syncSpec: SyncSpecification
  ) {
    this.targetPods[targetName] = new Set()

    const watch = new Watch(this.config.kubeConfig)
    this.targetPodWatchRequests[targetName] = watch.watch(
      `/api/v1/watch/namespaces/${this.config.namespace}/pods`,
      syncSpec.podSelector,
      async (type, obj: V1Pod) => {
        try {
          if (['ADDED', 'MODIFIED'].includes(type)) {
            if (obj.metadata.deletionTimestamp) {
              // Pod is being deleted
              await this.removeTargetPod(targetName, syncSpec, obj)
            } else if (obj.status.phase === 'Running') {
              const existingTargetPod = Array.from(
                this.targetPods[targetName]
              ).find(pod => pod.podName === obj.metadata.name)

              if (existingTargetPod) return // We are already tracking this pod

              await this.addTargetPod(targetName, syncSpec, obj)
            }
          }
        } catch (error) {
          this.emit('error', error)
          throw error
        }
      },
      err => {
        if (err) {
          this.emit('error', err)
        } else if (this.state === SyncerState.Running) {
          this.watchTargetPods(targetName, syncSpec)
        }
      }
    )
  }

  protected async addTargetPod(
    targetName: string,
    syncSpec: SyncSpecification,
    pod: V1Pod
  ) {
    if (!this.nodeTunneler) {
      this.emit(
        'error',
        new Error('Cannot add pod when daemonSetTunneler is not available')
      )
      return
    }

    const podName = pod.metadata.name
    const nodeName = pod.spec.nodeName
    // FIXME verify that this selection is sane / support selecting by name
    const containerStatus = pod.status.containerStatuses[0]
    if (!containerStatus.ready) return

    const containerId = containerStatus.containerID.substr(9)
    const targetPod: TargetPod = {
      hasBeenSynced: false,
      nodeName,
      podName,
      syncSpec,
      containerId,
      targetName,
    }
    this.targetPods[targetName].add(targetPod)
    this.emit('podAdded', targetPod)
    targetPod.pendingSync = new Sync(SyncType.Full, targetPod)
    this.syncTargetPod(targetPod)
  }

  protected removeTargetPod(
    targetName: string,
    syncSpec: SyncSpecification,
    pod: V1Pod
  ) {
    const podName = pod.metadata.name
    const targetPods = this.targetPods[targetName]
    for (const targetPod of targetPods) {
      if (targetPod.podName === podName) {
        targetPods.delete(targetPod)
        this.emit('podDeleted', targetPod)
      }
    }
  }

  protected async watchFiles() {
    await new Promise((resolve, reject) => {
      this.watchmanClient!.capabilityCheck(
        {optional: [], required: []},
        (err: any, res: any) => (err ? reject(err) : resolve(res))
      )
    })

    const {watch} = await this.watchmanCommand(['watch', this.config.rootPath])

    const {clock: startedAt} = await this.watchmanCommand(['clock', watch])

    for (const [targetName, syncSpec] of Object.entries(this.syncSpecs)) {
      await this.watchmanCommand([
        'subscribe',
        watch,
        targetName,
        {
          expression: syncSpec.watchmanExpression || [
            'allof',
            ...(syncSpec.excludeDirs || []).map(dir => [
              'not',
              ['dirname', dir],
            ]),
          ],

          fields: ['name', 'size', 'mtime_ms', 'exists', 'type'],
          since: startedAt,
          ...(syncSpec.localPath && {relative_root: syncSpec.localPath}),
        },
      ])
    }
  }

  protected async onFileChange(data: WatchmanSubscriptionResponse) {
    const {subscription: targetName, files} = data
    for (const targetPod of this.targetPods[targetName]) {
      if (!targetPod.pendingSync) {
        targetPod.pendingSync = new Sync(SyncType.Partial, targetPod)
      }

      // No need to add paths to a full sync
      if (targetPod.pendingSync.type === SyncType.Partial) {
        if (
          targetPod.pendingSync.paths.size + files.length >
          this.config.maxFilesForPartialSync
        ) {
          targetPod.pendingSync = new Sync(SyncType.Full, targetPod)
        } else {
          for (const file of files) {
            targetPod.pendingSync.paths.add(file.name)
          }
        }
      }

      this.syncTargetPod(targetPod)
    }
  }

  protected async syncTargetPod(targetPod: TargetPod) {
    if (targetPod.activeSync) return // Prevent concurrent syncs to the same pod
    if (!targetPod.pendingSync) return

    try {
      targetPod.activeSync = targetPod.pendingSync
      targetPod.pendingSync = undefined

      this.emit('syncStarted', targetPod.activeSync)
      const tunnel = await this.nodeTunneler!.request(targetPod.nodeName)

      if (!targetPod.containerFsPath) {
        targetPod.containerFsPath = (await new Promise((resolve, reject) => {
          request.get(
            `http://localhost:${tunnel.apiPort}/${targetPod.containerId}`,
            (error, response, body) => (error ? reject(error) : resolve(body))
          )
        })) as string
      }

      await targetPod.activeSync.execute(this.config, tunnel)

      const isInitialSync = !targetPod.hasBeenSynced
      targetPod.hasBeenSynced = true

      if (
        targetPod.syncSpec.restartAfterSync ||
        (targetPod.syncSpec.restartAfterInitialSync && isInitialSync)
      ) {
        await new Promise((resolve, reject) => {
          request.delete(
            `http://localhost:${tunnel.apiPort}/${targetPod.containerId}`,
            (error, response, body) => (error ? reject(error) : resolve(body))
          )
        })
      }

      targetPod.previousSync = targetPod.activeSync
      targetPod.activeSync = undefined
      this.emit('syncCompleted', targetPod.previousSync)
    } catch (error) {
      targetPod.previousSync = targetPod.activeSync!
      targetPod.previousSync.error = error
      targetPod.activeSync = undefined
      this.emit('syncError', error, targetPod.previousSync!)
    } finally {
      if (targetPod.pendingSync) {
        this.syncTargetPod(targetPod)
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
