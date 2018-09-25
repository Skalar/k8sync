import {Apps_v1Api} from '@kubernetes/client-node'
import {CliCommand} from '../../types'

const cleanCluster: CliCommand = {
  description: 'Remove cluster resources',

  async handler(config, args, params) {
    const cluster = config.kubeConfig.makeApiClient(Apps_v1Api)

    try {
      await cluster.deleteNamespacedDaemonSet(
        'k8sync',
        config.daemonSetNamespace,
        {} as any
      )
      console.log(
        `Deleted 'k8sync' DaemonSet (namespace=${config.daemonSetNamespace})`
      )
    } catch (error) {
      if (error.response.body.code !== 404) {
        throw error
      }

      console.log(`No DaemonSet found (namespace=${config.daemonSetNamespace})`)
    }
  },
}

export default cleanCluster
