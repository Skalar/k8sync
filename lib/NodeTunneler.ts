import {Core_v1Api, Watch} from '@kubernetes/client-node'
import {ChildProcess, spawn} from 'child_process'
import * as getPort from 'get-port'
import {ClientRequest} from 'http'
import Config from './Config'
import {NodeTunnel, NodeTunnelerState} from './types'

class NodeTunneler {
  public config: Config
  public nodePods: {
    [nodeName: string]: {phase: string; podName: string}
  } = {}
  public tunnels: {[nodeName: string]: NodeTunnel} = {}
  public tunnelProcesses: {[nodeName: string]: ChildProcess} = {}

  public state: NodeTunnelerState = NodeTunnelerState.Stopped
  protected watchRequest?: ClientRequest
  protected tunnelPromises: {[nodeName: string]: Promise<NodeTunnel>} = {}

  constructor(config: Config) {
    this.config = config
  }

  public async start() {
    if (this.state !== NodeTunnelerState.Stopped) {
      throw new Error(`Cannot start in state '${this.state}'`)
    }
    this.state = NodeTunnelerState.Starting
    await this.fetchDaemonSetPods()
    await this.watchDaemonSetPods()
    this.state = NodeTunnelerState.Running
  }

  public async stop() {
    if (
      ![NodeTunnelerState.Starting, NodeTunnelerState.Running].includes(
        this.state
      )
    ) {
      throw new Error(`Cannot stop in state '${this.state}'`)
    }
    this.state = NodeTunnelerState.Stopping
    for (const tunnel of Object.values(this.tunnels)) {
      tunnel.process.kill('SIGINT')
    }

    if (this.watchRequest) {
      this.watchRequest.abort()
    }

    this.tunnelPromises = {}

    this.state = NodeTunnelerState.Stopped
  }

  public async request(nodeName: string) {
    if (this.state !== NodeTunnelerState.Running) {
      throw new Error(`Cannot request in state '${this.state}'`)
    }

    if (this.tunnels[nodeName]) {
      return this.tunnels[nodeName]
    } else if (this.tunnelPromises[nodeName]) {
      return await this.tunnelPromises[nodeName]
    }

    const establishTunnel = async () => {
      const {kubectlPath, kubeContext, daemonSetNamespace} = this.config

      const pod = this.nodePods[nodeName]

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
      this.tunnelProcesses[nodeName] = process

      process.stderr.on('data', console.error)
      await new Promise((resolve, reject) => process.stdout.on('data', resolve))

      process.on('close', code => {
        delete this.tunnelProcesses[nodeName]
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

    return await tunnelPromise
      .catch(error => {
        throw error
      })
      .finally(() => {
        delete this.tunnelPromises[nodeName]
      })
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
      this.nodePods[pod.spec.nodeName] = {
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
          case 'ADDED':
          case 'MODIFIED': {
            if (obj.metadata.deletionTimestamp) {
              const {
                spec: {nodeName},
              } = obj

              if (this.tunnelProcesses[nodeName]) {
                this.tunnelProcesses[nodeName].kill('SIGINT')
              }

              delete this.tunnels[nodeName]
              delete this.nodePods[nodeName]
            } else if (obj.status.phase === 'Running') {
              this.nodePods[obj.spec.nodeName] = {
                podName: obj.metadata.name,
                phase: obj.status.phase,
              }
            }

            break
          }
        }
      },
      err => {
        if (err) {
          throw err
        }

        if (this.state === NodeTunnelerState.Running) {
          this.nodePods = {}

          this.watchDaemonSetPods()
        }
      }
    )
  }
}

export default NodeTunneler
