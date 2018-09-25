import {DaemonSetPodTunnel} from './types'
import Config from './Config'
import {Watch, Core_v1Api, V1PodDNSConfig} from '@kubernetes/client-node'
import {ClientRequest} from 'http'
import * as getPort from 'get-port'
import {spawn} from 'child_process'

class DaemonSetTunneler {
  config: Config
  watchRequest?: ClientRequest
  daemonSetPods: {[nodeName: string]: {phase: string; podName: string}} = {}
  tunnels: {[nodeName: string]: DaemonSetPodTunnel} = {}
  tunnelPromises: {[nodeName: string]: Promise<DaemonSetPodTunnel>} = {}

  constructor(config: Config) {
    this.config = config
  }

  async start() {
    await this.fetchDaemonSetPods()
    await this.watchDaemonSetPods()
  }

  async stop() {
    for (const tunnel of Object.values(this.tunnels)) {
      tunnel.process.kill('SIGINT')
    }

    if (this.watchRequest) {
      this.watchRequest.abort()
    }
  }

  async request(nodeName: string) {
    const {kubectlPath, kubeContext, daemonSetNamespace} = this.config

    if (this.tunnels[nodeName]) {
      return this.tunnels[nodeName]
    }

    if (this.tunnelPromises[nodeName]) {
      return this.tunnelPromises[nodeName]
    }
    const establishTunnel = async () => {
      const pod = this.daemonSetPods[nodeName]

      if (!pod) {
        throw new Error(`Could not find DaemonSet pod on node '${nodeName}'`)
      }

      if (pod.phase !== 'Running') {
        throw new Error(`DaemonSet pod on node '${nodeName}' is '${pod.phase}'`)
      }

      const {podName} = pod

      const rsyncPort = await getPort()
      const apiPort = await getPort()

      const kubectlArgs = [
        `--namespace=${daemonSetNamespace}`,
        ...(kubeContext ? [`--context=${kubeContext}`] : []),
        'port-forward',
        `pod/${podName}`,
        `${apiPort}:80`,
        `${rsyncPort}:873`,
      ]

      const process = spawn(kubectlPath, kubectlArgs)

      process.stderr.on('data', console.error)
      await new Promise((resolve, reject) => process.stdout.on('data', resolve))

      process.on('close', code => {
        delete this.tunnels[nodeName]
      })

      const podTunnel = {
        nodeName,
        podName,
        apiPort,
        rsyncPort,
        process,
      }

      this.tunnels[nodeName] = podTunnel

      return podTunnel
    }

    const tunnelPromise = establishTunnel()
    this.tunnelPromises[nodeName] = tunnelPromise
    return tunnelPromise
  }

  protected async fetchDaemonSetPods() {
    const {daemonSetNamespace} = this.config
    const cluster = this.config.kubeConfig.makeApiClient(Core_v1Api)
    const {
      body: {items: pods},
    } = await cluster.listNamespacedPod(
      daemonSetNamespace,
      undefined,
      undefined,
      undefined,
      undefined,
      'name=k8sync'
    )
    for (const pod of pods) {
      this.daemonSetPods[pod.spec.nodeName] = {
        podName: pod.metadata.name,
        phase: pod.status.phase,
      }
    }
  }

  protected async watchDaemonSetPods() {
    const {daemonSetNamespace} = this.config
    const watch = new Watch(this.config.kubeConfig)

    this.watchRequest = watch.watch(
      `/api/v1/watch/namespaces/${daemonSetNamespace}/pods`,
      {labelSelector: `name=k8sync`},
      (type, obj) => {
        switch (type) {
          case 'ADDED': {
            this.daemonSetPods[obj.spec.nodeName] = {
              podName: obj.metadata.name,
              phase: obj.status.phase,
            }
            break
          }

          case 'MODIFIED':
            break

          case 'DELETED': {
            delete this.daemonSetPods[obj.spec.nodeName]
            break
          }

          default: {
            throw new Error(`Unknown event type '${type}'`)
          }
        }
      },
      err => {
        if (err) {
          throw err
        }

        throw new Error('Lost connection with cluster')
      }
    )
  }
}

export default DaemonSetTunneler
